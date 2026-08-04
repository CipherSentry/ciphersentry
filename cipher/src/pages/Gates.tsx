/**
 * Legacy route #/gates → same surface as #/cent.
 * App.tsx aliases /gates to Cent; this re-export keeps any direct imports working.
 */
export { default } from "./Cent";
