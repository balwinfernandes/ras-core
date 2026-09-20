// RAS CORE agent: a tool-using loop (ReAct style) on top of Gemini function calling.
// The model decides what to do next — search the knowledge base (possibly several times with
// different queries), read a whole document, check today's date, count days — and only answers
// once it has gathered evidence. Every step is streamed to the UI.
import { CHUNKS, DENSE_READY, EMBED_MODEL, hybridSearch, type Hit } from "@/lib/retrieval";
import { embedQuery, generateWithTools, type Content, type FunctionDeclaration } from "@/lib/gemini";

export type AgentEvent =
  | { t: "step"; id: string; name: string; args: Record<string, unknown>; label: string }
  | { t: "step_done"; id: string; summary: string; ms: number }
  | { t: "retrieval"; hits: Hit[]; query: string; dense: boolean }
  | { t: "sources"; hits: Hit[] }
  | { t: "thinking"; text: string };

const CATEGORIES = [...new Set(CHUNKS.map((c) => c.category))];
const DOCS = [...new Map(CHUNKS.map((c) => [c.doc, { doc: c.doc, title: c.title, category: c.category }])).values()];

export const TOOLS: FunctionDeclaration[] = [
  {
    name: "search_knowledge_base",
    description:
      "Hybrid semantic + keyword search over the IEEE RAS knowledge base. Returns the most relevant passages. Call it again with a different, more specific query if results are incomplete. For comparisons, search each item separately.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A focused search query, e.g. 'ICRA 2027 location and dates'." },
        category: { type: "string", enum: CATEGORIES, description: "Optional: restrict the search to one category." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_document",
    description: "Read every passage of one knowledge-base document. Use for broad questions like 'tell me everything about RAS awards'. Use list_topics first if unsure of the document id.",
    parameters: {
      type: "object",
      properties: { doc_id: { type: "string", enum: DOCS.map((d) => d.doc), description: "Document id from list_topics." } },
      required: ["doc_id"],
    },
  },
  {
    name: "list_topics",
    description: "List all documents in the knowledge base with their ids, titles and categories. Use to discover what the agent knows.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_current_datetime",
    description: "Get today's date and the current time in India (IST). Use for any question involving 'now', 'today', 'upcoming', deadlines or countdowns.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "days_between",
    description: "Count the number of days from start_date to end_date (both YYYY-MM-DD). Negative means end_date is in the past.",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["start_date", "end_date"],
    },
  },
];

export const AGENT_SYSTEM = `You are RAS CORE, an AI agent about the IEEE Robotics and Automation Society (IEEE RAS), the global IEEE society for robotics and automation. You answer about its history, mission, journals, conferences, technical committees, awards, education programmes, chapters, standards, leadership and membership.
You have tools. Work like a careful researcher:
1. PLAN: decide what information you need.
2. ACT: call search_knowledge_base for every factual claim you will make (never answer facts from memory). Use several searches with specific queries when a question has multiple parts or compares things. Use get_document for broad "tell me about" questions. Use get_current_datetime and days_between for anything about dates, deadlines, "upcoming" or "how long until".
3. ANSWER: once you have the evidence, write the final answer.
Answer rules:
- Use ONLY facts found in tool results. Do NOT write citation numbers or brackets like [1] in your answer: the interface shows the sources you used separately.
- If the tools do not contain the answer, say you don't have that information and suggest ieee-ras.org or the chapter's channels. Never guess.
- Be concise and energetic: short paragraphs or bullets, about 180 words max unless asked for detail. Plain Markdown (bold, bullets). No headings, no tables.
- For greetings or "what can you do", reply briefly without tools and suggest example questions about IEEE RAS: its journals, ICRA/IROS/CASE, awards, technical committees, membership and standards.`;

const nowIST = () => {
  const d = new Date();
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });
  const weekday = d.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" });
  return { date, time, weekday, timezone: "Asia/Kolkata (IST, UTC+05:30)" };
};

const parseDate = (s: unknown) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
};

function labelFor(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search_knowledge_base": return `Searching: “${args.query}”${args.category ? ` in ${args.category}` : ""}`;
    case "get_document": return `Reading document: ${DOCS.find((d) => d.doc === args.doc_id)?.title || args.doc_id}`;
    case "list_topics": return "Listing what I know";
    case "get_current_datetime": return "Checking today's date (IST)";
    case "days_between": return `Counting days ${args.start_date} → ${args.end_date}`;
    default: return name;
  }
}

/** Runs the agent. Calls `emit` for every event; returns the final answer text and model name. */
export class AgentFailure extends Error {
  constructor(public cause: unknown, public sources: Hit[]) { super("agent failed"); }
}

