import { priorityInfo } from "../utils/format";

/** Shows nothing for normal priority - only emergencies and priority patients get flagged. */
export default function PriorityTag({ priority }) {
  const info = priorityInfo(priority);
  if (info.key === "normal") return null;
  return <span className={`priority-tag priority-${info.key}`}>{info.label}</span>;
}
