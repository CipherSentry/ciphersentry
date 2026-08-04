import { useEffect, useRef } from "react";

/**
 * Animated ASCII fill of the $CENT wordmark — samples an offscreen text mask
 * and paints mono glyphs that shimmer in the letter bodies.
 * prefers-reduced-motion freezes at t=0.
 */

const RAMP = " .:-=+*#%@";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function AsciiCentTitle({
  className = "",
}: {
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
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = true;
    let visible = true;
    let animating = false;
    let cssW = 0;
    let cssH = 0;
    let cols = 0;
    let rows = 0;
    let mask: Uint8Array | null = null;
    let seed: Float32Array | null = null;

    const CELL_W = 7;
    const CELL_H = 11;

    const rebuildMask = () => {
      const off = document.createElement("canvas");
      off.width = Math.max(1, cols);
      off.height = Math.max(1, rows);
      const octx = off.getContext("2d");
      if (!octx) return;

      octx.clearRect(0, 0, cols, rows);
      octx.fillStyle = "#fff";
      octx.textAlign = "left";
      octx.textBaseline = "middle";

      // Fit "$CENT" to width; height is driven by font metrics
      const text = "$CENT";
      let fontPx = Math.floor(rows * 0.92);
      octx.font = `600 ${fontPx}px "Inter Tight", Inter, system-ui, sans-serif`;
      let tw = octx.measureText(text).width;
      if (tw > cols * 0.96) {
        fontPx = Math.floor(fontPx * ((cols * 0.96) / tw));
        octx.font = `600 ${fontPx}px "Inter Tight", Inter, system-ui, sans-serif`;
        tw = octx.measureText(text).width;
      }
      const x = Math.max(0, (cols - tw) / 2);
      const y = rows * 0.52;
      octx.fillText(text, x, y);

      const data = octx.getImageData(0, 0, cols, rows).data;
      mask = new Uint8Array(cols * rows);
      seed = new Float32Array(cols * rows);
      for (let i = 0; i < cols * rows; i++) {
        mask[i] = data[i * 4 + 3]; // alpha
        seed[i] = Math.random();
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(rect.width));
      // tall enough for the wordmark on phones
      cssH = Math.max(1, Math.floor(rect.height));

      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = Math.ceil(cssW / CELL_W) + 1;
      rows = Math.ceil(cssH / CELL_H) + 1;
      rebuildMask();
    };

    const draw = (timeMs: number) => {
      if (!running || !mask || !seed) return;
      const t = reduced ? 0 : timeMs * 0.001;
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.font = `500 ${CELL_H - 1}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      const rampLen = RAMP.length - 1;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const a = mask[i];
          if (a < 28) continue;

          const dens = a / 255;
          let shimmer = 0;
          if (!reduced) {
            const s = seed[i];
            shimmer =
              Math.sin(t * 1.8 + s * 48 + x * 0.15 + y * 0.11) * 0.12 +
              Math.sin(t * 0.7 + x * 0.05) * 0.06;
          }
          const d = Math.max(0, Math.min(1, dens * 0.85 + shimmer + 0.12));
          const idx = Math.min(rampLen, Math.floor(d * rampLen));
          const ch = RAMP[idx];
          if (ch === " ") continue;

          // volt-green core, mute edge
          const alpha = 0.35 + dens * 0.55;
          if (d > 0.55) {
            ctx.fillStyle = `rgba(11, 68, 32, ${Math.min(0.85, alpha)})`;
          } else if (d > 0.3) {
            ctx.fillStyle = `rgba(11, 68, 32, ${Math.min(0.62, alpha * 0.9)})`;
          } else {
            ctx.fillStyle = `rgba(117, 109, 96, ${Math.min(0.45, alpha * 0.75)})`;
          }
          ctx.fillText(ch, x * CELL_W, y * CELL_H);
        }
      }
    };

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
      const tick = () => {
        if (!running || !animating) return;
        if (!visible) {
          stopLoop();
          return;
        }
        draw(performance.now());
        timer = setTimeout(() => {
          frame = requestAnimationFrame(tick);
        }, 48);
      };
      frame = requestAnimationFrame(tick);
    };

    resize();
    draw(0);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            resize();
            draw(performance.now());
          })
        : null;
    if (ro) ro.observe(wrap);

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => {
              visible = entry.isIntersecting;
              if (visible) startLoop();
              else stopLoop();
            },
            { rootMargin: "60px", threshold: 0.02 },
          )
        : null;
    if (io) io.observe(wrap);

    if (!reduced) startLoop();

    return () => {
      running = false;
      ro?.disconnect();
      io?.disconnect();
      stopLoop();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className={`relative w-full select-none ${className}`}
      role="img"
      aria-label="$CENT"
    >
      {/* accessible fallback — visually hidden */}
      <span className="absolute h-px w-px overflow-hidden whitespace-nowrap p-0 [clip:rect(0,0,0,0)]">
        $CENT
      </span>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
