import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ComponentType } from "react";
import Frame from "../components/Frame";
import PageHeader from "../components/PageHeader";
import AuditReadiness from "./AuditReadiness";
import Manifesto from "./Manifesto";
import Sdk from "./Sdk";
import Specification from "./Specification";
import VerificationDoc from "./VerificationDoc";
import Whitepaper from "./Whitepaper";

export const DOCS: { slug: string; title: string; group: string; component: ComponentType }[] = [
  { slug: "specification", title: "Specification", group: "PROTOCOL", component: Specification },
  { slug: "sdk", title: "SDK Reference", group: "PROTOCOL", component: Sdk },
  { slug: "verification", title: "Verification", group: "PROTOCOL", component: VerificationDoc },
  { slug: "whitepaper", title: "Whitepaper", group: "PROTOCOL", component: Whitepaper },
  { slug: "audit", title: "Audit Readiness", group: "SECURITY", component: AuditReadiness },
  { slug: "manifesto", title: "Manifesto", group: "ESSAYS", component: Manifesto },
];

const GROUPS = ["PROTOCOL", "SECURITY", "ESSAYS"];

export default function DocsPage({ slug }: { slug: string | undefined }) {
  const idx = Math.max(0, DOCS.findIndex((d) => d.slug === slug));
  const doc = slug ? DOCS[idx] : undefined;
  const Doc = doc?.component;
  const prev = doc && idx > 0 ? DOCS[idx - 1] : undefined;
  const next = doc && idx < DOCS.length - 1 ? DOCS[idx + 1] : undefined;

  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />

      <PageHeader path={`/ DOCS${doc ? ` / ${doc.title.toUpperCase()}` : ""}`} />

      <div className="mx-auto grid max-w-[1240px] gap-x-10 gap-y-6 px-4 py-6 sm:gap-x-14 sm:gap-y-10 sm:px-6 sm:py-10 md:px-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-14">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <nav className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:hidden" aria-label="Docs index">
            {DOCS.map((d, i) => (
              <a
                key={d.slug}
                href={`#/docs/${d.slug}`}
                className={`shrink-0 border px-2.5 py-2 font-mono text-[8.5px] tracking-[0.14em] transition-colors sm:px-3 sm:text-[9px] sm:tracking-[0.18em] ${
                  doc?.slug === d.slug ? "border-volt/70 bg-volt/10 text-volt" : "border-edge2 text-mute"
                }`}
              >
                0{i + 1} · {d.title.toUpperCase()}
              </a>
            ))}
          </nav>

          <nav className="hidden lg:block" aria-label="Docs index">
            {GROUPS.map((g) => (
              <div key={g} className="mb-8">
                <div className="mb-3 font-mono text-[8.5px] tracking-[0.28em] text-mute/60">{g}</div>
                {DOCS.filter((d) => d.group === g).map((d) => {
                  const i = DOCS.indexOf(d);
                  const active = doc?.slug === d.slug;
                  return (
                    <a
                      key={d.slug}
                      href={`#/docs/${d.slug}`}
                      className={`group relative flex items-baseline gap-3 border-l py-2.5 pl-4 font-mono text-[11px] tracking-[0.04em] transition-colors ${
                        active ? "border-volt text-volt" : "border-edge text-mute hover:border-mute hover:text-mist"
                      }`}
                    >
                      <span className={`text-[8.5px] ${active ? "text-volt/60" : "text-mute/40"}`}>0{i + 1}</span>
                      {d.title}
                    </a>
                  );
                })}
              </div>
            ))}
            <div className="border border-edge p-3.5">
              <div className="font-mono text-[8px] tracking-[0.22em] text-mute/60">SPEC STATUS</div>
              <div className="mt-2 flex items-center gap-2 font-mono text-[9.5px] text-mist">
                <span className="h-1.5 w-1.5 animate-pulse bg-volt" />
                V0.2 · LIVE ON TESTNET
              </div>
            </div>
          </nav>
        </aside>

        {!doc ? (
          <article className="min-w-0 max-w-[780px] pb-10">
            <div className="mb-8">
              <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt">
                <span className="h-1.5 w-1.5 bg-volt" />
                CIPHER SENTRY DOCS · V0.2
              </div>
              <h1 className="mt-5 font-display text-[clamp(2rem,4vw,3.4rem)] font-medium leading-[1.03] tracking-[-0.035em]">
                Six documents.{" "}
                <em className="font-serif font-normal italic tracking-[-0.015em] text-deepgreen">
                  Zero marketing hedges.
                </em>
              </h1>
            </div>
            <div className="grid gap-px border border-edge bg-edge sm:grid-cols-2">
              {DOCS.map((d, i) => (
                <a
                  key={d.slug}
                  href={`#/docs/${d.slug}`}
                  className="group bg-void p-5 transition-colors hover:bg-panel/70"
                >
                  <div className="flex items-baseline justify-between font-mono text-[8.5px] tracking-[0.24em] text-mute">
                    <span className="text-volt">{String(i + 1).padStart(2, "0")}</span>
                    <span>{d.group}</span>
                  </div>
                  <div className="mt-3 font-display text-[19px] font-semibold tracking-[-0.02em] text-mist transition-colors group-hover:text-volt">
                    {d.title}
                  </div>
                </a>
              ))}
            </div>
          </article>
        ) : (
          <article key={doc.slug} className="min-w-0 max-w-[780px] pb-10">
            {Doc ? <Doc /> : null}

            <div className="mt-12 grid grid-cols-1 gap-2.5 border-t border-edge pt-5 sm:mt-16 sm:grid-cols-2 sm:gap-3 sm:pt-6">
              {prev && (
                <a href={`#/docs/${prev.slug}`} className="group flex min-h-12 items-center gap-2.5 border border-edge px-3.5 py-3 transition-colors hover:border-volt/60 sm:px-4 sm:py-3.5">
                  <ArrowLeft size={13} className="shrink-0 text-mute transition-colors group-hover:text-volt" />
                  <span className="min-w-0">
                    <span className="block font-mono text-[7.5px] tracking-[0.22em] text-mute/50">PREV</span>
                    <span className="block truncate font-mono text-[10.5px] text-mist">{prev.title}</span>
                  </span>
                </a>
              )}
              {!prev && (
                <a href="#/docs" className="group flex min-h-12 items-center gap-2.5 border border-edge px-3.5 py-3 transition-colors hover:border-volt/60 sm:px-4 sm:py-3.5">
                  <ArrowLeft size={13} className="shrink-0 text-mute transition-colors group-hover:text-volt" />
                  <span className="font-mono text-[10.5px] tracking-[0.18em] text-volt">DOCS INDEX</span>
                </a>
              )}
              {next && (
                <a href={`#/docs/${next.slug}`} className="group flex min-h-12 items-center justify-end gap-2.5 border border-edge px-3.5 py-3 text-right transition-colors hover:border-volt/60 sm:col-start-2 sm:px-4 sm:py-3.5">
                  <span className="min-w-0">
                    <span className="block font-mono text-[7.5px] tracking-[0.22em] text-mute/50">NEXT</span>
                    <span className="block truncate font-mono text-[10.5px] text-mist">{next.title}</span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-mute transition-colors group-hover:text-volt" />
                </a>
              )}
            </div>

            <div className="mt-10 font-mono text-[8px] tracking-[0.24em] text-mute/40">
              CIPHER SENTRY LABS · DOCS V0.2 · ERRATA VIA GITHUB
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
