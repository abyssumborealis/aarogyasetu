import { statusBadge } from "../utils/format";

/** Status pill using the design system's badge-* classes. */
export default function StatusBadge({ token, large = false }) {
  const { cls, label } = statusBadge(token);
  return (
    <span className={`status-badge ${cls}${large ? " badge-lg" : ""}`}>
      <span className="badge-dot" />
      {label}
    </span>
  );
}
