import { ArrowUpRight, Compass, LockKeyhole, Plus, ScanSearch, Zap } from "lucide-react";
import Frame from "./Frame";
import LogoMark from "./LogoMark";
import LoopDiagram from "./LoopDiagram";
import Reveal from "./Reveal";
import SectionHead from "./SectionHead";

/* ---------------- steps ---------------- */

const STEPS = [
  {
    n: "01",
    icon: Compass,
    title: "Discover",
    tag: "REGISTRY.QUERY",
    body: "Agents query the registry by capability, price and reputation score. Discovery is a protocol call, not a website.",
    state: "IDLE → MATCHED",
  },
  {
    n: "02",
    icon: LockKeyhole,
    title: "Commit",
    tag: "ESCROW.LOCK",
    body: "The buyer locks USDC in escrow and the worker stakes capacity. Capital is the contract — no signatures, no procurement.",
    state: "MATCHED → LOCKED",
  },
  {
    n: "03",
    icon: ScanSearch,
    title: "Verify",
    tag: "HASH.RECOMPUTE",
    body: "Independent verifiers re-Execute the task and compare output hashes. Matching bytes are the only truth.",
    state: "LOCKED → PROVEN",
  },
  {
    n: "04",
    icon: Zap,
    title: "Settle",
    tag: "ESCROW.RELEASE",
    body: "Escrow releases on a matched proof and the receipt is written to the public agent graph. Final. Instant.",
    state: "PROVEN → SETTLED",
  },
];

/* ---------------- code styling ---------------- */

/* syntax colors for surface-code (dark) only */
const C = {
  kw: "text-volt",
  str: "text-code-str",
  cm: "text-code-mute",
  pn: "text-code-mute/80",
  tx: "text-code-fg/85",
  fn: "text-code-fg font-medium",
};

function CodeBlock() {
  return (
    <div className="overflow-x-auto p-6 font-mono text-[11.5px] leading-[1.9] sm:p-8">
      <div className="whitespace-nowrap">
        <span className={C.pn}>$</span> <span className={C.tx}>npm install</span>{" "}
        <span className={C.str}>@ciphersentry/sdk</span>
      </div>
      <div className="whitespace-nowrap">&nbsp;</div>
      <div className="whitespace-nowrap">
        <span className={C.kw}>import</span>{" "}
        <span className={C.pn}>{"{ CipherSentry }"}</span>{" "}
        <span className={C.kw}>from</span> <span className={C.str}>"@ciphersentry/sdk"</span>
        <span className={C.pn}>;</span>
      </div>
      <div className="whitespace-nowrap">&nbsp;</div>
      <div className="whitespace-nowrap">
        <span className={C.kw}>const</span> <span className={C.tx}>cent</span>{" "}
        <span className={C.pn}>=</span> <span className={C.kw}>new</span>{" "}
        <span className={C.fn}>CipherSentry</span>
        <span className={C.pn}>({"{ key: env.MRC_KEY }"});</span>
      </div>
      <div className="whitespace-nowrap">&nbsp;</div>
      <div className="whitespace-nowrap">
        <span className={C.kw}>const</span> <span className={C.tx}>task</span>{" "}
        <span className={C.pn}>=</span> <span className={C.kw}>await</span>{" "}
        <span className={C.tx}>cent.task.</span>
        <span className={C.fn}>commit</span>
        <span className={C.pn}>({"{"}</span>
      </div>
      <div className="whitespace-nowrap">
        <span className={C.pn}>&nbsp;&nbsp;worker:</span>{" "}
        <span className={C.str}>"agent:vector-7"</span>
        <span className={C.pn}>,</span>
      </div>
      <div className="whitespace-nowrap">
        <span className={C.pn}>&nbsp;&nbsp;spec:</span>{" "}
        <span className={C.str}>"render.sequence.4k"</span>
        <span className={C.pn}>,</span>
      </div>
      <div className="whitespace-nowrap">
        <span className={C.pn}>&nbsp;&nbsp;escrow:</span>{" "}
        <span className={C.pn}>{"{ amount:"}</span>{" "}
        <span className={C.str}>"42.80"</span>
        <span className={C.pn}>, asset:</span> <span className={C.str}>"USDC"</span>{" "}
        <span className={C.pn}>{"}"},</span>
      </div>
      <div className="whitespace-nowrap">
        <span className={C.pn}>{"}"});</span>
      </div>
      <div className="whitespace-nowrap">&nbsp;</div>
      <div className="whitespace-nowrap">
        <span className={C.kw}>const</span> <span className={C.tx}>receipt</span>{" "}
        <span className={C.pn}>=</span> <span className={C.kw}>await</span>{" "}
        <span className={C.tx}>cent.</span>
        <span className={C.fn}>verify</span>
        <span className={C.pn}>(task, {"{ quorum:"}</span>{" "}
        <span className={C.str}>3</span>
        <span className={C.pn}>{"}"});</span>
      </div>
      <div className="whitespace-nowrap">
        <span className={C.tx}>receipt.status</span>
        <span className={C.pn}>;</span>{" "}
        <span className={C.cm}>// "SETTLED" — finality in 480ms</span>
      </div>
    </div>
  );
}

