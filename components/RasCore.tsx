"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import graphData from "@/data/graph.json";
import BootSequence from "./BootSequence";
import Cursor from "./Cursor";
import Markdown from "./Markdown";
import { sound } from "@/lib/sound";
import type { AgentStep, ChatMessage, Graph, GraphNode, Hit, Stage, Timings } from "@/lib/types";
import { CATEGORY_COLORS, colorFor } from "@/lib/types";
import type { ActiveNode } from "./Constellation";

const Constellation = dynamic(() => import("./Constellation"), { ssr: false });
const graph = graphData as unknown as Graph;

const SUGGESTIONS = [
  "How many days until ICRA 2027 begins, and where is it?",
  "Compare ICRA and IROS for me",
  "Which journals does IEEE RAS publish, and which is fastest to publish in?",
  "What awards does IEEE RAS give to early-career researchers?",
  "How can a student chapter get a Distinguished Lecturer?",
  "What robotics standards has IEEE RAS created?",
]

const TOOL_ICON: Record<string, string> = {
  search_knowledge_base: "⌕",
  get_document: "▤",
  list_topics: "☰",
  get_current_datetime: "◷",
  days_between: "Σ",
};

const uid = () => Math.random().toString(36).slice(2, 10);

function useClock() {
  const [t, setT] = useState("--:--:--");
  useEffect(() => {
    const f = () => setT(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }));
    f();
    const id = setInterval(f, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}


export default function RasCore() {
  const [entered, setEntered] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [timings, setTimings] = useState<Timings>({});
  const [mode, setMode] = useState<"hybrid" | "keyword" | null>(null);
  const [active, setActive] = useState<ActiveNode[]>([]);
  const [queryKey, setQueryKey] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [inspect, setInspect] = useState<{ node?: GraphNode; hit?: Hit } | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [amaze, setAmaze] = useState(0);
  const [flash, setFlash] = useState(0);
  const [listening, setListening] = useState(false);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [showInternals, setShowInternals] = useState(false); // hidden by default
  const [openLogs, setOpenLogs] = useState<Set<string>>(new Set());
  const toggleLog = (id: string) =>
    setOpenLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // remember the hide/show choice (safe if storage is blocked)
  useEffect(() => {
    try { if (localStorage.getItem("rascore-internals") === "shown") setShowInternals(true); } catch { /* ignore */ }
  }, []);
  const toggleInternals = useCallback(() => {
    sound.tick();
    setShowInternals((v) => {
      try { localStorage.setItem("rascore-internals", v ? "hidden" : "shown"); } catch { /* ignore */ }
      return !v;
    });
  }, []);
  const tipRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const clock = useClock();

  useEffect(() => sound.subscribe((m) => setSoundOn(!m)), []);

  const lastHits = useMemo(() => [...messages].reverse().find((m) => m.hits?.length)?.hits || [], [messages]);

  const bootLines = useMemo(
    () => [
      "RAS//CORE v1.0 — IEEE ROBOTICS & AUTOMATION SOCIETY",
      `MOUNTING KNOWLEDGE BASE .......... ${graph.docs} DOCS / ${graph.nodes.length} CHUNKS`,
      `VECTOR SPACE ..................... ${graph.dense ? "GEMINI 768-D" : "TF-IDF"} → PCA(3) PROJECTION`,
      `RETRIEVER ........................ ${graph.dense ? "HYBRID [DENSE ⊕ BM25] → RRF" : "BM25 → RRF"}`,
      "AGENT RUNTIME .................... GEMINI FUNCTION CALLING // REACT LOOP",
      "TOOLS ............................ SEARCH · READ_DOC · LIST · CLOCK · DAYS",
      "SOURCE GROUNDING ................. ARMED",
      "HALLUCINATION DAMPERS ............ ARMED",
      "ALL SYSTEMS NOMINAL. AWAITING OPERATOR.",
    ],
    [],
  );

  // hover tooltip follows the node without re-rendering every frame
  const onHover = useCallback((node: GraphNode | null, x: number, y: number) => {
    if (tipRef.current && node) tipRef.current.style.transform = `translate(${x + 14}px, ${y - 12}px)`;
    setHoverNode((prev) => (prev?.id === node?.id ? prev : node));
  }, []);
  useEffect(() => { if (hoverNode) sound.hover(); }, [hoverNode]);

  const onSelect = useCallback((node: GraphNode) => { sound.tick(); setInspect({ node }); }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) { e.preventDefault(); inputRef.current?.focus(); }
      if (e.key === "Escape") setInspect(null);
      const typing = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement;
      if (!typing && (e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey) toggleInternals();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleInternals]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    if (/amaze/i.test(q)) { sound.amaze(); setAmaze((a) => a + 1); }
    sound.send();
    const history = messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    const userMsg: ChatMessage = { id: uid(), role: "user", content: q };
    const botId = uid();
    setMessages((m) => [...m, userMsg, { id: botId, role: "assistant", content: "", streaming: true }]);
    setInput("");
    setBusy(true);
    setStage("search");
    setTimings({});
    setActive([]);
    const t0 = performance.now();
    let firstToken = 0;
    const patch = (p: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
      setMessages((ms) => ms.map((m) => (m.id === botId ? { ...m, ...(typeof p === "function" ? p(m) : p) } : m)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...history, { role: "user", content: q }] }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || "Request failed");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.t === "meta") { setMode(ev.mode); setStage("search"); }
          else if (ev.t === "step") {
            sound.tick();
            const step: AgentStep = { id: ev.id, name: ev.name, label: ev.label, status: "running" };
            patch((m) => ({ steps: [...(m.steps || []), step] }));
          } else if (ev.t === "step_done") {
            patch((m) => ({ steps: (m.steps || []).map((st) => (st.id === ev.id ? { ...st, status: "done", summary: ev.summary, ms: ev.ms } : st)) }));
          } else if (ev.t === "thinking") {
            patch({ thinking: ev.text });
          } else if (ev.t === "retrieval") {
            const hits: Hit[] = ev.hits;
            patch((m) => {
              const merged = [...(m.hits || [])];
              hits.forEach((h) => { if (!merged.some((x) => x.id === h.id)) merged.push(h); });
              return { hits: merged.sort((a, b) => a.n - b.n) };
            });
            if (hits.length) {
              setActive(hits.map((h) => ({ id: h.id, n: h.n, fused: h.scores.fused })));
              setQueryKey((k) => k + 1);
              setFlash((f) => f + 1);
              sound.retrieval(hits.length);
            }
          } else if (ev.t === "sources") {
            patch({ hits: ev.hits });
          } else if (ev.t === "token") {
            if (!firstToken) { firstToken = performance.now() - t0; setStage("generate"); setTimings((t) => ({ ...t, firstToken: Math.round(firstToken) })); }
            patch((m) => ({ content: m.content + ev.v }));
          } else if (ev.t === "done") {
            patch({ streaming: false, model: ev.model });
            setTimings((t) => ({ ...t, total: Math.round(performance.now() - t0) }));
            setStage("done");
          } else if (ev.t === "error") throw new Error(ev.message);
        }
      }
      patch({ streaming: false });
    } catch (e) {
      sound.error();
      setStage("error");
      patch({ streaming: false, error: e instanceof Error ? e.message : "Connection lost" });
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    type SR = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void };
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { alert("Voice input needs Chrome or Edge."); return; }
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.onresult = (e) => setInput(Array.from(e.results).map((r) => r[0].transcript).join(""));
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  const citeProps = (hits: Hit[] = []) => ({
    maxCite: hits.length,
    onCiteEnter: (n: number) => setFocusId(hits[n - 1]?.id ?? null),
    onCiteLeave: () => setFocusId(null),
    onCiteClick: (n: number) => hits[n - 1] && setInspect({ hit: hits[n - 1] }),
  });

  const lastBot = [...messages].reverse().find((m) => m.role === "assistant");
  const traceSteps = lastBot?.steps || [];
  const empty = messages.length === 0;
  const inspectNode = inspect?.node;
  const inspectHit = inspect?.hit;
  const inspectData = inspectHit || (inspectNode && lastHits.find((h) => h.id === inspectNode.id));

  return (
    <div className={`app ${entered ? "is-entered" : ""} ${busy ? "is-busy" : ""}`}>
      <Constellation graph={graph} active={active} queryKey={queryKey} scanning={busy && stage !== "generate"} focusId={focusId || hoverNode?.id || null} onHover={onHover} onSelect={onSelect} />
      <div className="vignette" />
      <div className="scanlines" />
      {flash > 0 && <div key={`flash-${flash}`} className="flash" />}
      <Cursor />

      <div ref={tipRef} className={`tip ${hoverNode ? "is-on" : ""}`}>
        {hoverNode && (
          <>
            <span className="tip__dot" style={{ background: colorFor(hoverNode.category) }} />
            <b>{hoverNode.heading}</b>
            <small>{hoverNode.title}</small>
            <em>click to inspect</em>
          </>
        )}
      </div>

      {amaze > 0 && <div key={`amaze-${amaze}`} className="amaze">amaze! amaze! amaze!</div>}

      <header className="topbar">
        <button className="brand" onClick={() => { sound.tick(); setMessages([]); setActive([]); setStage("idle"); setTimings({}); }} aria-label="Reset conversation">
          <span className="brand__name">IEEE RAS <span className="brand__slash">//</span> CORE</span>
          <span className="brand__sub">ROBOTICS &amp; AUTOMATION SOCIETY</span>
        </button>
        <div className="topbar__status">
          <span className="chip hide-sm"><i className={`led ${busy ? "led--busy" : ""}`} /> {busy ? "PROCESSING" : "ONLINE"}</span>
          <span className="chip hide-sm">AGENT · {(mode || (graph.dense ? "hybrid" : "keyword")).toUpperCase()}</span>
          <span className="chip hide-sm">NODES: {graph.nodes.length}</span>
          <span className="chip hide-md">IST {clock}</span>
          <button className={`chip chip--btn hide-mobile ${showInternals ? "is-on" : ""}`} onClick={toggleInternals} aria-pressed={showInternals} title="Show or hide the Agent Trace and Retrieved Context panels (shortcut: I)">
            {showInternals ? "◧ HIDE INTERNALS" : "◨ SHOW INTERNALS"}
          </button>
          <button className={`chip chip--btn ${soundOn ? "is-on" : ""}`} onClick={() => sound.toggle()} aria-label="Toggle sound">
            <span className="eq"><i /><i /><i /><i /></span> {soundOn ? "SOUND ON" : "SOUND OFF"}
          </button>
        </div>
      </header>

      <main className="stage">
        <section className="left">
          <div className={`hero ${empty ? "" : "is-compact"}`}>
            <div className="hero__tag"><i className="led" /> AUTONOMOUS RAG AGENT · 2026–27</div>
            <h2 className="hero__title">
              <span>ASK THE</span>
              <span className="hero__outline">KNOWLEDGE</span>
              <span>CORE<span className="hero__dot">.</span></span>
            </h2>
            <p className="hero__lede">
              An autonomous AI agent for IEEE RAS. It <b>plans</b>, picks its own tools, searches the knowledge base as many times as it needs, checks dates and does the math, then answers <b>only</b> from what it found and shows its sources. Every star behind this text is a passage it can reach. Watch them ignite as it works.
            </p>
            <div className="legend">
              {Object.entries(CATEGORY_COLORS).map(([k, c]) => (
                <span key={k}><i style={{ background: c, boxShadow: `0 0 8px ${c}` }} />{k}</span>
              ))}
            </div>
          </div>

          {!empty && <div className={`left__panels ${showInternals ? "" : "is-hidden"}`} aria-hidden={!showInternals}>
          <div className="panel trace">
            <div className="panel__head">
              <span>AGENT TRACE</span>
              <span className="panel__head-right">
                {traceSteps.length} tool call{traceSteps.length === 1 ? "" : "s"}{timings.total ? ` · ${(timings.total / 1000).toFixed(1)} s` : busy ? " · running…" : ""}
                <button className="hide-btn" onClick={toggleInternals} title="Hide panels (I)" aria-label="Hide agent internals">HIDE ✕</button>
              </span>
            </div>
            <ol className="trace__steps">
              <li className="is-done"><span className="trace__icon">◇</span><span className="trace__label">Plan: read the question, choose tools</span><span className="trace__ms" /></li>
              {traceSteps.map((st) => (
                <li key={st.id} className={st.status === "running" ? "is-active" : "is-done"}>
                  <span className="trace__icon">{TOOL_ICON[st.name] || "•"}</span>
                  <span className="trace__label">{st.label}{st.summary && <em> → {st.summary}</em>}</span>
                  <span className="trace__ms">{st.ms !== undefined ? `${st.ms} ms` : ""}</span>
                </li>
              ))}
              {(stage === "generate" || stage === "done") && (
                <li className={stage === "done" ? "is-done" : "is-active"}><span className="trace__icon">✎</span><span className="trace__label">Compose a grounded answer</span><span className="trace__ms">{stage === "done" && lastBot?.model ? lastBot.model : ""}</span></li>
              )}
              {busy && stage === "search" && <li className="is-active is-pending"><span className="trace__icon">…</span><span className="trace__label">Agent is deciding its next action</span><span className="trace__ms" /></li>}
              {stage === "error" && <li className="is-error"><span className="trace__icon">!</span><span className="trace__label">Run failed</span><span className="trace__ms" /></li>}
            </ol>
          </div>

          <div className={`panel sources ${lastHits.length ? "" : "is-hidden"}`}>
            <div className="panel__head"><span>RETRIEVED CONTEXT</span><span>top {lastHits.length} of {graph.nodes.length}</span></div>
            <div className="sources__list">
              {lastHits.map((h) => (
                <button key={h.id} className={`source ${focusId === h.id ? "is-focus" : ""}`} onMouseEnter={() => setFocusId(h.id)} onMouseLeave={() => setFocusId(null)} onClick={() => setInspect({ hit: h })}>
                  <span className="source__n">{h.n}</span>
                  <span className="source__body">
                    <span className="source__title"><i style={{ background: colorFor(h.category) }} />{h.heading}</span>
                    <span className="source__doc">{h.title}</span>
                    <span className="bars">
                      {h.scores.dense !== null && <span className="bar"><em>DENSE</em><span><i style={{ width: `${Math.max(4, h.scores.dense * 100)}%` }} /></span><b>{h.scores.dense.toFixed(2)}</b></span>}
                      <span className="bar"><em>BM25</em><span><i style={{ width: `${Math.max(4, h.scores.bm25 * 100)}%` }} /></span><b>{h.scores.bm25.toFixed(2)}</b></span>
                      <span className="bar bar--fused"><em>FUSED</em><span><i style={{ width: `${Math.max(4, h.scores.fused * 100)}%` }} /></span><b>{h.scores.fused.toFixed(2)}</b></span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          </div>}
          {!empty && !showInternals && (
            <button className="internals-pill" onClick={toggleInternals} title="Show agent internals (I)">
              <i className={`led ${busy ? "led--busy" : ""}`} /> SHOW AGENT INTERNALS
              {traceSteps.length > 0 && <span>{traceSteps.length} tool call{traceSteps.length === 1 ? "" : "s"} · {lastHits.length} sources</span>}
            </button>
          )}
        </section>

        <section className="chat panel panel--glass" aria-label="Chat">
          <span className="corner corner--tl" /><span className="corner corner--tr" /><span className="corner corner--bl" /><span className="corner corner--br" />
          <div className="panel__head"><span><i className="led" /> SECURE CHANNEL // RAS-CORE</span><span>{messages.filter((m) => m.role === "user").length} QUERIES</span></div>

          <div className="messages" ref={listRef}>
            {empty && (
              <div className="welcome">
                <p className="welcome__hi">Hello, operator. I&apos;m <b>RAS CORE</b>, an AI agent for the IEEE Robotics &amp; Automation Society.</p>
                <p className="welcome__sub">Give me a task. I plan, choose tools (search, read, clock, calculator), gather evidence and answer only from verified public sources, showing where each answer came from. Try one:</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={s} className="suggestion" style={{ animationDelay: `${0.08 * i}s` }} onClick={() => ask(s)} onMouseEnter={() => sound.hover()}>
                      <span>{String(i + 1).padStart(2, "0")}</span>{s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`msg msg--${m.role}`}>
                <div className="msg__meta">{m.role === "user" ? "YOU" : "RAS CORE"}{m.model && <span> · {m.model}</span>}</div>
                <div className="msg__body">
                  {m.role === "assistant" ? (
                    <>
                      {!!m.steps?.length && (() => {
                        const steps = m.steps!;
                        const running = steps.find((st) => st.status === "running");
                        const open = openLogs.has(m.id);
                        const ms = steps.reduce((a, st) => a + (st.ms || 0), 0);
                        const kinds = [...new Set(steps.map((st) => st.name.replace(/_/g, " ")))];
                        return (
                          <div className={`agentlog ${open ? "is-open" : ""} ${running ? "is-live" : ""}`}>
                            <button className="agentlog__summary" onClick={() => toggleLog(m.id)} aria-expanded={open}>
                              <span className="agentlog__chev">{open ? "▾" : "▸"}</span>
                              {running ? (
                                <><span className="agentlog__icon">{TOOL_ICON[running.name] || "•"}</span><span className="agentlog__live">{running.label}</span></>
                              ) : (
                                <span>Used {steps.length} tool{steps.length === 1 ? "" : "s"}<span className="agentlog__sum"> {kinds.join(" · ")}{ms ? ` · ${ms} ms` : ""}</span></span>
                              )}
                            </button>
                            {open && (
                              <div className="agentlog__steps">
                                {steps.map((st) => (
                                  <div key={st.id} className={`agentlog__step ${st.status === "running" ? "is-running" : ""}`}>
                                    <span className="agentlog__icon">{TOOL_ICON[st.name] || "•"}</span>
                                    <span>{st.label}</span>
                                    {st.summary && <span className="agentlog__sum agentlog__sum--arrow">{st.summary}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {m.content ? <Markdown text={m.content} {...citeProps(m.hits)} /> : !m.error && <div className="thinking"><i /><i /><i /> {m.steps?.some((st) => st.status === "running") ? "using tools" : m.steps?.length ? "reasoning" : "planning"}</div>}
                      {m.streaming && m.content && <span className="caret" />}
                      {m.error && <div className="msg__error">⚠ {m.error}</div>}
                    </>
                  ) : (
                    <p>{m.content}</p>
                  )}
                </div>
                {m.role === "assistant" && !!m.hits?.length && !m.streaming && (
                  <div className="msg__sources">
                    {m.hits.map((h) => (
                      <button key={h.id} onMouseEnter={() => setFocusId(h.id)} onMouseLeave={() => setFocusId(null)} onClick={() => setInspect({ hit: h })}>
                        {h.heading}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              maxLength={600}
              placeholder={busy ? "Agent working…" : "Give RAS CORE a question or task…"}
              onChange={(e) => { setInput(e.target.value); sound.tick(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
              aria-label="Your question"
            />
            <button type="button" className={`icon-btn ${listening ? "is-on" : ""}`} onClick={toggleMic} aria-label="Voice input" title="Voice input">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </button>
            <button type="submit" className="send" disabled={busy || !input.trim()}>
              <span>{busy ? "…" : "TRANSMIT"}</span>
            </button>
          </form>
        </section>
      </main>

      <footer className="ticker" aria-hidden="true">
        <div className="ticker__track">
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k}>
              IEEE RAS // RAS CORE // AUTONOMOUS RAG AGENT // 5 TOOLS // {graph.nodes.length} KNOWLEDGE NODES ONLINE // HYBRID SEARCH: DENSE ⊕ BM25 → RRF // EVERY ANSWER SOURCED // ICRA 2027 · SEOUL // IROS 2026 · PITTSBURGH // BUILD THE FUTURE //&nbsp;
            </span>
          ))}
        </div>
      </footer>

      {inspect && (inspectData || inspectNode) && (
        <div className="inspector" role="dialog" aria-label="Knowledge node" onClick={() => setInspect(null)}>
          <div className="inspector__card" onClick={(e) => e.stopPropagation()}>
            <span className="corner corner--tl" /><span className="corner corner--tr" /><span className="corner corner--bl" /><span className="corner corner--br" />
            <div className="panel__head">
              <span><i className="led" style={{ background: colorFor((inspectData || inspectNode)!.category) }} /> KNOWLEDGE NODE {inspectData && "n" in inspectData ? `· SOURCE [${inspectData.n}]` : ""}</span>
              <button className="x" onClick={() => setInspect(null)} aria-label="Close">✕</button>
            </div>
            <p className="inspector__cat">{(inspectData || inspectNode)!.category}</p>
            <h3>{(inspectData || inspectNode)!.heading}</h3>
            <p className="inspector__doc">{(inspectData || inspectNode)!.title}</p>
            <NodeText id={(inspectData || inspectNode)!.id} fallback={inspectData?.text} />
          </div>
        </div>
      )}

      {!entered && <BootSequence lines={bootLines} onEnter={(s) => { setEntered(true); if (s) setSoundOn(true); setTimeout(() => inputRef.current?.focus(), 300); }} />}
    </div>
  );
}

// Loads full node text + source links on demand (keeps the client bundle small).
function NodeText({ id, fallback }: { id: string; fallback?: string }) {
  const [data, setData] = useState<{ text: string; sources: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/node?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((d) => alive && setData(d)).catch(() => {});
    return () => { alive = false; };
  }, [id]);
  const text = data?.text || fallback || "Loading…";
  return (
    <>
      <div className="inspector__text">{text.split(/\n\n+/).map((p, i) => <p key={i}>{p}</p>)}</div>
      {!!data?.sources?.length && (
        <div className="inspector__sources">
          <span>PUBLIC SOURCES</span>
          {data.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer">{s.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} ↗</a>)}
        </div>
      )}
    </>
  );
}
