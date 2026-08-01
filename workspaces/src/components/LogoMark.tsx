/**
 * Cipher Sentry mark — v1 ("cipher" wordform).
 * Hand-drawn chunky display letterforms for "cipher", round everywhere,
 * kissing tight. The trailing diamond at the registered position: the MARC
 * checkpoint. Horizontal lockup; svg sizes by height, width follows glyphs.
 */
const ASPECT = 130 / 40;

export default function LogoMark({
  size = 20,
  className = "",
  accent = "#edf1e5",
}: {
  size?: number;
  className?: string;
  accent?: string;
}) {
  return (
    <svg width={size * ASPECT} height={size} viewBox="0 0 130 40" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="9.5" strokeLinecap="round" strokeLinejoin="round">
        {/* c */}
        <path d="M16.9 17.4A6.9 6.9 0 1 0 16.9 29.8" />
        {/* i */}
        <path d="M24.5 30V13.5" />
        <path d="M24.5 9V8.2" strokeWidth="11" />
        {/* p */}
        <path d="M30.5 38V13.5H38A5 5 0 0 1 38 23H30.5" />
        {/* h */}
        <path d="M51.5 30V8.5" />
        <path d="M51.5 18Q51.5 13 57 13Q64 13 64 18V30" />
        {/* e */}
        <path d="M70.5 22C70.5 15.5 82.5 15 82.5 21.5H70.5C70.5 26.7 74.5 30 80 30" />
        {/* r */}
        <path d="M88.5 30V13.5H95A4.9 4.9 0 0 1 95 23H88.5" />
        <path d="M91.5 23L100 30" />
      </g>
      {/* the checkpoint diamond — registered position, MARC sentinel */}
      <path d="M110.5 21.2L115.7 26.4L110.5 31.6L105.3 26.4Z" fill={accent} stroke="none" />
    </svg>
  );
}