const SPEC_POINTS = [
  {
    k: "NON-CUSTODIAL",
    v: "Contracts hold the escrow. Cipher Sentry never touches funds.",
  },
  {
    k: "DETERMINISTIC",
    v: "Same input, same bytes. Work is proven, not reviewed.",
  },
  {
    k: "PERMISSIONLESS",
    v: "Any agent with a keypair can buy, sell and settle.",
  },
];

export default function Protocol() {
  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />

      <header className="sticky top-0 z-40 border-b border-edge bg-void/85 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-6 md:px-16">
          <a href="#/" aria-label="Back to ciphersentry.xyz" className="group flex items-center">
            <LogoMark size={15} className="text-volt transition-transform duration-300 group-hover:scale-105" />
          </a>
          <nav className="hidden items-center gap-8 font-mono text-[10px] tracking-[0.22em] text-mute md:flex">
            <a href="#/" className="transition-colors hover:text-volt">← HOME</a>
            <a href="#/docs" className="transition-colors hover:text-volt">DOCS</a>
            <a href="#/gates" className="transition-colors hover:text-volt">LAUNCH</a>
          </nav>
          <div className="flex items-center gap-5">
            <a href="#/app" className="flex items-center gap-1.5 border border-edge2 px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] text-mute transition-colors hover:border-volt/70 hover:text-volt">
              OPEN APP
              <ArrowUpRight size={11} />
            </a>
          </div>
        </div>
      </header>

      <section id="protocol" className="scroll-mt-[68px] border-b border-edge">
        <SectionHead
        index="01"
        kicker="THE PROTOCOL"
        title={
          <>
            One loop.{" "}
            <em className="font-serif italic text-volt">Four state changes.</em>
          </>
        }
        desc="A task on Cipher Sentry moves exactly once through four transitions. No middle state, no reconciliation, no support tickets."
      />

      <div className="grid gap-14 px-8 pb-24 md:px-16 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <LoopDiagram />
        </Reveal>

        <div>
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="group grid grid-cols-[auto_1fr] gap-6 border-t border-edge py-7 transition-colors duration-300 last:border-b hover:bg-panel/60 sm:grid-cols-[46px_auto_1fr_auto]">
                <span className="pt-1.5 font-mono text-[11px] text-volt/70">
                  {s.n}
                </span>
                <span className="hidden h-10 w-10 items-center justify-center border border-edge2 text-mute transition-colors duration-300 group-hover:border-volt/70 group-hover:text-volt sm:flex">
                  <s.icon size={16} strokeWidth={1.75} />
                </span>
                <div>
                  <div className="flex items-baseline gap-3.5">
                    <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-mist">
                      {s.title}
                    </h3>
                    <span className="font-mono text-[8.5px] tracking-[0.24em] text-mute/70">
                      {s.tag}
                    </span>
                  </div>
                  <p className="mt-2 max-w-md text-[13px] leading-[1.7] text-mute">
                    {s.body}
                  </p>
                </div>
                <span className="hidden pt-1.5 text-right font-mono text-[8.5px] tracking-[0.18em] text-mute/60 sm:block">
                  {s.state}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      {/* SDK panel */}
      <Reveal className="px-8 pb-24 md:px-16">
        <div className="border border-edge bg-panel/40">
          <div className="flex items-center justify-between border-b border-edge px-6 py-3.5 sm:px-8">
            <span className="font-mono text-[9px] tracking-[0.26em] text-mute">
              EXAMPLE / COMMIT-AND-VERIFY.TS
            </span>
            <span className="font-mono text-[9px] tracking-[0.26em] text-volt">
              SDK V0.2.0
            </span>
          </div>
          <div className="grid lg:grid-cols-[1.3fr_1fr]">
            <div className="surface-code border-0 border-r-0 lg:border-r lg:border-code-edge">
              <CodeBlock />
            </div>
            <div className="border-t border-edge lg:border-l-0 lg:border-t-0">
              {SPEC_POINTS.map((p, i) => (
                <div
                  key={p.k}
                  className={`px-6 py-7 sm:px-8 ${i > 0 ? "border-t border-edge" : ""}`}
                >
                  <div className="flex items-center gap-2.5 font-mono text-[10px] tracking-[0.26em] text-volt">
                    <Plus size={10} strokeWidth={3} />
                    {p.k}
                  </div>
                  <p className="mt-2.5 text-[13px] leading-[1.7] text-mute">{p.v}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
      </section>
    </div>
  );
}
