"use client";
// Tiny, safe Markdown renderer (no dangerouslySetInnerHTML) with interactive [n] citations.
import { Fragment, type ReactNode } from "react";

type CiteHandlers = {
  maxCite: number;
  onCiteEnter: (n: number) => void;
  onCiteLeave: () => void;
  onCiteClick: (n: number) => void;
};

function inline(text: string, h: CiteHandlers, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[\d+\]|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${k++}`;
    if (tok.startsWith("**")) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (/^\[\d+\]$/.test(tok)) {
      const n = Number(tok.slice(1, -1));
      if (n >= 1 && n <= h.maxCite)
        out.push(
          <button key={key} className="cite" onMouseEnter={() => h.onCiteEnter(n)} onMouseLeave={h.onCiteLeave} onFocus={() => h.onCiteEnter(n)} onBlur={h.onCiteLeave} onClick={() => h.onCiteClick(n)} aria-label={`Source ${n}`}>
            {n}
          </button>,
        );
    } else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      out.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer">{label}</a>);
    } else if (tok.startsWith("http")) out.push(<a key={key} href={tok} target="_blank" rel="noreferrer">{tok.replace(/^https?:\/\//, "")}</a>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Run = { kind: "p" | "ul" | "ol"; lines: string[] };

function runsOf(text: string): Run[] {
  const runs: Run[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { runs.push({ kind: "p", lines: [] }); continue; }
    const kind: Run["kind"] = /^\s*[-*•]\s+/.test(line) ? "ul" : /^\s*\d+[.)]\s+/.test(line) ? "ol" : "p";
    const prev = runs[runs.length - 1];
    if (prev && prev.kind === kind && (kind !== "p" || prev.lines.length)) prev.lines.push(line);
    else runs.push({ kind, lines: [line] });
  }
  return runs.filter((r) => r.lines.length);
}

export default function Markdown({ text: raw, ...h }: { text: string } & CiteHandlers) {
  // numbered source markers like [1] or [2][3] are not shown in the answer text
  const text = raw.replace(/\s*(\[\d+\])+/g, "");
  return (
    <>
      {runsOf(text).map((run, bi) => {
        if (run.kind !== "p") {
          const Tag = run.kind;
          return (
            <Tag key={bi}>
              {run.lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), h, `${bi}-${li}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={bi}>
            {run.lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ""), h, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
