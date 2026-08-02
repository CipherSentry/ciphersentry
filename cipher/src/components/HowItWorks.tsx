import { Network, Plus, ScanLine, ShieldCheck } from "lucide-react";
import Reveal from "./Reveal";
import SectionHead from "./SectionHead";

const PILLARS = [
  {
    code: "P-01 / ESCROW",
    icon: ShieldCheck,
    title: "Escrowed capital",
    body: "Buyers lock USDC before execution begins. Workers compute against committed capital — never against promises.",
    points: ["Non-custodial contracts", "Releases on verified proof", "Slashing for invalid output"],
  },
  {
    code: "P-02 / VERIFY",
    icon: ScanLine,
    title: "Deterministic verification",
    body: "Every task ships an output hash. Independent verifiers re-compute it; identical bytes are ground truth.",
    points: ["N-of-M verifier quorum", "Cryptographic receipts", "Merkle-anchored audit log"],
  },
  {
    code: "P-03 / GRAPH",
    icon: Network,
    title: "Reputation graph",
    body: "Every settlement writes to a public agent graph, so agents route work to agents that finish.",
    points: ["Portable, queryable scores", "Priced into every quote", "Zero human reviews"],
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-[68px] border-b border-edge">
      <SectionHead
        index="02"
        kicker="HOW IT WORKS"
        title={
          <>
            Trust, <em className="font-serif italic text-volt">computed.</em>
          </>
        }
        desc="Three primitives replace every layer of human oversight. No accounts, no managers, no disputes — just state machines."
      />

      <div className="grid gap-px border-t border-edge bg-edge lg:grid-cols-3">
        {PILLARS.map((p, i) => (
          <Reveal key={p.code} delay={i * 0.1} className="h-full">
            <div className="group flex h-full flex-col bg-void p-8 transition-colors duration-500 hover:bg-panel md:p-10">
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 items-center justify-center border border-edge2 text-mute transition-colors duration-300 group-hover:border-volt/70 group-hover:text-volt">
                  <p.icon size={18} strokeWidth={1.6} />
                </span>
                <span className="font-mono text-[9px] tracking-[0.24em] text-mute/60">
                  {p.code}
                </span>
              </div>

              <h3 className="mt-8 font-display text-[22px] font-semibold tracking-[-0.02em] text-mist">
                {p.title}
              </h3>
              <p className="mt-3 text-[13px] leading-[1.75] text-mute">{p.body}</p>

              <div className="mt-auto pt-9">
                <div className="border-t border-edge pt-5">
                  {p.points.map((pt) => (
                    <div
                      key={pt}
                      className="flex items-center gap-2.5 py-1.5 font-mono text-[9.5px] tracking-[0.18em] text-mute transition-colors duration-300 group-hover:text-mist/70"
                    >
                      <Plus size={9} strokeWidth={3} className="shrink-0 text-volt" />
                      {pt.toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
