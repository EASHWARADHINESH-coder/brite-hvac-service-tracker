import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import StatusBadge from "../components/ui/StatusBadge";
import { getTicket } from "../api/services";
import type { TicketDetail as TD } from "../types";

/**
 * Phone-first, single-column view of one ticket (route: /m/ticket/:id).
 * Auth-gated and role-scoped (getTicket returns 403 if it isn't the user's task).
 * Renders without the desktop sidebar so it fills a phone screen; read-focused —
 * for editing, the "full view" link opens the desktop ticket page.
 */
export default function MobileTicket() {
  const { id } = useParams();
  const [ticket, setTicket] = useState<TD | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    getTicket(Number(id))
      .then(setTicket)
      .catch((e: unknown) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        setErr(status === 403 ? "You don't have access to this ticket." : "Ticket not found.");
      });
  }, [id]);

  if (err) return <Shell><p className="p-6 text-sm text-slate-500">{err}</p></Shell>;
  if (!ticket) return <Shell><p className="p-6 text-sm text-slate-400">Loading…</p></Shell>;

  return (
    <Shell>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-lg font-bold text-slate-800">{ticket.ticket_no}</div>
          <div className="truncate text-xs text-slate-400">{ticket.customer_name ?? "—"}</div>
        </div>
        <StatusBadge status={ticket.status} />
      </header>

      <div className="space-y-4 p-4">
        {!ticket.is_assigned && ticket.assign_by && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              ticket.assignment_overdue ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
            }`}
          >
            {ticket.assignment_overdue
              ? `Assignment overdue (by ${ticket.assign_by})`
              : `Assign by ${ticket.assign_by}`}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <Meta label="Complaint date" value={ticket.complaint_date} />
          <Meta label="Work type" value={ticket.work_type} />
          <Meta label="Machine" value={ticket.machine_type ?? "—"} />
          <Meta label="Skill" value={ticket.skill ?? "—"} />
          <Meta label="Primary complaint" value={ticket.primary_complaint ?? "—"} full />
          {ticket.total_amount != null && (
            <Meta label="Balance ₹" value={`₹${(ticket.balance ?? 0).toLocaleString("en-IN")}`} />
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Lifecycle</h2>
          <ol className="relative border-l border-slate-200 pl-5">
            {ticket.updates.map((u) => (
              <li key={u.id} className="mb-5">
                <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full bg-slate-400" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.stage}</span>
                  {u.reopen && (
                    <span className="rounded bg-rose-100 px-1.5 text-xs text-rose-700">reopen</span>
                  )}
                  <span className="text-xs text-slate-400">{u.action_date ?? ""}</span>
                </div>
                {u.job_lead && <div className="text-sm text-slate-500">Lead: {u.job_lead}</div>}
                {u.team.length > 0 && (
                  <div className="text-sm text-slate-500">Team: {u.team.map((t) => t.name).join(", ")}</div>
                )}
                {u.complaints && <div className="text-sm text-slate-500">Complaint: {u.complaints}</div>}
                {u.materials && <div className="text-sm text-slate-500">Materials: {u.materials}</div>}
                {u.remarks && <div className="text-sm text-slate-700">{u.remarks}</div>}
                {u.reopen_reason && (
                  <div className="text-sm text-rose-600">Reopen: {u.reopen_reason}</div>
                )}
              </li>
            ))}
          </ol>
        </div>

        <Link
          to={`/tickets/${ticket.id}`}
          className="block rounded-md border border-slate-300 py-2 text-center text-sm font-medium text-slate-700"
        >
          Open full view →
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-md bg-slate-50 text-slate-800">{children}</div>;
}

function Meta({ label, value, full = false }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
