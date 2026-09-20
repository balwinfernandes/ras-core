// Minimal Gemini REST client (no SDK needed): query embeddings + function calling with model fallback.
const BASE = `${process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com"}/v1beta/models`;

export const API_KEY = process.env.GEMINI_API_KEY || "";

// Tried in order. If Google retires a model, the next one is used automatically.
export const MODEL_CHAIN = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

export async function embedQuery(text: string, model: string): Promise<number[]> {
  const res = await fetch(`${BASE}/${model}:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`embed ${res.status}`);
  const v: number[] = (await res.json()).embedding.values;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

// ---------- function calling (used by the agent) ----------
export type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
};
export type Content = { role: "user" | "model"; parts: Part[] };
export type FunctionDeclaration = { name: string; description: string; parameters?: Record<string, unknown> };

let preferredModel: string | null = null; // remembers which model worked, per server instance

export class GeminiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function generateWithTools(opts: {
  system: string;
  contents: Content[];
  tools: FunctionDeclaration[];
  allowTools: boolean;
}): Promise<{ content: Content; model: string }> {
  // Once a model has been used in this conversation, stick to it: thought signatures from one
  // model are not valid for another. Before that, walk the fallback chain.
  const chain = preferredModel ? [preferredModel, ...MODEL_CHAIN.filter((m) => m !== preferredModel)] : MODEL_CHAIN;
  const midConversation = opts.contents.some((c) => c.role === "model");
  let last: GeminiError | null = null;

  for (const model of midConversation ? chain.slice(0, 1) : chain) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${BASE}/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            contents: opts.contents,
            tools: [{ functionDeclarations: opts.tools }],
            toolConfig: { functionCallingConfig: { mode: opts.allowTools ? "AUTO" : "NONE" } },
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
          }),
          signal: AbortSignal.timeout(45000),
        });
      } catch (e) {
        last = new GeminiError(0, `network/timeout: ${e instanceof Error ? e.message : e}`);
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (res.ok) {
        const json = await res.json();
        const content: Content | undefined = json?.candidates?.[0]?.content;
        preferredModel = model;
        const finish = json?.candidates?.[0]?.finishReason;
        if (!content?.parts?.length) {
          // blocked or empty answer — treat as retryable once
          last = new GeminiError(200, `empty response (finishReason: ${finish || "unknown"})`);
          await sleep(500);
          continue;
        }
        return { content: { role: "model", parts: content.parts }, model };
      }
      const body = (await res.text()).slice(0, 400);
      last = new GeminiError(res.status, `${model} → HTTP ${res.status}: ${body}`);
      console.error("[gemini]", last.message);
      if (res.status === 404 || (res.status === 400 && !preferredModel)) break; // model unavailable → next model
      if (!RETRYABLE.has(res.status)) throw last;
      // overloaded / rate-limited → back off and retry the same model
      if (attempt < 2) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : 900 * (attempt + 1));
      }
    }
  }
  throw last || new GeminiError(0, "No Gemini model available");
}
