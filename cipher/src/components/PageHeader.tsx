import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import LogoMark from "./LogoMark";
import { liveConsoleHref } from "../sdk/livePath";

type Props = {
  /** e.g. "/ DOCS" or "/ EXPLORER" */
  path?: string;
  /** page-specific badge (status, live indicator) — right of path on md+ */
  badge?: ReactNode;
  /** override right actions (default ← HOME + OPEN APP) */
  end?: ReactNode;
};

/**
 * Sticky subpage header — compact chrome from before site-nav unify.
 * Landing keeps the full Header; subpages stay logo / path / home / app.
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

        <div className="flex shrink-0 items-center gap-3 sm:gap-5">
          {end ?? (
            <>
              <a
                href="#/"
                className="hidden items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-mute transition-colors hover:text-volt sm:flex"
              >
                ← HOME
              </a>
              <a
                href={liveConsoleHref()}
                className="flex min-h-9 items-center gap-1.5 border border-edge2 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em] text-mute transition-colors hover:border-volt/70 hover:text-volt sm:px-3 sm:tracking-[0.2em]"
              >
                OPEN APP
                <ArrowUpRight size={11} />
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
