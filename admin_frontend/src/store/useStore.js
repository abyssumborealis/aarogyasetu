/**
 * Tiny global store (replaces js/store.js). No dependency: it's React's
 * useSyncExternalStore under the hood, and the API is deliberately Zustand-shaped
 * so you can swap it out later without touching the pages.
 *
 *   const token = useStore((s) => s.token);   // select PRIMITIVES or stable references
 *   actions.toast("Saved", "success");
 *   getState().token                           // outside React (used by services/api.js)
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "queue-admin:v1";

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

const saved = readSaved();

let state = {
  token: saved.token || null,          // staff JWT
  staff: saved.staff || null,          // { full_name, email, role, hospital_id } when the API returns it
  effects: saved.effects ?? true,      // cursor line follower, ring and tilt/magnetic effects
  deptId: saved.deptId ?? null,        // department open on the Staff queue page
  toasts: [],
};

const listeners = new Set();

function persist() {
  try {
    const { token, staff, effects, deptId } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, staff, effects, deptId }));
  } catch {
    /* storage blocked (private mode): the app still works, it just forgets on reload */
  }
}

function setState(patch) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  persist();
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getState = () => state;

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(subscribe, () => selector(state));
}

let toastSeq = 0;

export const actions = {
  setSession(token, staff) {
    setState({ token, staff: staff || null });
  },
  logout() {
    setState({ token: null, staff: null, deptId: null });
  },
  setEffects(effects) {
    setState({ effects });
  },
  setDeptId(deptId) {
    setState({ deptId });
  },

  /** kind: "info" | "success" | "warning" | "danger" */
  toast(message, kind = "info") {
    const id = ++toastSeq;
    setState((s) => ({ toasts: [...s.toasts, { id, message, kind, fading: false }] }));
    setTimeout(() => {
      setState((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, fading: true } : t)) }));
    }, 3800);
    setTimeout(() => actions.dismissToast(id), 4200);
  },
  dismissToast(id) {
    setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
};
