/**
 * Runs `fetcher` now and then every `interval` ms while the tab is visible.
 * Refreshes immediately when the tab becomes visible again. Late responses from a previous
 * run (or a previous department) are discarded so the screen never flashes stale data.
 *
 *   const { data, error, loading, updatedAt, refresh } =
 *     usePolling(() => api.departmentQueue(id), { interval: 5000, deps: [id] });
 *
 * `deps` restarts the poll and clears `data` (use it for "which department am I looking at").
 * Keep the length of `deps` constant between renders.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function usePolling(fetcher, { interval = 10000, enabled = true, deps = [] } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const id = ++seq.current;
    try {
      const data = await fetcherRef.current();
      if (id !== seq.current) return;
      setState({ data, error: null, loading: false, updatedAt: new Date() });
    } catch (error) {
      if (id !== seq.current) return;
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false, updatedAt: null });
      return undefined;
    }
    setState({ data: null, error: null, loading: true, updatedAt: null });
    run();
    const timer = setInterval(() => {
      if (!document.hidden) run();
    }, interval);
    const onVisible = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      seq.current += 1; // invalidate anything still in flight
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, interval, run, ...deps]);

  return { ...state, refresh: run };
}
