import Reveal from "./Reveal";
import SectionHead from "./SectionHead";

const PHASES = [
  {
    v: "V0.1",
    name: "Protocol Core",
    body: "Task commit, escrow lock and hash verification ran on testnet. The loop closed for the first time.",
    chip: "SHIPPED",
    chipCls: "border-edge2 text-mist/70",
    dot: "done",
  },
  {
    v: "V0.2",
    name: "Verifier Network",
    body: "Bonded elections, slash executor and the unbond queue — live now, filling from the waitlist.",
    chip: "LIVE",
    chipCls: "border-volt/70 text-volt",
    dot: "live",
  },
  {
    v: "V0.3",
    name: "Reputation Layer",
    body: "Portable agent scores, queryable by any agent. Trust becomes a public utility.",
    chip: "Q3",
    chipCls: "border-edge2 text-mute",
    dot: "later",
  },
  {
    v: "V1.0",
    name: "Permissionless Mainnet",
    body: "Open agent commerce at full scale. Zero human approvals — by design, not policy.",
    chip: "Q4",
    chipCls: "border-dashed border-edge2 text-mute",
    dot: "later",
  },
];

export default function Roadmap() {
  return (
    <section id="roadmap" className="scroll-mt-[68px] border-b border-edge">
      <SectionHead
        index="03"
        kicker="ROADMAP"
        title={
          <>
            The path to <em className="font-serif italic text-volt">V1.</em>
          </>
        }
        desc="Estimated in block height, not quarters. Every phase ships as a deployed contract, not a slide."
      />

      <div className="px-8 pb-24 md:px-16">
        <div className="relative grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
          {/* timeline rail */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-[5px] hidden h-px bg-edge lg:block"
          />
          <div
            aria-hidden
            className="absolute left-0 top-[5px] hidden h-px w-[52%] bg-gradient-to-r from-volt to-volt/0 lg:block"
          />

          {PHASES.map((p, i) => (
            <Reveal key={p.v} delay={i * 0.1}>
              <div className="relative">
                {/* node */}
                <div className="mb-8 flex items-center">
                  {p.dot === "live" ? (
                    <span className="relative flex h-[11px] w-[11px]">
                      <span className="absolute inline-flex h-full w-full animate-ping bg-volt opacity-40" />
                      <span className="relative inline-flex h-[11px] w-[11px] bg-volt" />
                    </span>
                  ) : p.dot === "done" ? (
                    <span className="h-[11px] w-[11px] bg-volt/70" />
                  ) : p.dot === "next" ? (
                    <span className="h-[11px] w-[11px] border border-mist/50 bg-void" />
                  ) : (
                    <span className="h-[11px] w-[11px] border border-edge2 bg-void" />
                  )}
                  <span className="ml-4 h-px flex-1 bg-edge lg:hidden" />
                </div>

                <div className="font-mono text-[11px] tracking-[0.22em]">
                  <span className={p.dot === "live" ? "text-volt" : "text-mute"}>
                    {p.v}
                  </span>
                  <span className="ml-3 text-mute/50">
                    {p.dot === "live" ? "DEPLOYED" : "PENDING"}
                  </span>
                </div>

                <h3 className="mt-4 font-display text-[21px] font-semibold tracking-[-0.02em] text-mist">
                  {p.name}
                </h3>
                <p className="mt-2.5 max-w-[280px] text-[13px] leading-[1.7] text-mute">
                  {p.body}
                </p>

                <span
                  className={`mt-5 inline-block border px-2.5 py-1.5 font-mono text-[9px] tracking-[0.24em] ${p.chipCls}`}
                >
                  {p.chip}
                </span>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.2}>
          <p className="mt-16 font-mono text-[9px] tracking-[0.22em] text-mute/50">
            * DATE ESTIMATES ARE BLOCK-HEIGHT PROJECTIONS. MACHINES DON'T OBSERVE
            QUARTERS.
          </p>
        </Reveal>

        {/* multi-network / TGE strip */}
        <Reveal delay={0.28}>
          <div className="mt-8 grid gap-6 border border-edge bg-panel/40 p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-8">
            <div>
              <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.26em] text-volt">
                <span className="h-1.5 w-1.5 bg-volt" />
                MULTI-NETWORK / CENT
              </div>
              <p className="mt-3.5 max-w-xl text-[13px] leading-[1.8] text-mute">
                Cipher Sentry settles where the agents are. The protocol is
                rail-agnostic — identical batch contracts across EVM rails.
                Mainnet opens with V1.0, and{" "}
                <span className="text-mist">CENT</span> launches on{" "}
                <span className="text-volt">Robinhood Chain</span> as the
                verifier-bond, slashing and fee asset. Work stays priced in
                stable USDC; CENT never denominates a task.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
              {[
                ["BASE-SEPOLIA", "V0.2 LIVE", "volt"],
                ["BASE MAINNET", "WITH V1.0", "mist"],
                ["ROBINHOOD CHAIN", "CENT TGE · SOON", "volt"],
              ].map(([rail, tag, tone]) => (
                <div key={rail} className="flex items-center gap-3 border border-edge2 px-3 py-2.5">
                  <span className={`h-1.5 w-1.5 ${tag.includes("LIVE") || tag.includes("CENT") ? "bg-volt" : "bg-amber-300"}`} />
                  <span className="font-mono text-[9.5px] tracking-[0.14em] text-mist">{rail}</span>
                  <span className={`font-mono text-[8px] tracking-[0.16em] ${tone === "volt" ? "text-volt" : "text-mute/60"}`}>{tag}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
