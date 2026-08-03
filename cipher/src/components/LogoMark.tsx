/**
 * Cipher Sentry mark — 4-point sentry star.
 * Single-color via `currentColor` (use `text-volt`). Square aspect.
 */
export default function LogoMark({
  size = 20,
  className = "",
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
      <path d="M32 2C33.1 23.2 40.8 30.9 62 32C40.8 33.1 33.1 40.8 32 62C30.9 40.8 23.2 33.1 2 32C23.2 30.9 30.9 23.2 32 2Z" />
    </svg>
  );
}
