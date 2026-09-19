/**
 * Smooth cursor: a small dot that tracks the pointer tightly, plus a ring that trails it with
 * an eased lag. The system cursor is NOT hidden - staff work fast and need the real pointer -
 * so this is a companion, not a replacement.
 *
 *   over a button / link / [data-cursor]  -> ring grows and tints
 *   over a text field or textarea         -> ring fades out so it never covers the caret
 *   mouse button held                     -> ring squeezes
 *
 * Position is written straight to the elements' transform in requestAnimationFrame (no React
 * state), and the loop stops once both have caught up with a resting pointer.
 */
import { useEffect, useRef } from "react";
import { useMousePosition, usePointerEffects } from "../hooks/useMousePosition";

const DOT_EASE = 0.55;
const RING_EASE = 0.16;
const INTERACTIVE = "a, button, select, summary, label[for], [role='button'], [data-cursor]";
const TEXT_FIELD = "input:not([type='button']):not([type='submit']):not([type='checkbox']):not([type='radio']), textarea";

export default function CustomCursor() {
  const { active } = usePointerEffects();
  return active ? <Cursor /> : null;
}

function Cursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const wake = useRef(() => {});
  const mouse = useMousePosition((p) => wake.current(p));

  useEffect(() => {
    const dot = dotRef.current;
    const ring = ringRef.current;
    const d = { x: -200, y: -200 };
    const r = { x: -200, y: -200 };
    let raf = 0;
    let running = false;
    let seeded = false;

    const setMode = (target) => {
      const el = target instanceof Element ? target : null;
      const overText = !!el?.closest(TEXT_FIELD);
      const overInteractive = !overText && !!el?.closest(INTERACTIVE) && !el.closest(":disabled");
      ring.classList.toggle("is-text", overText);
      ring.classList.toggle("is-hover", overInteractive);
    };

    const frame = () => {
      const m = mouse.current;
      d.x += (m.x - d.x) * DOT_EASE;
      d.y += (m.y - d.y) * DOT_EASE;
      r.x += (m.x - r.x) * RING_EASE;
      r.y += (m.y - r.y) * RING_EASE;
      dot.style.transform = `translate3d(${d.x}px, ${d.y}px, 0)`;
      ring.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
      ring.classList.toggle("is-down", m.down);

      const settled = Math.abs(m.x - r.x) + Math.abs(m.y - r.y) < 0.2;
      if (settled && !m.down) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    wake.current = (m) => {
      if (!seeded) {
        seeded = true;
        d.x = r.x = m.x;
        d.y = r.y = m.y;
        dot.classList.remove("is-hidden");
        ring.classList.remove("is-hidden");
      }
      setMode(m.target);
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    const onDown = () => wake.current(mouse.current);
    const onLeave = () => {
      dot.classList.add("is-hidden");
      ring.classList.add("is-hidden");
      seeded = false;
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      wake.current = () => {};
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [mouse]);

  return (
    <>
      <div ref={ringRef} className="cursor-ring is-hidden" aria-hidden="true" />
      <div ref={dotRef} className="cursor-dot is-hidden" aria-hidden="true" />
    </>
  );
}
