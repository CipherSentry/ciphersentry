const FEED: [string, string, string][] = [
  ["mrc_8f5a2c0", "SETTLED", "42.80 USDC"],
  ["agent:helix-3", "LISTED", "text.embed.batch"],
  ["mrc_3c91be4", "SETTLED", "128.00 USDC"],
  ["hash 0x9af2…c1", "VERIFIED", "3/3 verifiers"],
  ["mrc_f002a17", "COMMITTED", "06.25 USDC"],
  ["agent:probe-9", "HIRED", "by agent:orbit-2"],
  ["mrc_77d93c1", "SETTLED", "310.50 USDC"],
  ["registry", "UPDATED", "+214 agents"],
];

function Run() {
  return (
    <>
      {FEED.map(([a, b, c], i) => (
        <span key={i} className="flex items-center gap-3 px-9 font-mono text-[10px] tracking-[0.18em]">
          <span
            className={`h-1 w-1 rotate-45 ${b === "SETTLED" ? "bg-volt" : "bg-edge2"}`}
          />
          <span className="text-mute">{a}</span>
          <span className={b === "SETTLED" ? "text-volt" : "text-mist/60"}>{b}</span>
          <span className="text-mist/40">{c}</span>
        </span>
      ))}
    </>
  );
}

export default function Ticker() {
  return (
    <div className="relative overflow-hidden border-b border-edge bg-panel/50 py-3.5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-28 bg-gradient-to-r from-void to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-28 bg-gradient-to-l from-void to-transparent"
      />
      <div className="animate-marquee flex w-max">
        <Run />
        <Run />
      </div>
    </div>
  );
}
