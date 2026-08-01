import type { ReactNode } from "react";

/* ---- kicker / title ---- */

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt">
      <span className="h-1.5 w-1.5 bg-volt" />
      {children}
    </div>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mt-6 border-b border-edge pb-10">
      <h1 className="font-display text-[clamp(2.3rem,5vw,4rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        {children}
      </h1>
      {sub && (
        <div className="mt-4 font-mono text-[9.5px] tracking-[0.22em] text-mute">{sub}</div>
      )}
    </div>
  );
}

/* ---- sections ---- */

export function H2({ n, children }: { n: string; children: ReactNode }) {
  return (
    <h2 className="mt-12 flex items-baseline gap-3.5">
      <span className="font-mono text-[11px] text-volt/70">{n}</span>
      <span className="font-display text-[22px] font-semibold tracking-[-0.02em] text-mist">
        {children}
      </span>
    </h2>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 max-w-[680px] text-[14px] leading-[1.85] text-mute">{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 max-w-[640px] text-[16px] leading-[1.8] text-mist/75">{children}</p>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="border border-code-edge bg-code px-1.5 py-0.5 font-mono text-[11px] text-volt">
      {children}
    </span>
  );
}

export function Ul({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-4 space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[13.5px] leading-[1.75] text-mute">
          <span className="mt-[9px] h-1 w-1 shrink-0 bg-volt/70" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---- code block with dimmed comments ---- */

export function Code({ code, label }: { code: string; label?: string }) {
  return (
    <div className="surface-code relative mt-4 border border-volt/25">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-volt/50 to-transparent" />
      {label && (
        <div className="flex items-center justify-between border-b border-volt/15 px-4 py-2">
          <span className="flex items-center gap-2 font-mono text-[8px] tracking-[0.24em] text-volt/80">
            <span className="h-1 w-1 bg-volt" />
            {label}
          </span>
          <span className="font-mono text-[8px] tracking-[0.24em] text-volt/50">UTF-8</span>
        </div>
      )}
      <pre className="no-scrollbar overflow-x-auto p-5 font-mono text-[11.5px] leading-[1.9]">
        {code.split("\n").map((l, i) => (
          <div
            key={i}
            className={
              l.trim().startsWith("//") || l.trim().startsWith("#") || l.trim().startsWith("*")
                ? "text-code-mute"
                : "text-code-fg/90"
            }
          >
            {l || "\u00A0"}
          </div>
        ))}
      </pre>
    </div>
  );
}

/* ---- table ---- */

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="no-scrollbar mt-4 overflow-x-auto border border-edge">
      <table className="w-full min-w-[600px] border-collapse font-mono text-[11px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="border-b border-edge bg-panel/60 px-3.5 py-2.5 text-left text-[8.5px] font-normal tracking-[0.2em] text-mute"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-edge last:border-b-0">
              {r.map((c, j) => (
                <td key={j} className="px-3.5 py-2.5 align-top leading-[1.7] text-mist/80">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- callouts ---- */

export function Note({ children, label = "NOTE" }: { children: ReactNode; label?: string }) {
  return (
    <div className="mt-5 border-l-2 border-volt bg-volt/[0.045] px-4 py-3.5">
      <div className="font-mono text-[8.5px] tracking-[0.24em] text-volt">{label}</div>
      <div className="mt-1.5 max-w-[640px] text-[12.5px] leading-[1.75] text-mute">{children}</div>
    </div>
  );
}

export function Warn({ children, label = "WARNING" }: { children: ReactNode; label?: string }) {
  return (
    <div className="mt-5 border-l-2 border-amber-300 bg-amber-300/[0.05] px-4 py-3.5">
      <div className="font-mono text-[8.5px] tracking-[0.24em] text-amber-300">{label}</div>
      <div className="mt-1.5 max-w-[640px] text-[12.5px] leading-[1.75] text-mute">{children}</div>
    </div>
  );
}
