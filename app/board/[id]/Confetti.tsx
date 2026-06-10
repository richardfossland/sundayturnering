"use client";

import { useEffect, useRef } from "react";

// Lightweight canvas confetti for the champion screen. Runs ~10s then stops.
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const colors = ["#ebb84b", "#e0524b", "#2e7cf6", "#36b37e", "#9b59d0", "#f6dd97", "#e8853a"];
    const parts = Array.from({ length: 170 }, () => ({
      x: Math.random() * W,
      y: Math.random() * -H,
      r: 6 + Math.random() * 8,
      c: colors[Math.floor(Math.random() * colors.length)],
      vy: 2 + Math.random() * 4,
      vx: -1.5 + Math.random() * 3,
      rot: Math.random() * 6.28,
      vr: -0.2 + Math.random() * 0.4,
    }));
    let raf = 0;
    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.y += p.vy;
        p.x += p.vx;
        p.rot += p.vr;
        if (p.y > H + 20) {
          p.y = -10;
          p.x = Math.random() * W;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      }
      frame++;
      if (frame < 620) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}
