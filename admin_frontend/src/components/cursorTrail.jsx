/**
 * Cursor line follower.
 *
 * A chain of points where the head eases toward the pointer and every following point eases
 * toward the one before it. Joined with smooth curves and tapered from head to tail, that reads
 * as a soft line trailing the mouse. It is drawn as ONE tapered, gradient-filled ribbon (blue -> teal,
 * from the design system's --primary and --teal), so there are no visible joints.
 *
 * Cost control: one canvas, one fill per frame, and the animation loop STOPS as soon as the
 * pointer is still and the line has settled, then wakes on the next pointer move.
 */
import { useEffect, useRef } from "react";
import { useMousePosition, usePointerEffects } from "../hooks/useMousePosition";

const POINTS = 26;
const MAX_WIDTH = 6.5;
const HEAD_EASE = 0.5;
const CHAIN_EASE = 0.36;
const HEAD_RGB = [25, 118, 210]; // --primary
const TAIL_RGB = [0, 137, 123]; // --teal

const mix = (a, b, t) => Math.round(a + (b - a) * t);

export default function CursorTrail() {
  const { active } = usePointerEffects();
  return active ? <Trail /> : null;
}

function Trail() {
  const canvasRef = useRef(null);
  const wake = useRef(() => {});
  const mouse = useMousePosition((p) => {
    if (!p.seeded) {
      p.seeded = true;
      wake.current(true);
    } else {
      wake.current(false);
    }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pts = Array.from({ length: POINTS }, () => ({ x: -200, y: -200 }));
    let raf = 0;
    let running = false;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };

    const step = () => {
      const m = mouse.current;
      const head = pts[0];
      head.x += (m.x - head.x) * HEAD_EASE;
      head.y += (m.y - head.y) * HEAD_EASE;

      let travel = 0;
      for (let i = 1; i < POINTS; i++) {
        const prev = pts[i - 1];
        const p = pts[i];
        p.x += (prev.x - p.x) * CHAIN_EASE;
        p.y += (prev.y - p.y) * CHAIN_EASE;
        travel += Math.abs(prev.x - p.x) + Math.abs(prev.y - p.y);
      }
      return travel + Math.abs(m.x - head.x) + Math.abs(m.y - head.y);
    };

    // Smooth closed path through a list of edge points (midpoint quadratic curves)
    const traceEdge = (edge, reverse) => {
      const list = reverse ? [...edge].reverse() : edge;
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i];
        const b = list[i + 1];
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      const last = list[list.length - 1];
      ctx.lineTo(last.x, last.y);
    };

    // One filled ribbon (not separate strokes) so there are no bead-like joints, and a single
    // gradient carries the fade and the blue -> teal shift from head to tail.
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const head = pts[0];
      const tail = pts[POINTS - 1];
      if (Math.abs(head.x - tail.x) + Math.abs(head.y - tail.y) < 1.5) return; // at rest

      const left = [];
      const right = [];
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < POINTS; i++) {
        const before = pts[Math.max(i - 1, 0)];
        const after = pts[Math.min(i + 1, POINTS - 1)];
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          nx = -dy / len;
          ny = dx / len;
        }
        const half = (MAX_WIDTH * (1 - i / (POINTS - 1)) ** 1.15) / 2;
        left.push({ x: pts[i].x + nx * half, y: pts[i].y + ny * half });
        right.push({ x: pts[i].x - nx * half, y: pts[i].y - ny * half });
      }

      const g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
      g.addColorStop(0, `rgba(${HEAD_RGB.join(",")}, 0.55)`);
      g.addColorStop(0.55, `rgba(${mix(HEAD_RGB[0], TAIL_RGB[0], 0.6)}, ${mix(HEAD_RGB[1], TAIL_RGB[1], 0.6)}, ${mix(HEAD_RGB[2], TAIL_RGB[2], 0.6)}, 0.28)`);
      g.addColorStop(1, `rgba(${TAIL_RGB.join(",")}, 0)`);
      ctx.fillStyle = g;

      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      traceEdge(left, false);
      traceEdge(right, true);
      ctx.closePath();
      ctx.fill();
    };

    const frame = () => {
      const remaining = step();
      draw();
      // Below ~3px of total travel the line is visually at rest, so stop the loop and clear
      if (remaining < 3 && performance.now() - mouse.current.moved > 250) {
        running = false;
        ctx.clearRect(0, 0, w, h);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    wake.current = (snap) => {
      if (snap) {
        const { x, y } = mouse.current;
        pts.forEach((p) => {
          p.x = x;
          p.y = y;
        });
      }
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      wake.current = () => {};
    };
  }, [mouse]);

  return <canvas ref={canvasRef} className="cursor-trail" aria-hidden="true" />;
}
