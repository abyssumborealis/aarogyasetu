import { actions, useStore } from "../store/useStore";

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-message toast-${t.kind}${t.fading ? " fade-out" : ""}`}
          onClick={() => actions.dismissToast(t.id)}
        >
          <span className="toast-dot" />
          {t.message}
        </div>
      ))}
    </div>
  );
}
