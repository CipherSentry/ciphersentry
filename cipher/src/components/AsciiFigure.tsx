import { useEffect, useRef } from "react";
import refUrl from "../assets/ascii-motion-work.jpg";

/**
 * AsciiFigure — THE SENTRY panel.
 * Samples docs/screenshots/ascii motion work.jpg (bundled) into a live
 * monospaced density field. Soft character shimmer only — no scanline.
 */

const RAMP =
  " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

const CELL_W = 6;
const CELL_H = 10;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function AsciiFigure({ className = "" }: { className?: string }) {
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
    let visible = false;
    let animating = false;
    let cssW = 0;
    let cssH = 0;
    let cols = 0;
    let rows = 0;
    let seed: Float32Array | null = null;

    // source image + sample buffer
    const img = new Image();
    img.decoding = "async";
    let imgReady = false;
    const sample = document.createElement("canvas");
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    let pixels: Uint8ClampedArray | null = null;
    let sampleW = 0;
    let sampleH = 0;

    const rebuildSample = () => {
      if (!imgReady || !sctx || cols < 1 || rows < 1) return;
      // cover-fit the source into col×row sample grid
      sampleW = cols;
      sampleH = rows;
      sample.width = sampleW;
      sample.height = sampleH;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = Math.max(sampleW / iw, sampleH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (sampleW - dw) / 2;
      const dy = (sampleH - dh) / 2;
      sctx.fillStyle = "#fbf3ec";
      sctx.fillRect(0, 0, sampleW, sampleH);
      sctx.drawImage(img, dx, dy, dw, dh);
      pixels = sctx.getImageData(0, 0, sampleW, sampleH).data;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(rect.width));
      cssH = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = Math.ceil(cssW / CELL_W) + 1;
      rows = Math.ceil(cssH / CELL_H) + 1;
      seed = new Float32Array(cols * rows);
      for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
      rebuildSample();
    };

    const luminance = (x: number, y: number) => {
      if (!pixels || sampleW < 1 || sampleH < 1) return 0.5;
      // image is dark-ink on light paper → invert so mass = dense
      const sx = Math.min(sampleW - 1, Math.max(0, x));
      const sy = Math.min(sampleH - 1, Math.max(0, y));
      const i = (sy * sampleW + sx) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return 1 - lum; // dark pixels → high density
    };

    const ink = (d: number) => {
      // deep green ink mass, warm mute for sparse field
      if (d > 0.55) {
        return `rgba(11, 68, 32, ${Math.min(0.72, 0.28 + d * 0.55)})`;
      }
      if (d > 0.28) {
        return `rgba(11, 68, 32, ${Math.min(0.5, 0.18 + d * 0.45)})`;
      }
      return `rgba(117, 109, 96, ${Math.min(0.28, 0.08 + d * 0.35)})`;
    };

    const draw = (timeMs: number) => {
      if (!running || !seed) return;
      const t = reduced ? 0 : timeMs * 0.001;
      ctx.clearRect(0, 0, cssW, cssH);

      if (!pixels) {
        // placeholder until image decodes
        ctx.fillStyle = "rgba(117, 109, 96, 0.15)";
        ctx.font = `500 ${CELL_H - 1}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillText("·", 8, 8);
        return;
      }

      ctx.font = `500 ${CELL_H - 1}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      const rampLen = RAMP.length - 1;
      // gentle UV drift — reads as living print, not a scan beam
      const ox = reduced ? 0 : Math.sin(t * 0.22) * 1.2;
      const oy = reduced ? 0 : Math.cos(t * 0.17) * 0.9;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const sx = Math.round(x + ox);
          const sy = Math.round(y + oy);
          let d = luminance(sx, sy);

          if (!reduced) {
            const s = seed[y * cols + x];
            // micro morph inside the density band — characters breathe
            const shimmer =
              Math.sin(t * 1.25 + s * 36 + x * 0.11 + y * 0.09) * 0.035;
            d = Math.max(0, Math.min(1, d + shimmer));
          }

          // skip near-white paper
          if (d < 0.07) continue;

          let idx = Math.min(rampLen, Math.floor(d * rampLen));
          if (!reduced) {
            // occasional neighbor glyph — same mass, slight typewriter jitter
            const s = seed[y * cols + x];
            const j = Math.sin(t * 2.1 + s * 50) > 0.88 ? 1 : 0;
            idx = Math.min(rampLen, idx + j);
          }
          const ch = RAMP[idx];
          if (ch === " ") continue;

          ctx.fillStyle = ink(d);
          ctx.fillText(ch, x * CELL_W, y * CELL_H);
        }
      }
      // intentionally no scanline
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
      if (reduced || animating || !running || !visible) return;
      animating = true;
      const tick = () => {
        if (!running || !animating || !visible) {
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

    img.onload = () => {
      imgReady = true;
      rebuildSample();
      draw(0);
      if (!reduced && visible) startLoop();
    };
    img.onerror = () => {
      imgReady = false;
    };
    img.src = refUrl;

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
              if (visible) {
                if (reduced) draw(0);
                else startLoop();
              } else stopLoop();
            },
            { rootMargin: "60px", threshold: 0.02 },
          )
        : null;
    if (io) io.observe(wrap);
    else {
      visible = true;
      if (!reduced) startLoop();
    }

    const onResize = () => {
      resize();
      draw(performance.now());
    };
    window.addEventListener("resize", onResize);

    return () => {
      running = false;
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      io?.disconnect();
      stopLoop();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 select-none overflow-hidden ${className}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
