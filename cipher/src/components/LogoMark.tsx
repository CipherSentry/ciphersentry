/**
 * Cipher Sentry mark — 4-point sentry star.
 * Single-color via `currentColor` (use `text-volt`). Square aspect.
 * Concave arms read as a spark/guard node at small sizes.
 */
export default function LogoMark({
  size = 20,
  className = "",
  // kept for call-site compat; mark is monochrome
  accent: _accent,
}: {
  size?: number;
  className?: string;
  accent?: string;
}) {
  void _accent;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      {/*
        4-point star — sharp cardinal tips, deep concave flanks.
        Tuned so 16–20px still reads as a star, not a plus.
      */}
      <path d="M32 2C33.1 23.2 40.8 30.9 62 32C40.8 33.1 33.1 40.8 32 62C30.9 40.8 23.2 33.1 2 32C23.2 30.9 30.9 23.2 32 2Z" />
    </svg>
  );
}
