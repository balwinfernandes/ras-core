"use client";
// Compact targeting-reticle cursor (desktop only). Replaces the system pointer.
import { useEffect, useRef } from "react";

export default function Cursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const target = { x: -100, y: -100 }, cur = { x: -100, y: -100 };
    let hot = false, down = false, raf = 0, shown = false;
    const move = (e: PointerEvent) => {
      target.x = e.clientX; target.y = e.clientY;
      if (!shown) { cur.x = target.x; cur.y = target.y; shown = true; }
      hot = !!(e.target as HTMLElement)?.closest?.("a, button, textarea, input, summary, [data-hot]");
      document.documentElement.classList.add("has-cursor");
    };
    const leave = () => document.documentElement.classList.remove("has-cursor");
    const onDown = () => (down = true);
    const onUp = () => (down = false);
    const loop = () => {
      cur.x = target.x; // pinned exactly to the pointer (no lag)
      cur.y = target.y;
      const el = ref.current;
      if (el) {
        el.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
        el.classList.toggle("is-hot", hot);
        el.classList.toggle("is-down", down);
      }
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.addEventListener("pointerleave", leave);
    loop();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <div className="cursor" aria-hidden="true">
      <div ref={ref} className="reticle">
        <svg viewBox="0 0 40 40" width="40" height="40">
          <g className="reticle__ring">
            <circle cx="20" cy="20" r="15" />
            {/* inward double ticks at N / E / S / W */}
            <path d="M18 5.5v3.5M22 5.5v3.5M18 31v3.5M22 31v3.5M5.5 18h3.5M5.5 22h3.5M31 18h3.5M31 22h3.5" />
          </g>
          <path className="reticle__plus" d="M20 16.5v7M16.5 20h7" />
        </svg>
      </div>
    </div>
  );
}
