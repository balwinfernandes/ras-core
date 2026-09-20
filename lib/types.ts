export type Hit = {
  n: number;
  id: string;
  title: string;
  heading: string;
  category: string;
  sources: string[];
  text: string;
  scores: { dense: number | null; bm25: number; fused: number };
};

export type AgentStep = { id: string; name: string; label: string; status: "running" | "done"; summary?: string; ms?: number };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  hits?: Hit[];
  model?: string;
  error?: string;
  streaming?: boolean;
  steps?: AgentStep[];
  thinking?: string;
};

export type Stage = "idle" | "embed" | "search" | "generate" | "done" | "error";

export type Timings = { embed?: number; search?: number; firstToken?: number; total?: number };

export type GraphNode = { id: string; title: string; heading: string; category: string; p: [number, number, number] };
export type Graph = { dense: boolean; docs: number; categories: string[]; nodes: GraphNode[]; edges: [number, number][] };

export const CATEGORY_COLORS: Record<string, string> = {
  Society: "#c9d3ff",
  "Publications & Standards": "#8b6cff",
  Conferences: "#ffb547",
  "Community & Awards": "#5ab8ff",
  "About This Assistant": "#ff6fae",
};
export const colorFor = (c: string) => CATEGORY_COLORS[c] || "#a8aebc";
