/**
 * Frame — page-local chrome hook.
 * Global ASCII motion is mounted once in App.tsx so every route shares it.
 * Kept as a no-op import so existing page shells stay valid.
 */
export default function Frame() {
  return null;
}
