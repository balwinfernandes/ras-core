import { CHUNKS } from "@/lib/retrieval";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const c = CHUNKS.find((x) => x.id === id);
  if (!c) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ id: c.id, title: c.title, heading: c.heading, category: c.category, text: c.text, sources: c.sources });
}
