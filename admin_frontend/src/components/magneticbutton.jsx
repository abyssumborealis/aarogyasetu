/**
 * Magnetic button: as the pointer comes within `radius` px of the button it leans toward it, and
 * the label leans a little further for depth. Springs back when the pointer leaves.
 *
 *   <MagneticButton className="btn btn-primary" onClick={...}>Call next patient</MagneticButton>
 *   <MagneticButton as="a" href="#/queue" className="btn btn-secondary">Open queue</MagneticButton>
 *
 * Use it on primary actions only. It renders a plain element when effects are off, and a disabled
 * button never moves.
 */
import { useEffect, useRef } from "react";
import { usePointerEffects } from "../hooks/useMouseposition";

const MAX_PULL = 9; // px

export default function MagneticButton({
  as: Tag = "button",
  strength = 0.32,
  radius = 70,
  className = "",
  children,
  ...rest
}) {
  const ref = useRef(null);
  const labelRef = useRef(null);
  const { active } = usePointerEffects();

  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    const label = labelRef.current;
    let pulled = false;

    const release = () => {
      if (!pulled) return;
      pulled = false;
      el.classList.remove("is-pulling");
      el.style.transform = "";
      label.style.transform = "";
    };

    const onMove = (e) => {
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return release();
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const reachX = r.width / 2 + radius;
      const reachY = r.height / 2 + radius;
      if (Math.abs(dx) > reachX || Math.abs(dy) > reachY) return release();

      const clamp = (v) => Math.max(-MAX_PULL, Math.min(MAX_PULL, v));
      pulled = true;
      el.classList.add("is-pulling");
      el.style.transform = `translate3d(${clamp(dx * strength)}px, ${clamp(dy * strength)}px, 0)`;
      label.style.transform = `translate3d(${clamp(dx * strength * 0.45)}px, ${clamp(dy * strength * 0.45)}px, 0)`;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", release);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", release);
      release();
    };
  }, [active, strength, radius]);

  return (
    <Tag ref={ref} className={`magnetic ${className}`} {...rest}>
      <span ref={labelRef} className="magnetic-label">
        {children}
      </span>
    </Tag>
  );
}
