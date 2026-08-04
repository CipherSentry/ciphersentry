import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import LogoMark from "./LogoMark";
import { liveConsoleHref } from "../sdk/livePath";
import { SITE_NAV } from "./siteNav";

type Props = {
  /** e.g. "/ DOCS" or "/ EXPLORER" */
  path?: string;
  /** page-specific badge (status, live indicator) — right of path on md+ */
  badge?: ReactNode;
  /** override right CTA (default OPEN APP) */
  end?: ReactNode;
};

/**
 * Sticky subpage header — same links as landing Header, compact.
 * Use on every non-landing marketing/console page.
 */
export default function PageHeader({ path, badge, end }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-void/85 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
      <div className="flex h-12 items-center justify-between gap-3 px-4 sm:h-14 sm:px-6 md:px-12 lg:px-16">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <a href="#/" aria-label="Cipher Sentry — ciphersentry.xyz" className="group flex shrink-0 items-center">
            <LogoMark size={15} className="text-volt transition-transform duration-300 group-hover:scale-105" />
          </a>
          {path ? (
            <span className="hidden truncate font-mono text-[9px] tracking-[0.22em] text-mute md:inline">
              {path}
            </span>
          ) : null}
          {badge ? <div className="min-w-0 shrink">{badge}</div> : null}
        </div>

        <nav className="hidden flex-1 items-center justify-center gap-5 xl:gap-7 lg:flex" aria-label="Site">
          {SITE_NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="font-mono text-[9px] tracking-[0.18em] text-mute transition-colors hover:text-volt xl:text-[10px] xl:tracking-[0.2em]"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          {end ?? (
            <a
              href={liveConsoleHref()}
              className="flex min-h-9 items-center gap-1.5 border border-edge2 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em] text-mute transition-colors hover:border-volt/70 hover:text-volt sm:px-3 sm:tracking-[0.2em]"
            >
              OPEN APP
              <ArrowUpRight size={11} />
            </a>
          )}
        </div>
      </div>

      {/* compact secondary strip on <lg so pages keep site links */}
      <nav
        className="no-scrollbar flex gap-1 overflow-x-auto border-t border-edge/60 px-4 py-2 sm:px-6 lg:hidden"
        aria-label="Site"
      >
        {SITE_NAV.map((n) => (
          <a
            key={n.href}
            href={n.href}
            className="shrink-0 border border-edge2 px-2.5 py-1.5 font-mono text-[8px] tracking-[0.14em] text-mute transition-colors hover:border-volt/60 hover:text-volt"
          >
            {n.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