export async function runAgent(
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  emit: (e: AgentEvent) => void,
): Promise<{ answer: string; model: string; steps: number }> {
  const contents: Content[] = history.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
  contents.push({ role: "user", parts: [{ text: question }] });

  // citation registry: every passage the agent sees gets a stable number for this answer
  const sources: Hit[] = [];
  const register = (h: Hit) => {
    const existing = sources.find((s) => s.id === h.id);
    if (existing) return existing;
    const s = { ...h, n: sources.length + 1 };
    sources.push(s);
    return s;
  };
  const asResult = (h: Hit) => ({ source: h.n, document: h.title, section: h.heading, category: h.category, text: h.text, urls: h.sources });

  try {
    return await loop();
  } catch (e) {
    throw new AgentFailure(e, sources);
  }

  async function loop(): Promise<{ answer: string; model: string; steps: number }> {
  const MAX_ROUNDS = 6;
  let model = "";
  let stepNo = 0;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const allowTools = round < MAX_ROUNDS;
    const out = await generateWithTools({ system: AGENT_SYSTEM, contents, tools: TOOLS, allowTools });
    model = out.model;
    const calls = out.content.parts.filter((p) => p.functionCall);
    const text = out.content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");

    if (!calls.length) {
      if (sources.length) emit({ t: "sources", hits: sources });
      return { answer: text.trim() || "I couldn't produce an answer — please try rephrasing.", model, steps: stepNo };
    }
    if (text.trim()) emit({ t: "thinking", text: text.trim() });

    contents.push(out.content); // keep the model turn verbatim (includes thought signatures)
    const responses: Content = { role: "user", parts: [] };
    for (const part of calls) {
      const { name, args = {}, id } = part.functionCall!;
      const stepId = `s${++stepNo}`;
      const t0 = Date.now();
      emit({ t: "step", id: stepId, name, args, label: labelFor(name, args) });
      let result: Record<string, unknown>;
      let summary = "";
      try {
        if (name === "search_knowledge_base") {
          const q = String(args.query || question);
          let qvec: number[] | null = null;
          if (DENSE_READY && EMBED_MODEL) { try { qvec = await embedQuery(q, EMBED_MODEL); } catch { qvec = null; } }
          const cat = typeof args.category === "string" && CATEGORIES.includes(args.category) ? args.category : undefined;
          const hits = hybridSearch(q, qvec, 4, cat).map(register);
          emit({ t: "retrieval", hits, query: q, dense: !!qvec });
          result = hits.length ? { results: hits.map(asResult) } : { results: [], note: "No relevant passages found. Try a different query." };
          summary = hits.length ? `${hits.length} passages · sources ${hits.map((h) => `[${h.n}]`).join("")}` : "no matches";
        } else if (name === "get_document") {
          const chunks = CHUNKS.filter((c) => c.doc === args.doc_id);
          const hits = chunks.map((c) => register({ n: 0, id: c.id, title: c.title, heading: c.heading, category: c.category, sources: c.sources, text: c.text, scores: { dense: null, bm25: 0, fused: 1 } }));
          if (hits.length) emit({ t: "retrieval", hits, query: String(args.doc_id), dense: false });
          result = hits.length ? { document: chunks[0].title, passages: hits.map(asResult) } : { error: "Unknown doc_id. Call list_topics." };
          summary = hits.length ? `${hits.length} sections read` : "document not found";
        } else if (name === "list_topics") {
          result = { documents: DOCS };
          summary = `${DOCS.length} documents`;
        } else if (name === "get_current_datetime") {
          result = nowIST();
          summary = `${(result as { date: string }).date} (${(result as { weekday: string }).weekday})`;
        } else if (name === "days_between") {
          const a = parseDate(args.start_date), b = parseDate(args.end_date);
          if (Number.isNaN(a) || Number.isNaN(b)) { result = { error: "Dates must be YYYY-MM-DD" }; summary = "invalid dates"; }
          else { const days = Math.round((b - a) / 86400000); result = { days }; summary = `${days} days`; }
        } else {
          result = { error: `Unknown tool ${name}` };
          summary = "unknown tool";
        }
      } catch (e) {
        result = { error: e instanceof Error ? e.message : "tool failed" };
        summary = "tool error";
      }
      emit({ t: "step_done", id: stepId, summary, ms: Date.now() - t0 });
      responses.parts.push({ functionResponse: { name, response: result, ...(id ? { id } : {}) } });
    }
    contents.push(responses);
  }
  return { answer: "I ran out of steps before finishing. Please ask a narrower question.", model, steps: stepNo };
  }
}
