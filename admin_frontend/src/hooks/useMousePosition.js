/**
 * Pointer plumbing for the cursor effects.
 *
 * useMousePosition(onMove?)
 *   Returns a REF holding { x, y, active, down, moved, target }. It is a ref on purpose: the
 *   cursor ring and line follower read it inside requestAnimationFrame loops, so tracking the
 *   mouse never triggers a React re-render.
 *
 * usePointerEffects()
 *   { active, capable }
 *   capable = a real mouse/trackpad is present and the user has not asked for reduced motion.
 *   active  = capable AND the "Cursor effects" toggle in the header is on.
 *   Every effect component checks `active`, so touch screens and reduced-motion users never
 *   pay for (or see) any of it.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";

export function useMousePosition(onMove) {
  const pos = useRef({ x: -200, y: -200, active: false, down: false, moved: 0, target: null });
  const cb = useRef(onMove);
  cb.current = onMove;

  useEffect(() => {
    const p = pos.current;

    const move = (e) => {
      if (e.pointerType === "touch") return;
      p.x = e.clientX;
      p.y = e.clientY;
      p.target = e.target;
      p.active = true;
      p.moved = performance.now();
      cb.current?.(p, e);
    };
    const down = () => (p.down = true);
    const up = () => (p.down = false);
    const leave = (e) => {
      if (!e.relatedTarget) p.active = false; // pointer left the browser window
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    document.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.documentElement.removeEventListener("pointerleave", leave);
      document.removeEventListener("mouseleave", leave);
    };
  }, []);

  return pos;
}

const FINE = "(any-hover: hover) and (any-pointer: fine)";
const REDUCED = "(prefers-reduced-motion: reduce)";

function detectCapable() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  // Testing override: open the console with ?cursor=on to ignore both checks.
  if (/[?&]cursor=on\b/.test(window.location.search)) return true;
  return window.matchMedia(FINE).matches && !window.matchMedia(REDUCED).matches;
}

export function usePointerEffects() {
  const enabled = useStore((s) => s.effects);
  const [capable, setCapable] = useState(detectCapable);

  useEffect(() => {
    const queries = [window.matchMedia(FINE), window.matchMedia(REDUCED)];
    const update = () => setCapable(detectCapable());
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);

  return { active: enabled && capable, capable };
}
