# RAS CORE — IEEE RAS RAG Agent

An **autonomous, tool-using RAG agent** for the **IEEE Robotics & Automation Society (IEEE RAS)**, built for the IEEE RAS VIT Chennai AI/ML recruitment task. It doesn't just run one fixed retrieve-then-answer step. For every request, the agent (Gemini function calling) **plans, chooses its own tools, searches as many times as it needs, checks dates and does calculations**, and only then writes an answer. That answer is grounded strictly in public sources and cited.

It also **visualises the agent at work in 3D**. Every glowing star is a knowledge chunk, and each time the agent searches, a query drops into vector space and beams fire to the passages it retrieved.

![stack](https://img.shields.io/badge/Next.js-16-black) ![three](https://img.shields.io/badge/Three.js-WebGL-2ef2c9) ![gemini](https://img.shields.io/badge/Gemini-function%20calling-8b6cff)

## What makes it an agent

The server runs a plan → act → observe loop (up to 6 rounds) using Gemini function calling:

| Tool | What it does |
|---|---|
| `search_knowledge_base(query, category?)` | Hybrid search: dense (Gemini embeddings, cosine similarity) + BM25, fused with Reciprocal Rank Fusion. Called repeatedly with refined queries, or once per item for comparisons |
| `get_document(doc_id)` | Reads a whole document, for broad "tell me everything" requests |
| `list_topics()` | Discovers what the knowledge base contains |
| `get_current_datetime()` | Today's date and time in IST, for "upcoming", deadlines and countdowns |
| `days_between(start, end)` | Exact day counts |

Example: *"How many days until ICRA 2027 begins, and where is it?"* → the agent calls `get_current_datetime`, then `search_knowledge_base("ICRA 2027 dates location")`, then `days_between(today, 2027-05-24)`, and answers with citations.

Every passage the agent sees gets a global source number. The final answer may use only tool results and must cite them as `[n]`; if the evidence isn't there, it says so.

## Features

- **Live Agent Trace**: each tool call appears as it happens, with its arguments, result summary and timing. Each answer also carries a compact step log.
- **3D knowledge constellation** (Three.js with custom shaders): node positions come from a PCA projection of the embeddings, so similar passages cluster together. Every search fires a shockwave and beams to the retrieved nodes.
- **Retrieved context panel** with dense, BM25 and fused score bars. Hovering a citation highlights the passage in 3D; clicking it opens the full passage with its public source links.
- **Robust**: automatic Gemini model fallback, a relevance gate on retrieval, a rate limit, and an offline keyword-only mode when no API key is set.
- Boot sequence, procedural Web Audio sound design, voice input (Chrome/Edge), keyboard shortcuts (`/` to focus, `Esc` to close), responsive mobile layout, and self-hosted fonts.
- Easter egg: type **amaze** 🎵

## How it works

```
knowledge/*.md ─► scripts/ingest.mjs ─► data/index.json (chunks + 768-D embeddings)
                  chunk → embed → PCA    data/graph.json (3D layout + similarity edges)

user task ─► /api/chat ─► AGENT LOOP (lib/agent.ts, Gemini function calling)
                            ├─ model: "I need X" ─► tool call ─► result ─┐
                            │     (search / read doc / list / clock / days)│
                            └──────────────── repeat ≤ 6 rounds ◄──────────┘
                            └─ final answer, only from tool results, cited [n]
          ◄─ NDJSON stream: {step} {retrieval} {step_done} … {token…} {done}
             → Agent Trace panel + 3D constellation + chat
```

| Path | What it does |
|---|---|
| `lib/agent.ts` | The agent: tool definitions, system prompt, tool execution, citation registry |
| `lib/retrieval.ts` | BM25, cosine search, Reciprocal Rank Fusion, relevance gate |
| `lib/gemini.ts` | Minimal Gemini REST client: embeddings and function calling with model fallback |
| `app/api/chat/route.ts` | Streams agent events to the browser; offline fallback |
| `scripts/ingest.mjs` | Chunks the docs, embeds them (cached by content hash), computes the 3D layout |
| `components/Constellation.tsx` | The Three.js scene |
| `components/RasCore.tsx` | Main UI: chat, agent trace, sources |

## Run locally

Requirements: **Node.js 20+** and a free **Gemini API key** from <https://aistudio.google.com/apikey>.

```bash
npm install
cp .env.example .env.local      # then paste your key into .env.local
npm run dev                     # open http://localhost:3000
```

`npm run dev` and `npm run build` automatically run the ingestion step first. With a key, it embeds the knowledge base once; embeddings are cached in `data/index.json` and only changed chunks are re-embedded.

## Add or update knowledge

Add a Markdown file to `knowledge/`:

```markdown
---
title: My Topic
category: Conferences
sources:
  - https://example.com/page
---

## A section heading

Paragraphs of facts…
```

Then run `npm run ingest`, or just restart `npm run dev`. The categories that have colours in the 3D view are `Society`, `Publications & Standards`, `Conferences`, `Community & Awards` and `About This Assistant`.

## Deploy (free) on Vercel

1. Push the project to GitHub (see below).
2. Sign in at <https://vercel.com> with your GitHub account → **Add New… → Project** → import the repository.
3. The framework preset (**Next.js**) is detected automatically. Open **Environment Variables** and add `GEMINI_API_KEY` = your key.
4. Click **Deploy**. You get a live URL like `https://ras-core.vercel.app`.
5. Every `git push` to `main` redeploys automatically.

## Environment variables

| Name | Required | Default |
|---|---|---|
| `GEMINI_API_KEY` | yes (for AI answers) | — |
| `GEMINI_MODEL` | no | tries `gemini-2.5-flash`, then newer flash models |
| `GEMINI_EMBED_MODEL` | no | `gemini-embedding-001` |

## Sources used for the knowledge base

ieee-ras.org (about, membership, chapters, executive committee, publications, conferences, technical committees, awards, educational activities), sagroups.ieee.org/ras-sc (standards), 2026.ieee-icra.org, 2027.ieee-icra.org, 2026.ieee-iros.org, 2026.ieeecase.org, Wikipedia (IROS, IEEE Transactions on Robotics).

## License

MIT
