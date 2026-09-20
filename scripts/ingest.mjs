// RAS CORE — knowledge ingestion
// Reads knowledge/*.md → chunks → (optional) Gemini embeddings → 3D layout
// Writes data/index.json (used by the API) and data/graph.json (used by the 3D scene).
// Runs automatically before `npm run dev` and `npm run build`.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge");
const DATA_DIR = path.join(ROOT, "data");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const GRAPH_FILE = path.join(DATA_DIR, "graph.json");

for (const f of [".env.local", ".env"]) {
  try { process.loadEnvFile(path.join(ROOT, f)); } catch { /* file not present */ }
}

const API_KEY = process.env.GEMINI_API_KEY || "";
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const EMBED_DIMS = 768;
const MAX_CHUNK_CHARS = 650;

const log = (...a) => console.log("\x1b[31m[ras-core]\x1b[0m", ...a);

// ---------- 1. parse markdown ----------
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = { title: "", category: "General", sources: [] };
  if (!m) return { meta, body: raw };
  let listKey = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { meta[listKey].push(item[1].trim()); continue; }
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      if (kv[2] === "") { listKey = kv[1]; meta[listKey] = []; }
      else { meta[kv[1]] = kv[2].trim(); listKey = null; }
    }
  }
  return { meta, body: raw.slice(m[0].length) };
}

function chunkDocument(file, meta, body) {
  const docId = path.basename(file, ".md");
  const sections = body.split(/^## /m).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  for (const section of sections) {
    const nl = section.indexOf("\n");
    const heading = nl === -1 ? section : section.slice(0, nl).trim();
    const content = nl === -1 ? "" : section.slice(nl + 1).trim();
    const paras = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      chunks.push({
        id: `${docId}#${chunks.length}`,
        doc: docId,
        title: meta.title,
        heading,
        category: meta.category,
        sources: meta.sources || [],
        text: buf.join("\n\n"),
      });
      buf = [];
    };
    for (const p of paras) {
      if (buf.length && buf.join("\n\n").length + p.length > MAX_CHUNK_CHARS) flush();
      buf.push(p);
    }
    flush();
  }
  return chunks;
}

// ---------- 2. embeddings (optional) ----------
const hashOf = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
const embedInput = (c) => `${c.title} — ${c.heading}\n${c.text}`;

function normalize(v) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => Math.round((x / n) * 1e6) / 1e6);
}

