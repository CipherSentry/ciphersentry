import { useEffect, useRef } from "react";

/**
 * AsciiMotion — density field from docs/screenshots/ascii motion work.jpg
 *
 * Monospaced tonal masses (classic ramp: sparse → dense), slow organic drift,
 * soft shimmer. Variants:
 *   ambient — fixed full-viewport backdrop (z-0)
 *   figure  — portrait-mass panel (mecha-scale density of the reference)
 *   panel   — quieter fill for section wells / code shelves
 *   band    — horizontal strip accent
 *
 * prefers-reduced-motion freezes the field at t=0.
 */

const RAMP =
  " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

type Variant = "ambient" | "figure" | "panel" | "band";

const CELL: Record<Variant, { w: number; h: number }> = {
  ambient: { w: 8, h: 12 },
  figure: { w: 6, h: 10 },
  panel: { w: 7, h: 11 },
  band: { w: 7, h: 11 },
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves = 4) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += a * smoothNoise(x * f, y * f);
    a *= 0.5;
    f *= 2.05;
  }
  return v;
}

/**
 * Density functions echo the reference: concentrated mecha/figure mass,
 * mechanical plate structure mid-frame, sparse field at the edges.
 */
function densityAt(nx: number, ny: number, t: number, variant: Variant) {
  const ox = t * (variant === "ambient" ? 0.02 : 0.028);
  const oy = t * (variant === "ambient" ? 0.014 : 0.018);

  const n1 = fbm(nx * 2.5 + ox, ny * 2.2 + oy);
  const n2 = fbm(nx * 5.8 - ox * 0.65, ny * 5.4 + oy * 0.85, 3);

  // primary portrait mass (face / torso of the reference crop)
  const cx = nx - (variant === "figure" ? 0.48 : 0.5);
  const cy = ny - (variant === "figure" ? 0.42 : 0.46);
  const ovalScale =
    variant === "figure"
      ? Math.sqrt(cx * cx * 3.1 + cy * cy * 2.4) * 0.95
      : Math.sqrt(cx * cx * 2.6 + cy * cy * 3.2) * 1.05;
  const oval = 1 - Math.min(1, ovalScale);
  const mass = Math.max(0, oval) ** (variant === "figure" ? 1.05 : 1.25);

  // secondary plate ridges — horizontal mechanical bands like the ref torso
  const plates =
    variant === "figure" || variant === "panel"
      ? Math.max(0, Math.sin(ny * 14 + n1 * 2.2) * 0.12 * mass)
      : 0;

  // limb / edge tendrils for figure (sparse outer glyphs like the ref arms)
  const limb =
    variant === "figure"
      ? Math.max(
          0,
          fbm(nx * 3.2 + ox * 1.4, ny * 1.4 + oy, 2) *
            (1 - Math.abs(nx - 0.5) * 0.6) *
            0.22,
        )
      : 0;

  let d = n1 * 0.36 + n2 * 0.2 + mass * 0.58 + plates + limb;

  if (variant === "band") {
    // horizontal weight — denser mid band
    d = n1 * 0.45 + n2 * 0.25 + (1 - Math.abs(ny - 0.5) * 1.6) * 0.4;
  } else if (variant === "ambient") {
    d = d * 0.82 + 0.1;
  } else if (variant === "panel") {
    d = d * 0.9 + 0.08;
  }

  // vignette for figure/panel so edges breathe
  if (variant === "figure" || variant === "panel") {
    const edge = Math.min(nx, 1 - nx, ny * 1.2, (1 - ny) * 1.1) * 3.2;
    d *= 0.35 + Math.max(0, Math.min(1, edge)) * 0.65;
  }

  return Math.max(0, Math.min(1, d));
}

