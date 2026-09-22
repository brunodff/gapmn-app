import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type SparklesProps = {
  id?: string;
  className?: string;
  background?: string;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  particleColor?: string;
  particleDensity?: number;
};

export const SparklesCore = ({
  className,
  background = "transparent",
  minSize = 0.4,
  maxSize = 1.4,
  speed = 1,
  particleColor = "#ffffff",
  particleDensity = 80,
}: SparklesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Captura em const para o TS não perder o narrowing dentro das closures
    const c = canvas;
    const x = ctx;
    let animId: number;

    function hexToRgb(hex: string): [number, number, number] {
      const clean = hex.replace("#", "");
      const num = parseInt(clean.length === 3
        ? clean.split("").map(ch => ch + ch).join("")
        : clean, 16);
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }
    const [r, g, b] = hexToRgb(particleColor);

    interface Particle {
      x: number; y: number;
      vx: number; vy: number;
      size: number;
      opacity: number;
      opacitySpeed: number;
      opacityDir: number;
    }

    let particles: Particle[] = [];

    function resize() {
      c.width  = c.offsetWidth;
      c.height = c.offsetHeight;
      const count = Math.floor((c.width * c.height) / (8000 / particleDensity * 10));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * c.width,
        y: Math.random() * c.height,
        vx: (Math.random() - 0.5) * speed * 0.4,
        vy: (Math.random() - 0.5) * speed * 0.4,
        size: minSize + Math.random() * (maxSize - minSize),
        opacity: Math.random(),
        opacitySpeed: 0.005 + Math.random() * 0.01 * speed,
        opacityDir: Math.random() > 0.5 ? 1 : -1,
      }));
    }

    function draw() {
      x.clearRect(0, 0, c.width, c.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = c.width;
        if (p.x > c.width) p.x = 0;
        if (p.y < 0) p.y = c.height;
        if (p.y > c.height) p.y = 0;
        p.opacity += p.opacitySpeed * p.opacityDir;
        if (p.opacity >= 1) { p.opacity = 1; p.opacityDir = -1; }
        if (p.opacity <= 0.05) { p.opacity = 0.05; p.opacityDir = 1; }
        x.beginPath();
        x.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        x.fillStyle = `rgba(${r},${g},${b},${p.opacity})`;
        x.fill();
      }
      animId = requestAnimationFrame(draw);
    }

    resize();
    draw();

    const ro = new ResizeObserver(resize);
    ro.observe(c);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [minSize, maxSize, speed, particleColor, particleDensity]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("w-full h-full", className)}
      style={{ background, display: "block" }}
    />
  );
};
