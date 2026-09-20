# Submission text (paste into the AI/ML department form)

DEPLOYED APP: https://<your-project>.vercel.app
GITHUB REPO:  https://github.com/<your-username>/ras-core

RAS CORE is an autonomous RAG agent for the IEEE Robotics and Automation Society, built with Next.js and Gemini function calling and deployed on Vercel.
- Agent: for each request, Gemini runs a plan → act → observe loop (up to 6 rounds) and chooses between 5 tools: search_knowledge_base (hybrid search), get_document, list_topics, get_current_datetime and days_between. It searches multiple times with refined queries, compares items with separate searches, and handles date and deadline questions with the clock and day-count tools.
- Knowledge base: 9 curated Markdown documents of public information about the global IEEE RAS (ieee-ras.org, the RAS standards committee, and the ICRA/IROS/CASE conference sites), split into section-aware chunks with source URLs, embedded with gemini-embedding-001 (768-D, cached by content hash).
- Retrieval: dense cosine similarity plus BM25, fused with Reciprocal Rank Fusion, with a relevance gate against weak matches.
- Grounding: every retrieved passage gets a global source number. The final answer may use only tool results and must cite [n]; otherwise it says it doesn't know. It falls back to another model automatically, and to keyword-only mode if no key is set.
- UI: a live Agent Trace showing every tool call with its arguments, result and timing, and a 3D "knowledge constellation" (Three.js with custom shaders) where each search fires beams to the retrieved passages. It also has citation-linked source cards with score bars, voice input and sound design.
