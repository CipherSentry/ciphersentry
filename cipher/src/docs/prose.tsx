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
    <div className="mt-5 border-b border-edge pb-8 sm:mt-6 sm:pb-10">
      <h1 className="font-display text-[clamp(1.85rem,6vw,4rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        {children}
      </h1>
      {sub && (
        <div className="mt-3 font-mono text-[8.5px] tracking-[0.18em] text-mute sm:mt-4 sm:text-[9.5px] sm:tracking-[0.22em]">
          {sub}
        </div>
      )}
    </div>
  );
}

/* ---- sections ---- */

export function H2({ n, children }: { n: string; children: ReactNode }) {
  return (
    <h2 className="mt-10 flex flex-wrap items-baseline gap-2.5 sm:mt-12 sm:gap-3.5">
      <span className="font-mono text-[11px] text-volt/70">{n}</span>
      <span className="font-display text-[clamp(1.15rem,3.5vw,1.375rem)] font-semibold tracking-[-0.02em] text-mist">
        {children}
      </span>
    </h2>
  );
}

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 max-w-[680px] text-[13.5px] leading-[1.85] text-mute sm:mt-4 sm:text-[14px]">
      {children}
    </p>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 max-w-[640px] text-[15px] leading-[1.8] text-mist/75 sm:mt-6 sm:text-[16px]">
      {children}
    </p>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="border border-code-edge bg-code px-1.5 py-0.5 font-mono text-[10.5px] text-volthot sm:text-[11px]">
      {children}
    </span>
  );
}

export function Ul({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-4 space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[13px] leading-[1.75] text-mute sm:text-[13.5px]">
          <span className="mt-[9px] h-1 w-1 shrink-0 bg-volt/70" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---- multi-tone code block (palette: green / deep green / peach / black) ---- */

const KW =
  /^(const|let|var|import|from|export|default|async|await|return|if|else|for|while|new|typeof|class|function|true|false|null|undefined|type|interface|extends|implements|void|as|in|of|try|catch|throw)$/;

type Seg = { t: string; c: string };

/** Lightweight highlighter using brand palette tokens on dark code wells. */
function tokenize(line: string): Seg[] {
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  ) {
    return [{ t: line, c: "text-code-mute" }];
  }

  const out: Seg[] = [];
  // tokens: strings | numbers | words | punctuation/space
  const re =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const [, str, num, word, space, other] = m;
    if (str) out.push({ t: str, c: "text-code-str" }); // green-lime strings
    else if (num) out.push({ t: num, c: "text-volthot" }); // hot green numbers
    else if (word) {
      if (KW.test(word)) out.push({ t: word, c: "text-volt" }); // emerald keywords
      else if (/^[A-Z]/.test(word)) out.push({ t: word, c: "text-code-peach" }); // peach types
      else out.push({ t: word, c: "text-code-fg/90" });
    } else if (space) out.push({ t: space, c: "text-code-fg/90" });
    else if (other) out.push({ t: other, c: "text-code-mute" }); // punctuation
  }
  return out.length ? out : [{ t: line || "\u00A0", c: "text-code-fg/90" }];
}

export function Code({ code, label }: { code: string; label?: string }) {
  return (
    <div className="surface-code relative mt-4 max-w-full border border-volt/20">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-volthot/45 to-transparent" />
      {label && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-code-edge px-3 py-2 sm:px-4">
          <span className="flex min-w-0 items-center gap-2 font-mono text-[8px] tracking-[0.2em] text-volthot sm:tracking-[0.24em]">
            <span className="h-1 w-1 shrink-0 bg-volthot" />
            <span className="truncate">{label}</span>
          </span>
          <span className="font-mono text-[8px] tracking-[0.2em] text-code-mute sm:tracking-[0.24em]">
            UTF-8
          </span>
        </div>
      )}
      <pre className="no-scrollbar overflow-x-auto p-3.5 font-mono text-[11px] leading-[1.85] sm:p-5 sm:text-[11.5px] sm:leading-[1.9]">
        {code.split("\n").map((l, i) => (
          <div key={i} className="whitespace-pre">
            {tokenize(l).map((seg, j) => (
              <span key={j} className={seg.c}>
                {seg.t || "\u00A0"}
              </span>
            ))}
            {!l && "\u00A0"}
          </div>
        ))}
      </pre>
    </div>
  );
}

/* ---- table ---- */

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="no-scrollbar mt-4 -mx-1 overflow-x-auto border border-edge sm:mx-0">
      <table className="w-full min-w-[520px] border-collapse font-mono text-[10.5px] sm:min-w-[600px] sm:text-[11px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="border-b border-edge bg-panel/60 px-2.5 py-2 text-left text-[8px] font-normal tracking-[0.16em] text-mute sm:px-3.5 sm:py-2.5 sm:text-[8.5px] sm:tracking-[0.2em]"
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
                <td key={j} className="px-2.5 py-2 align-top leading-[1.7] text-mist/80 sm:px-3.5 sm:py-2.5">
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
    <div className="mt-5 border-l-2 border-volt bg-volt/[0.045] px-3.5 py-3 sm:px-4 sm:py-3.5">
      <div className="font-mono text-[8.5px] tracking-[0.24em] text-volt">{label}</div>
      <div className="mt-1.5 max-w-[640px] text-[12.5px] leading-[1.75] text-mute">{children}</div>
    </div>
  );
}

export function Warn({ children, label = "WARNING" }: { children: ReactNode; label?: string }) {
  return (
    <div className="mt-5 border-l-2 border-amber-300 bg-amber-300/[0.05] px-3.5 py-3 sm:px-4 sm:py-3.5">
      <div className="font-mono text-[8.5px] tracking-[0.24em] text-amber-600">{label}</div>
      <div className="mt-1.5 max-w-[640px] text-[12.5px] leading-[1.75] text-mute">{children}</div>
    </div>
  );
}
