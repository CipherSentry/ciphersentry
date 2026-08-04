import { ArrowUpRight } from "lucide-react";
import { CentLaunchHero, CentUtilitySection, ORYNTH_PROJECT } from "../components/CentLaunch";
import Frame from "../components/Frame";
import PageHeader from "../components/PageHeader";
import { SOCIALS } from "../components/Social";
import { liveConsoleHref } from "../sdk/livePath";

/** Public freeze hash — keep in sync with AUDIT-PACK / freeze-hash.sh */
const FREEZE =
  "a5ab9e52103bdda839a7f2445526d1bc7f086e21ad526e221f87ea1d226be2de";

const LINKS: { label: string; href: string; ext?: boolean }[] = [
  { label: "Orynth project", href: ORYNTH_PROJECT, ext: true },
  { label: "How $CENT works", href: "#/docs/tokenomics" },
  { label: "Audit readiness", href: "#/docs/audit" },
  { label: "Whitepaper", href: "#/docs/whitepaper" },
  { label: "Launch gates", href: "#/gates" },
  { label: "Live console", href: liveConsoleHref() },
  { label: "GitHub", href: SOCIALS.github, ext: true },
];

export default function Cent() {
  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />
      <PageHeader
        path="/ $CENT · ORYNTH"
        end={
          <a
            href="#/gates"
            className="flex min-h-9 items-center gap-1.5 border border-edge2 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em] text-mute transition-colors hover:border-volt/70 hover:text-volt sm:px-3"
          >
            GATES
            <ArrowUpRight size={11} />
          </a>
        }
      />

      <CentLaunchHero />
      <CentUtilitySection />

      <div className="border-b border-edge px-4 py-10 sm:px-6 md:px-12">
        <div className="mx-auto max-w-[920px]">
          <div className="font-mono text-[9px] tracking-[0.24em] text-volt">
            AUDIT FREEZE
          </div>
          <pre className="mt-4 overflow-x-auto border border-code-edge bg-code p-4 font-mono text-[11px] text-volthot">
            {FREEZE}
          </pre>
          <p className="mt-3 font-mono text-[10px] text-mute">
            <code className="text-mist">./services/scripts/freeze-hash.sh</code>
          </p>
        </div>
      </div>

      <div className="px-4 py-10 sm:px-6 md:px-12 md:py-14">
        <div className="mx-auto max-w-[920px]">
          <div className="font-mono text-[9px] tracking-[0.24em] text-volt">LINKS</div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target={l.ext ? "_blank" : undefined}
                rel={l.ext ? "noreferrer" : undefined}
                className="group flex items-center justify-between gap-3 border border-edge2 px-4 py-3.5 font-mono text-[11px] tracking-[0.12em] text-mist transition-colors hover:border-volt/60 hover:text-volt"
              >
                {l.label}
                <ArrowUpRight
                  size={13}
                  className="shrink-0 text-mute group-hover:text-volt"
                />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
