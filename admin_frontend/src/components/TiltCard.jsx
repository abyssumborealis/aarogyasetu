/**
 * Tilt card: leans toward the pointer in 3D (a few degrees only - the card holds live queue
 * numbers and buttons, so it must stay readable) and shows a soft highlight that follows the
 * pointer. Tilt is driven by CSS variables (--rx --ry --gx --gy) so the browser does the work.
 *
 *   <TiltCard className="department-card" maxTilt={4}> ... </TiltCard>
 */
import { useEffect, useRef } from "react";
import { usePointerEffects } from "../hooks/useMouseposition";

export default function TiltCard({
  as: Tag = "div",
  maxTilt = 4,
  glare = true,
  className = "",
  children,
  ...rest
}) {
  const ref = useRef(null);
  const { active } = usePointerEffects();

  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    let raf = 0;

    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.classList.add("is-tilting");
        el.style.setProperty("--ry", `${((px - 0.5) * 2 * maxTilt).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${(-(py - 0.5) * 2 * maxTilt).toFixed(2)}deg`);
        el.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.classList.remove("is-tilting");
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.classList.remove("is-tilting");
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
    };
  }, [active, maxTilt]);

  return (
    <Tag ref={ref} className={`tilt-card ${className}`} {...rest}>
      {children}
      {glare && active && <span className="tilt-glare" aria-hidden="true" />}
    </Tag>
  );
}
