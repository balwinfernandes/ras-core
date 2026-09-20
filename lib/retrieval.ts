// Hybrid retrieval: dense (cosine on Gemini embeddings) + sparse (BM25), merged with Reciprocal Rank Fusion.
import index from "@/data/index.json";

export type Chunk = {
  id: string;
  doc: string;
  title: string;
  heading: string;
  category: string;
  sources: string[];
  text: string;
  embedding?: number[];
};

export type Hit = {
  n: number; // citation number [n]
  id: string;
  title: string;
  heading: string;
  category: string;
  sources: string[];
  text: string;
  scores: { dense: number | null; bm25: number; fused: number };
};

type Index = { embeddingModel: string | null; dims: number; chunks: Chunk[] };
const IDX = index as unknown as Index;
export const CHUNKS = IDX.chunks;
export const EMBED_MODEL = IDX.embeddingModel;
export const DENSE_READY = !!IDX.embeddingModel && CHUNKS.every((c) => Array.isArray(c.embedding));

const STOP = new Set(
  "a an the and or of to in on for with by at from as is are was were be been it its this that these those which who whom what how when where why can will would should could has have had do does did not no but if then than so such into over under about via per me my you your i tell give".split(" "),
);
export const tokenize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((t) => t.length > 1 && !STOP.has(t));

// ---- BM25 (built once per server instance) ----
const K1 = 1.4, B = 0.75;
const docTokens = CHUNKS.map((c) => tokenize(`${c.title} ${c.heading} ${c.heading} ${c.text}`));
const avgdl = docTokens.reduce((s, d) => s + d.length, 0) / Math.max(1, docTokens.length);
const df = new Map<string, number>();
docTokens.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
const tf = docTokens.map((d) => {
  const m = new Map<string, number>();
  d.forEach((t) => m.set(t, (m.get(t) || 0) + 1));
  return m;
});
const N = CHUNKS.length;

function bm25Scores(query: string): number[] {
  const q = [...new Set(tokenize(query))];
  return CHUNKS.map((_, i) => {
    let s = 0;
    for (const t of q) {
      const f = tf[i].get(t);
      if (!f) continue;
      const n = df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * docTokens[i].length) / avgdl)));
    }
    return s;
  });
}

const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const rankOf = (scores: number[]) => {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const rank = new Array(scores.length).fill(Infinity);
  order.forEach(([s, i], r) => (rank[i] = s > 0 ? r + 1 : Infinity));
  return rank;
};

export function hybridSearch(query: string, queryVec: number[] | null, k = 5, category?: string): Hit[] {
  const bm = bm25Scores(query);
  const bmMax = Math.max(...bm, 1e-9);
  const dense = queryVec && DENSE_READY ? CHUNKS.map((c) => dot(queryVec, c.embedding!)) : null;

  const bmRank = rankOf(bm);
  const denseRank = dense ? rankOf(dense.map((s) => s + 1)) : null; // shift so every chunk gets a rank
  const RRF_K = 60;
  const fused = CHUNKS.map((_, i) => {
    let s = 0;
    if (Number.isFinite(bmRank[i])) s += 1 / (RRF_K + bmRank[i]);
    if (denseRank && Number.isFinite(denseRank[i])) s += 1 / (RRF_K + denseRank[i]);
    return s;
  });

  let order = fused
    .map((s, i) => [s, i] as const)
    .filter(([s, i]) => s > 0 && (!category || CHUNKS[i].category === category))
    .sort((a, b) => b[0] - a[0]);
  // Relevance gate: keep a passage if its keywords matched, or if it is semantically
  // almost as close as the best passage. Stops weakly-related chunks slipping in.
  if (dense) {
    const best = Math.max(...dense);
    order = order.filter(([, i]) => bm[i] / bmMax > 0.15 || (dense[i] >= best - 0.06 && dense[i] > 0.5));
  }

  // Ranking uses RRF; the displayed "fused" score blends the normalised signals so the bars are readable.
  let dMin = 0, dMax = 1;
  if (dense) { dMin = Math.min(...dense); dMax = Math.max(...dense); }
  const blend = (i: number) => {
    const b = bm[i] / bmMax;
    if (!dense) return b;
    const d = (dense[i] - dMin) / (dMax - dMin || 1);
    return 0.6 * d + 0.4 * b;
  };
  const top = order.slice(0, k);
  const blendMax = Math.max(...top.map(([, i]) => blend(i)), 1e-9);

  return top.map(([, i], r) => ({
    n: r + 1,
    id: CHUNKS[i].id,
    title: CHUNKS[i].title,
    heading: CHUNKS[i].heading,
    category: CHUNKS[i].category,
    sources: CHUNKS[i].sources,
    text: CHUNKS[i].text,
    scores: {
      dense: dense ? Math.round(dense[i] * 1000) / 1000 : null,
      bm25: Math.round((bm[i] / bmMax) * 1000) / 1000,
      fused: Math.round((blend(i) / blendMax) * 1000) / 1000,
    },
  }));
}
