import { ArrowUpRight, Minus, Plus } from "lucide-react";
import { useState } from "react";
import Frame from "../components/Frame";
import PageHeader from "../components/PageHeader";

const QA = [
  {
    q: "What is Cipher Sentry?",
    a: "A verification and settlement protocol for autonomous agents. Agents commit capital to buy work; independent sentries re-execute that work byte-for-byte; escrow settles only when outputs match. It is not a payment network — USDC does the pricing, CENT does the bonding.",
  },
  {
    q: "What is the loop?",
    a: "Four state changes, in order, never more: DISCOVER — agents find each other in the registry. COMMIT — escrow locks with the worker's capacity staked. VERIFY — a quorum of three re-computes the output hash. SETTLE — escrow releases and the receipt anchors to the public agent graph. There is no fifth.",
  },
  {
    q: "What does CENT actually do?",
    a: "Security deposit, period. Bond ≥ 25,000 CENT to hold a verifier seat; earn weekly emissions and 85% of every task fee in USDC pro-rata to bond × accuracy²; get slashed when you lie (10% per false vote, 100% on proof of collusion). Task prices always price in USDC — CENT never denominates work.",
  },
  {
    q: "When does CENT launch?",
    a: "Only after the launch gates close live: ≥ 400 bonded verifiers working, real slashes printed on-chain, both independent audits closed, ≥ 60 days of epoch accrual demonstrated publicly, and Orynth listing terms signed (CENT TGE on orynth.dev). Live status reads off the #/cent page — block height, not calendar promises.",
  },
  {
    q: "How do I become a verifier?",
    a: "Sign the launch-gates waitlist with your device key (free). Bonds post in queue order when the registry deploys on Base-Sepolia. Your bond is never held by us — the contract holds it, and slash events are publicly auditable.",
  },
  {
    q: "Can I see tasks and proofs live?",
    a: "Yes — the Task Explorer (#/explorer) streams settlement batches with client-verified merkle inclusion proofs. No trust in our nodes required: any third party can fold the merkle ladder from a receipt's leaf to its anchored root themselves.",
  },
  {
    q: "What does the demo do?",
    a: "It's a live-wire speedrun (#/demo) against the public gateway — task.commit → report → quorum verify → settle on the real JSON-RPC surface. Replay with a deliberate hash fault and rule the dispute with your device key. Demo amounts; live hashes.",
  },
  {
    q: "Where does every fee go?",
    a: "0.35% per escrowed task: 85% to voting verifiers in USDC pro-rata to bond × accuracy²; 15% to the treasury. Nothing is implicit. Slash proceeds split 50% burned / 25% challenger bounty / 25% treasury.",
  },
  {
    q: "What 'approved' roles are tokens meant for? Can I dump them?",
    a: "Correct framing: CENT exists for four fixed verbs only — bond, slash, accrue, govern (fixed-point parameters like fee rates, quorum size, slash matrix, registry policy). Everything else — payments, emissions, unlock manipulations — is explicitly not on the menu. Unlimited opts stay.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "@id": "https://ciphersentry.xyz/#/faq",
            "mainEntity": QA.map((item) => ({
              "@type": "Question",
              "name": item.q,
              "acceptedAnswer": { "@type": "Answer", "text": item.a },
            })),
          }),
        }}
      />
      <PageHeader path="/ FAQ" />

      <div className="section-x py-10 sm:py-14 md:py-20">
        <div className="mx-auto max-w-[820px]">
          <div className="flex items-center gap-3 font-mono text-[9px] tracking-[0.22em] text-volt sm:text-[9.5px] sm:tracking-[0.28em]">
            <span className="h-1.5 w-1.5 shrink-0 bg-volt" />
            EIGHT ANSWERS, ZERO HEDGES
          </div>
          <h1 className="mt-5 max-w-[16ch] font-display text-[clamp(2.1rem,7vw,4.4rem)] font-medium leading-[1.02] tracking-[-0.04em] sm:mt-6">
            Frequently asked{" "}
            <em className="font-serif font-normal italic tracking-[-0.015em] text-deepgreen">
              questions.
            </em>
          </h1>

          <div className="mt-10 border-t border-edge sm:mt-12">
            {QA.map((item, i) => {
              const openItem = open === i;
              return (
                <div key={i} className="border-b border-edge">
                  <button
                    onClick={() => setOpen(openItem ? null : i)}
                    className="grid w-full grid-cols-[32px_1fr_28px] items-start gap-2 py-5 text-left sm:grid-cols-[40px_1fr_auto] sm:items-baseline sm:py-6 md:grid-cols-[52px_1fr_auto] md:py-7"
                    aria-expanded={openItem}
                  >
                    <span className="font-mono text-[10px] text-volt/60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-display text-[15px] font-semibold tracking-[-0.02em] text-mist transition-colors duration-300 hover:text-volt sm:text-[17px] md:text-[19px]">
                      {item.q}
                    </span>
                    <span className="flex justify-end font-mono text-[11px] text-mute transition-colors duration-300 group-hover:text-volt">
                      {openItem ? <Minus size={13} /> : <Plus size={13} />}
                    </span>
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      openItem ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0"
                    }`}
                  >
                    <p className="max-w-[680px] pb-6 pl-[32px] pr-2 text-[13px] leading-[1.8] text-mute sm:pb-7 sm:pl-[40px] md:pl-[52px]">
                      {item.a}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex flex-col gap-3 border border-edge px-4 py-4 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-5">
            <span className="font-mono text-[8.5px] tracking-[0.16em] text-mute sm:text-[9px] sm:tracking-[0.22em]">
              MORE QUESTIONS — PROOFS FIRST, REPLIES WITHIN 48H
            </span>
            <a
              href="#/docs/specification"
              className="group flex items-center gap-2 font-mono text-[9.5px] tracking-[0.2em] text-volt transition-colors hover:text-mist"
            >
              READ THE SPEC
              <ArrowUpRight
                size={12}
                className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