async function embedBatch(chunks) {
  const url = `${process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com"}/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({
      requests: chunks.map((c) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: embedInput(c) }] },
        taskType: "RETRIEVAL_DOCUMENT",
        title: c.title,
        outputDimensionality: EMBED_DIMS,
      })),
    }),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return json.embeddings.map((e) => normalize(e.values));
}

// ---------- 3. TF-IDF (fallback vectors for layout) ----------
const STOP = new Set("a an the and or of to in on for with by at from as is are was were be been it its this that these those which who whom what how when where why can will would should could has have had do does did not no but if then than so such into over under about via per".split(" "));
const tokenize = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((t) => t.length > 1 && !STOP.has(t));

function tfidfVectors(chunks) {
  const docs = chunks.map((c) => tokenize(embedInput(c)));
  const df = new Map();
  docs.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const vocab = [...df.keys()];
  const idx = new Map(vocab.map((t, i) => [t, i]));
  return docs.map((d) => {
    const v = new Array(vocab.length).fill(0);
    d.forEach((t) => (v[idx.get(t)] += 1));
    for (const [t, i] of idx) if (v[i]) v[i] = (v[i] / d.length) * Math.log(1 + chunks.length / df.get(t));
    return normalize(v);
  });
}

// ---------- 4. PCA → 3D layout ----------
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function pca3(vectors) {
  const n = vectors.length, d = vectors[0].length;
  const mean = new Array(d).fill(0);
  vectors.forEach((v) => v.forEach((x, i) => (mean[i] += x / n)));
  const X = vectors.map((v) => v.map((x, i) => x - mean[i]));
  const rand = seeded(42);
  const comps = [];
  for (let k = 0; k < 3; k++) {
    let w = Array.from({ length: d }, () => rand() - 0.5);
    for (let it = 0; it < 80; it++) {
      const Xw = X.map((row) => row.reduce((s, x, i) => s + x * w[i], 0));
      let nw = new Array(d).fill(0);
      X.forEach((row, r) => row.forEach((x, i) => (nw[i] += x * Xw[r])));
      for (const c of comps) {
        const dot = nw.reduce((s, x, i) => s + x * c[i], 0);
        nw = nw.map((x, i) => x - dot * c[i]);
      }
      const norm = Math.hypot(...nw) || 1;
      w = nw.map((x) => x / norm);
    }
    comps.push(w);
  }
  const P = X.map((row) => comps.map((c) => row.reduce((s, x, i) => s + x * c[i], 0)));
  // standardise each axis so the cloud is round, then scale
  for (let a = 0; a < 3; a++) {
    const std = Math.sqrt(P.reduce((s, p) => s + p[a] * p[a], 0) / n) || 1;
    P.forEach((p) => (p[a] = (p[a] / std) * 2.6));
  }
  const jitter = seeded(7);
  return P.map((p) => p.map((x) => Math.round((x + (jitter() - 0.5) * 0.35) * 1000) / 1000));
}

const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// ---------- main ----------
async function main() {
  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md")).sort();
  const chunks = files.flatMap((f) => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(KNOWLEDGE_DIR, f), "utf8"));
    return chunkDocument(f, meta, body);
  });
  // merge very small sections (e.g. a short list of links) into the previous chunk of the same document
  for (let i = chunks.length - 1; i > 0; i--) {
    const c = chunks[i], prev = chunks[i - 1];
    if (c.text.length < 200 && prev.doc === c.doc) {
      prev.text += `\n\n${c.heading}:\n${c.text}`;
      chunks.splice(i, 1);
    }
  }
  chunks.forEach((c, i) => (c.id = `${c.doc}#${i}`));
  log(`${files.length} documents → ${chunks.length} chunks`);

  // reuse embeddings from a previous run when the chunk text hasn't changed
  let previous = new Map();
  try {
    const old = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    if (old.embeddingModel === EMBED_MODEL) old.chunks.forEach((c) => c.embedding && previous.set(c.hash, c.embedding));
  } catch { /* first run */ }

  chunks.forEach((c) => (c.hash = hashOf(embedInput(c) + EMBED_MODEL)));
  chunks.forEach((c) => previous.has(c.hash) && (c.embedding = previous.get(c.hash)));

  let dense = chunks.every((c) => c.embedding);
  const missing = chunks.filter((c) => !c.embedding);
  if (missing.length && API_KEY) {
    try {
      log(`embedding ${missing.length} new chunks with ${EMBED_MODEL}…`);
      for (let i = 0; i < missing.length; i += 90) {
        const batch = missing.slice(i, i + 90);
        const vecs = await embedBatch(batch);
        batch.forEach((c, j) => (c.embedding = vecs[j]));
      }
      dense = true;
    } catch (e) {
      log(`⚠ embedding failed, falling back to keyword-only retrieval: ${e.message}`);
      dense = false;
    }
  } else if (missing.length) {
    log("⚠ GEMINI_API_KEY not set — building keyword-only (BM25) index. Add the key for semantic search.");
  } else {
    log("all embeddings reused from cache");
  }
  if (!dense) chunks.forEach((c) => delete c.embedding);

  const vectors = dense ? chunks.map((c) => c.embedding) : tfidfVectors(chunks);
  const coords = pca3(vectors);

  const edges = new Set();
  vectors.forEach((v, i) => {
    vectors
      .map((u, j) => [j, j === i ? -2 : cosine(v, u)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([j]) => edges.add(i < j ? `${i}-${j}` : `${j}-${i}`));
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify({
    version: 1,
    embeddingModel: dense ? EMBED_MODEL : null,
    dims: dense ? EMBED_DIMS : 0,
    chunks: chunks.map(({ id, doc, title, heading, category, sources, text, hash, embedding }) =>
      ({ id, doc, title, heading, category, sources, text, hash, ...(embedding ? { embedding } : {}) })),
  }));

  const categories = [...new Set(chunks.map((c) => c.category))];
  fs.writeFileSync(GRAPH_FILE, JSON.stringify({
    dense,
    docs: files.length,
    categories,
    nodes: chunks.map((c, i) => ({ id: c.id, title: c.title, heading: c.heading, category: c.category, p: coords[i] })),
    edges: [...edges].map((e) => e.split("-").map(Number)),
  }, null, 0));

  log(`wrote data/index.json (${dense ? "hybrid: dense + BM25" : "BM25 only"}) and data/graph.json (${edges.size} edges)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
