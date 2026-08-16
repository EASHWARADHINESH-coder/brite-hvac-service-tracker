import type { TicketStatus } from "../../types";

const STYLES: Record<TicketStatus, string> = {
  Open: "bg-amber-100 text-amber-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Closed: "bg-emerald-100 text-emerald-800",
  Reopened: "bg-rose-100 text-rose-800",
  Cancelled: "bg-slate-200 text-slate-600",
};

export default function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
