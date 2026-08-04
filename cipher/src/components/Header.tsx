import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, SquareTerminal, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import LogoMark from "./LogoMark";
import { openAccessModal } from "./AccessModal";
import NodeHealth from "./NodeHealth";
import { liveConsoleHref } from "../sdk/livePath";
import { SITE_NAV } from "./siteNav";

const LIVE_APP = liveConsoleHref();
const NAV = SITE_NAV;

function LiveBlock() {
  const [blk, setBlk] = useState(12840112);
  useEffect(() => {
    const id = setInterval(() => setBlk((b) => b + 1), 2100);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="hidden items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-mute/60 xl:flex">
      <span className="h-1 w-1 animate-pulse bg-volt" />
      <span className="tabular-nums">BLK {blk.toLocaleString("en-US")}</span>
    </span>
  );
}

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-edge bg-void pt-[env(safe-area-inset-top,0px)]">
      <div className="flex h-[60px] items-center justify-between px-4 sm:h-[68px] sm:px-6 md:px-10 lg:px-16">
        <a href="#/" aria-label="Cipher Sentry — ciphersentry.xyz" className="group flex shrink-0 items-center">
          <LogoMark size={17} className="text-volt transition-transform duration-300 group-hover:scale-105" />
        </a>

        {/* full nav only at lg — 6 mono links overflow on tablet */}
        <nav className="hidden flex-1 items-center justify-center gap-6 xl:gap-9 lg:flex">
          {NAV.map((n, i) => (
            <a
              key={n.label}
              href={n.href}
              className="group relative flex items-baseline gap-1.5 font-mono text-[10px] tracking-[0.18em] text-mute transition-colors duration-300 hover:text-mist xl:tracking-[0.22em]"
            >
              <span className="text-[8px] text-volt/50 transition-colors duration-300 group-hover:text-volt">
                0{i + 1}
              </span>
              {n.label}
              <span className="absolute -bottom-1.5 left-0 h-px w-0 bg-volt transition-all duration-300 group-hover:w-full" />
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3 sm:gap-5 lg:gap-6">
          <NodeHealth className="hidden lg:inline-flex" />
          <LiveBlock />
          <a
            href={LIVE_APP}
            title="Live console · ?net=rpc&auth=1"
            className="group hidden items-center gap-2 border border-edge2 px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-mute transition-colors duration-300 hover:border-volt/70 hover:text-volt lg:flex xl:px-4 xl:py-2.5"
          >
            LIVE CONSOLE
            <SquareTerminal size={12} strokeWidth={2} className="transition-colors duration-300 group-hover:text-volt" />
          </a>
          <button
            type="button"
            onClick={openAccessModal}
            className="group hidden items-center gap-2 bg-volt px-3 py-2 font-mono text-[10px] font-semibold tracking-[0.2em] text-void transition-all duration-300 hover:bg-mist md:flex xl:px-4 xl:py-2.5"
          >
            REQUEST ACCESS
            <ArrowUpRight size={13} strokeWidth={2.5} className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-10 w-10 items-center justify-center border border-edge2 text-mist transition-colors hover:border-volt/60 hover:text-volt lg:hidden"
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-edge bg-void lg:hidden"
          >
            <div className="flex max-h-[min(70svh,520px)] flex-col gap-1 overflow-y-auto px-4 py-5 sm:px-6">
              {NAV.map((n, i) => (
                <a
                  key={n.label}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center justify-between border-b border-edge/60 py-3.5 font-mono text-xs tracking-[0.2em] text-mist sm:tracking-[0.25em]"
                >
                  <span>{n.label}</span>
                  <span className="text-volt/60">0{i + 1}</span>
                </a>
              ))}
              <button
                onClick={() => {
                  setOpen(false);
                  openAccessModal();
                }}
                className="mt-4 flex min-h-12 items-center justify-center gap-2 bg-volt px-4 py-3.5 font-mono text-[11px] font-semibold tracking-[0.2em] text-void"
              >
                REQUEST ACCESS
                <ArrowUpRight size={14} strokeWidth={2.5} />
              </button>
              <a
                href={LIVE_APP}
                onClick={() => setOpen(false)}
                className="mt-2 flex min-h-12 items-center justify-center gap-2 border border-edge2 px-4 py-3.5 font-mono text-[11px] tracking-[0.2em] text-mist transition-colors hover:border-volt/70 hover:text-volt"
              >
                LIVE CONSOLE
                <SquareTerminal size={14} strokeWidth={2} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
