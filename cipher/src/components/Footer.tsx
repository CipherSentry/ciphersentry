import { ArrowUpRight, Globe } from "lucide-react";
import LogoMark from "./LogoMark";
import { GithubIcon, SOCIALS, XIcon } from "./Social";
import { liveConsoleHref } from "../sdk/livePath";

const COLS: { h: string; links: [string, string][] }[] = [
  {
    h: "PROTOCOL",
    links: [
      ["Specification", "#/docs/specification"],
      ["SDK Reference", "#/docs/sdk"],
      ["Verification", "#/docs/verification"],
      ["Whitepaper", "#/docs/whitepaper"],
      ["Tokenomics", "#/docs/tokenomics"],
      ["Audit Readiness", "#/docs/audit"],
    ],
  },
  {
    h: "NETWORK",
    links: [
      ["Try the Flow", liveConsoleHref({ path: "/demo" })],
      ["Launch Gates", "#/gates"],
      ["CENT / Orynth pack", "#/cent"],
      ["Task Explorer", "#/explorer"],
      ["Ops Console", liveConsoleHref()],
    ],
  },
  {
    h: "PROJECT",
    links: [
      ["Investors", "#/investors"],
      ["Manifesto", "#/docs/manifesto"],
      ["GitHub", SOCIALS.github],
      ["X / @cipher_sentry", SOCIALS.x],
      ["Contact", "mailto:hello@ciphersentry.xyz"],
    ],
  },
];

const SOCIAL_ICONS = [
  { Icon: XIcon, href: SOCIALS.x, label: "X — @ciphersentry" },
  { Icon: GithubIcon, href: SOCIALS.github, label: "GitHub — CipherSentry" },
  { Icon: Globe, href: "#top", label: "ciphersentry.xyz" },
];

function SmartLink({
  href,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className={className}
      aria-label={ariaLabel}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

export default function Footer() {
  return (
    <footer>
      <div className="grid gap-10 px-4 py-14 sm:gap-14 sm:px-8 sm:py-20 md:px-16 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        {/* brand */}
        <div>
          <a href="#top" aria-label="Cipher Sentry — ciphersentry.xyz" className="group flex items-center">
            <LogoMark size={17} className="text-volt transition-transform duration-300 group-hover:scale-105" />
          </a>
          <p className="mt-6 max-w-[260px] text-[13px] leading-[1.75] text-mute">
              The guardian layer for agents that work. Built by agents,
              audited by humans.
          </p>
          <div className="mt-7 inline-flex items-center gap-2.5 border border-edge px-3.5 py-2.5 font-mono text-[9px] tracking-[0.22em] text-mute">
            <span className="h-1.5 w-1.5 animate-pulse bg-volt" />
            ALL SYSTEMS OPERATIONAL · 214 AGENTS ONLINE
          </div>
          <div className="mt-5 flex items-center gap-2.5">
            {SOCIAL_ICONS.map(({ Icon, href, label }) => (
              <SmartLink
                key={label}
                href={href}
                ariaLabel={label}
                className="flex h-9 w-9 items-center justify-center border border-edge text-mute transition-colors duration-300 hover:border-volt/60 hover:text-volt"
              >
                <Icon size={14} />
              </SmartLink>
            ))}
            <span className="ml-1 font-mono text-[8px] tracking-[0.2em] text-mute/50">
              @CIPHER_SENTRY · OSS
            </span>
          </div>
        </div>

        {/* link columns */}
        {COLS.map((c) => (
          <div key={c.h}>
            <div className="font-mono text-[10px] tracking-[0.28em] text-mute/60">
              {c.h}
            </div>
            <ul className="mt-6 space-y-3.5">
              {c.links.map(([l, href]) => {
                const external = href.startsWith("http");
                return (
                  <li key={l}>
                    <SmartLink
                      href={href}
                      className="group inline-flex items-baseline gap-2 text-[13.5px] text-mute transition-colors duration-300 hover:text-mist"
                    >
                      <span className="h-1 w-1 shrink-0 translate-y-[-1px] bg-edge2 transition-colors duration-300 group-hover:bg-volt" />
                      {l}
                      {external && (
                        <ArrowUpRight size={10} className="translate-y-[1px] text-mute/40 transition-colors duration-300 group-hover:text-volt" />
                      )}
                    </SmartLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* bottom bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-4 py-5 font-mono text-[8.5px] tracking-[0.16em] text-mute/60 sm:gap-4 sm:px-8 sm:py-6 sm:text-[9px] sm:tracking-[0.22em] md:px-16 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <span>© 2026 CIPHER SENTRY LABS · EST. 2026 — THE YEAR AGENTS SHIP</span>
        <span className="hidden md:block">AGENT SECURITY PROTOCOL / V0.2</span>
        <span className="text-mute/40">NO HUMANS WERE CONSULTED</span>
      </div>
    </footer>
  );
}
