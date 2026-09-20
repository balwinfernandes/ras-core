"use client";
import { useEffect, useRef, useState } from "react";
import { sound } from "@/lib/sound";

type Props = { lines: string[]; onEnter: (withSound: boolean) => void };

const GLYPHS = "!<>-_\\/[]{}—=+*^?#01";

function useScramble(target: string, start: boolean, speed = 28) {
  const [out, setOut] = useState(target.replace(/\S/g, " "));
  useEffect(() => {
    if (!start) return;
    let frame = 0;
    const total = target.length * 3 + 10;
    const id = setInterval(() => {
      frame++;
      setOut(
        target
          .split("")
          .map((ch, i) => (ch === " " ? " " : frame > i * 3 + 6 ? ch : frame > i * 3 ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : " "))
          .join(""),
      );
      if (frame > total) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [target, start, speed]);
  return out;
}

export default function BootSequence({ lines, onEnter }: Props) {
  const [shown, setShown] = useState(0);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const fast = useRef(false);
  const title = useScramble("RAS CORE", shown >= lines.length);

  useEffect(() => {
    try { fast.current = sessionStorage.getItem("rascore-booted") === "1"; } catch { /* storage blocked */ }
    let i = 0;
    const next = () => {
      i++;
      setShown(i);
      if (i < lines.length) timer = setTimeout(next, fast.current ? 40 : 170 + Math.random() * 160);
      else timer = setTimeout(() => setReady(true), fast.current ? 200 : 900);
    };
    let timer = setTimeout(next, fast.current ? 50 : 500);
    return () => clearTimeout(timer);
  }, [lines.length]);

  const enter = (withSound: boolean) => {
    if (leaving) return;
    try { sessionStorage.setItem("rascore-booted", "1"); } catch { /* storage blocked */ }
    if (withSound) { sound.setMuted(false); sound.enter(); }
    setLeaving(true);
    setTimeout(() => onEnter(withSound), 900);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (ready && e.key === "Enter") enter(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={`boot ${leaving ? "boot--leaving" : ""}`} role="dialog" aria-label="Boot sequence">
      <div className="boot__grid" />
      <div className="boot__inner">
        <pre className="boot__log" aria-live="polite">
          {lines.slice(0, shown).map((l, i) => (
            <div key={i} className={`boot__line ${i === lines.length - 1 ? "boot__line--ok" : ""}`}>
              <span className="boot__prompt">&gt;</span> {l}
            </div>
          ))}
          {!ready && <span className="boot__caret">█</span>}
        </pre>
        <h1 className={`boot__title ${shown >= lines.length ? "is-on" : ""}`} data-text={title}>
          {title}
        </h1>
        <p className={`boot__sub ${ready ? "is-on" : ""}`}>RETRIEVAL-AUGMENTED INTELLIGENCE // IEEE ROBOTICS &amp; AUTOMATION SOCIETY</p>
        <div className={`boot__actions ${ready ? "is-on" : ""}`}>
          <button className="btn btn--primary" onClick={() => enter(true)} onMouseEnter={() => sound.hover()}>
            <span className="btn__corners" />
            <span className="btn__flip">
              <span>INITIALIZE</span>
              <span>amaze! amaze! amaze!</span>
            </span>
          </button>
          <button className="btn btn--ghost" onClick={() => enter(false)}>ENTER SILENTLY</button>
        </div>
        <p className={`boot__hint ${ready ? "is-on" : ""}`}>Press ENTER · sound recommended 🎧</p>
      </div>
      <div className="boot__flash" />
    </div>
  );
}
