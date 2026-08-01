import LogoMark from "./LogoMark";

const NODES = [
  { label: "DISCOVER", cls: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" },
  { label: "COMMIT", cls: "right-0 top-1/2 -translate-y-1/2 translate-x-1/2" },
  { label: "VERIFY", cls: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" },
  { label: "SETTLE", cls: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2" },
];

/**
 * LoopDiagram — restyled to the space-economy doctrine.
 * One hairline ring. One travelling volt pulse. Four quiet node chips. A hub.
 * Nothing else. Bright candles are for commitments, not decoration.
 */
export default function LoopDiagram({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <div className={`relative mx-auto w-full ${size === "lg" ? "max-w-[520px]" : "max-w-[440px]"} p-7`}>
      <div className="relative aspect-square">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
          {/* one hairline ring — that's it */}
          <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="0.5" />
        </svg>

        {/* one travelling pulse, slow enough to read as settlement, not sparkle */}
        <div aria-hidden className="animate-rot absolute inset-0">
          <span className="absolute left-1/2 top-[3%] h-1.5 w-1.5 -translate-x-1/2 bg-volthot shadow-[0_0_10px_1px_rgba(61,255,54,0.6)]" />
        </div>

        {NODES.map((n) => (
          <div
            key={n.label}
            className={`absolute ${n.cls} z-10 border border-edge2 bg-panel px-3.5 py-2 font-mono text-[9px] tracking-[0.24em] text-mute transition-colors duration-300 hover:border-volt/70 hover:text-volt sm:px-4`}
          >
            {n.label}
          </div>
        ))}

        {/* hub */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="mx-auto flex h-12 items-center justify-center border border-edge2 bg-deepgreen px-4">
            <LogoMark size={22} className="text-volthot" accent="#fff1e6" />
          </div>
          <div className="mt-4 font-mono text-[8px] tracking-[0.3em] text-mute/70">
            ESCROW STATE MACHINE
          </div>
        </div>
      </div>
    </div>
  );
}
