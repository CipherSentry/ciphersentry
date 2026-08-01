import { useCallback, useEffect, useState } from "react";
import {
  ensureOperatorKey,
  peekOperatorKey,
  rotateOperatorKey,
} from "./keys";
import type { OperatorKey } from "./keys";

/** Reactive access to the device-held operator key. Lazy-generates on first use. */
export function useOperator() {
  const [key, setKey] = useState<OperatorKey | null>(() => peekOperatorKey());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    if (!key) {
      setLoading(true);
      ensureOperatorKey()
        .then((k) => live && setKey(k))
        .catch(() => undefined)
        .finally(() => live && setLoading(false));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotate = useCallback(async () => {
    setLoading(true);
    const k = await rotateOperatorKey();
    setKey(k);
    setLoading(false);
    return k;
  }, []);

  /** adopt an imported key (already installed into custody by keys.ts) */
  const install = useCallback((k: OperatorKey) => setKey(k), []);

  return { key, loading, rotate, install };
}
