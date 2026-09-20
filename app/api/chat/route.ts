import { hybridSearch, DENSE_READY, type Hit } from "@/lib/retrieval";
import { API_KEY, GeminiError } from "@/lib/gemini";
import { AgentFailure, runAgent, type AgentEvent } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Msg = { role: "user" | "assistant"; content: string };

// --- tiny in-memory rate limit (per server instance) to protect the free API key ---
const hitsByIp = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const arr = (hitsByIp.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hitsByIp.set(ip, arr);
  return arr.length > 12;
}

function offlineAnswer(hits: Hit[]) {
  if (!hits.length)
    return "I couldn't find anything about that in my knowledge base. Try asking about IEEE RAS journals, ICRA, IROS, awards, technical committees or membership.";
  const lead = hits[0].text.split(/(?<=\.)\s/).slice(0, 2).join(" ");
  const more = hits.slice(1, 3).map((h) => `- **${h.heading}** — ${h.text.split(/(?<=\.)\s/)[0]}`);
  return `*Offline mode — no language model is connected, so the agent can only retrieve. Here are the most relevant passages.*\n\n${lead}\n\n${more.join("\n")}`;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return Response.json({ error: "Too many requests — give the reactor a minute to cool down." }, { status: 429 });

  let messages: Msg[] = [];
  try {
    messages = ((await req.json()).messages || [])
      .filter((m: Msg) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-8)
      .map((m: Msg) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return Response.json({ error: "Empty question" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const t0 = Date.now();
      const typewrite = async (text: string) => {
        for (const piece of text.match(/\S+\s*|\s+/g) || []) {
          send({ t: "token", v: piece });
          await new Promise((r) => setTimeout(r, 12));
        }
      };
      try {
        const live = !!API_KEY;
        send({ t: "meta", mode: live && DENSE_READY ? "hybrid" : "keyword", live, agent: live });

        if (!live) {
          // Offline fallback: a single retrieval step, extractive answer.
          send({ t: "step", id: "s1", name: "search_knowledge_base", args: { query: last.content }, label: `Searching: “${last.content.slice(0, 60)}”` });
          const hits = hybridSearch(last.content, null, 5);
          send({ t: "retrieval", hits, query: last.content, dense: false });
          send({ t: "step_done", id: "s1", summary: hits.length ? `${hits.length} passages` : "no matches", ms: Date.now() - t0 });
          send({ t: "sources", hits });
          await typewrite(offlineAnswer(hits));
          send({ t: "done", model: "offline-retrieval", total: Date.now() - t0, steps: 1 });
          controller.close();
          return;
        }

        const { answer, model, steps } = await runAgent(messages.slice(0, -1), last.content, (e: AgentEvent) => send(e));
        await typewrite(answer);
        send({ t: "done", model, total: Date.now() - t0, steps });
      } catch (e) {
        const cause = e instanceof AgentFailure ? e.cause : e;
        const status = cause instanceof GeminiError ? cause.status : 0;
        console.error("[agent] failed:", cause);
        const reason =
          status === 429 ? "Gemini's free-tier rate limit was hit"
          : status >= 500 ? `Gemini is temporarily overloaded (HTTP ${status})`
          : status === 400 ? "Gemini rejected the request (HTTP 400)"
          : status === 403 ? "the Gemini API key was rejected (HTTP 403)"
          : "the language model could not be reached";
        const sources = e instanceof AgentFailure ? e.sources : [];
        if (sources.length) {
          // Graceful degradation: the agent already gathered evidence, so show it instead of a dead end.
          send({ t: "sources", hits: sources });
          await typewrite(`*The final writing step failed because ${reason}, so here is the evidence the agent gathered. Try again in a few seconds for a full answer.*\n\n${offlineAnswer(sources).replace(/^\*Offline mode[^\n]*\n\n/, "")}`);
          send({ t: "done", model: "fallback-extractive", total: Date.now() - t0, steps: 0 });
        } else {
          send({ t: "error", message: `Couldn't answer: ${reason}. Please try again in a few seconds.` });
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