export default function AsciiMotion({
  variant = "ambient",
  dense = false,
  className = "",
}: {
  variant?: Variant;
  /** Quieter ink for dense UI chrome (ops console). */
  dense?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    const { w: CELL_W, h: CELL_H } = CELL[variant];
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = true;
    let cols = 0;
    let rows = 0;
    let seed: Float32Array | null = null;
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      cssW =
        variant === "ambient"
          ? window.innerWidth
          : Math.max(1, Math.floor(rect.width));
      cssH =
        variant === "ambient"
          ? window.innerHeight
          : Math.max(1, Math.floor(rect.height));

      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = Math.ceil(cssW / CELL_W) + 1;
      rows = Math.ceil(cssH / CELL_H) + 1;
      seed = new Float32Array(cols * rows);
      for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    };

    const ink = (d: number, baseAlpha: number) => {
      const a = baseAlpha * (0.42 + d * 1.08);
      if (d > 0.58) {
        return `rgba(11, 68, 32, ${Math.min(0.58, a * 1.25)})`;
      }
      if (d > 0.32) {
        return `rgba(11, 68, 32, ${Math.min(0.44, a)})`;
      }
      // sparse field — warm mute on peach void
      return `rgba(117, 109, 96, ${Math.min(0.3, a * 0.88)})`;
    };

    const baseAlphaFor = () => {
      if (dense) return 0.16;
      switch (variant) {
        case "ambient":
          return 0.3;
        case "figure":
          return 0.48;
        case "panel":
          return 0.36;
        case "band":
          return 0.32;
      }
    };

    const draw = (timeMs: number) => {
      if (!running || !seed) return;
      const t = reduced ? 0 : timeMs * 0.001;
      const w = cssW;
      const h = cssH;

      ctx.clearRect(0, 0, w, h);

      const baseAlpha = baseAlphaFor();
      ctx.font = `500 ${CELL_H - 1}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      const rampLen = RAMP.length - 1;
      const skip = variant === "ambient" ? 0.075 : 0.05;

      for (let y = 0; y < rows; y++) {
        const ny = rows <= 1 ? 0.5 : y / (rows - 1);
        for (let x = 0; x < cols; x++) {
          const nx = cols <= 1 ? 0.5 : x / (cols - 1);
          let d = densityAt(nx, ny, t, variant);

          if (!reduced) {
            const s = seed[y * cols + x];
            const shimmer =
              Math.sin(t * 1.55 + s * 42 + x * 0.13 + y * 0.1) * 0.048;
            d = Math.max(0, Math.min(1, d + shimmer));
          }

          if (d < skip) continue;

          const idx = Math.min(rampLen, Math.floor(d * rampLen));
          const ch = RAMP[idx];
          if (ch === " ") continue;

          ctx.fillStyle = ink(d, baseAlpha);
          ctx.fillText(ch, x * CELL_W, y * CELL_H);
        }
      }
      // no scanline — figure panel uses AsciiFigure (image-driven)
    };

    resize();
    draw(0);

    let visible = variant === "ambient";
    let animating = false;

    const stopLoop = () => {
      animating = false;
      cancelAnimationFrame(frame);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const startLoop = () => {
      if (reduced || animating || !running) return;
      animating = true;
      const interval = variant === "ambient" ? 52 : 44;
      const tick = () => {
        if (!running || !animating) return;
        if (!visible && variant !== "ambient") {
          stopLoop();
          return;
        }
        draw(performance.now());
        timer = setTimeout(() => {
          frame = requestAnimationFrame(tick);
        }, interval);
      };
      frame = requestAnimationFrame(tick);
    };

    const ro =
      variant !== "ambient" && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            resize();
            draw(performance.now());
          })
        : null;
    if (ro) ro.observe(wrap);

    const io =
      variant !== "ambient" && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => {
              visible = entry.isIntersecting;
              if (visible) startLoop();
              else stopLoop();
            },
            { rootMargin: "80px", threshold: 0.02 },
          )
        : null;
    if (io) io.observe(wrap);
    else visible = true;

    const onResize = () => {
      resize();
      draw(performance.now());
    };
    window.addEventListener("resize", onResize);

    if (!reduced) {
      if (variant === "ambient" || visible) startLoop();
    }

    return () => {
      running = false;
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      io?.disconnect();
      stopLoop();
    };
  }, [variant, dense]);

  const isAmbient = variant === "ambient";

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className={
        isAmbient
          ? "pointer-events-none fixed inset-0 z-0 select-none overflow-hidden"
          : `pointer-events-none absolute inset-0 select-none overflow-hidden ${className}`
      }
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
