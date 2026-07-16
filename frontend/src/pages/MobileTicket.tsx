import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import StatusBadge from "../components/ui/StatusBadge";
import { addTicketUpdate, getTicket } from "../api/services";
import { useAuth } from "../context/AuthContext";
import { LIFECYCLE_STAGES } from "../types";
import type { LifecycleStage, TicketDetail as TD } from "../types";

const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Phone-first view of one ticket (route: /m/ticket/:id), auth-gated and role-scoped.
 * Edit-capable roles (Admin / Engineer / Technician) get a compact action panel to add a
 * lifecycle update, close, or reopen from the phone. The guided materials/BSL flow stays on
 * the desktop ticket page ("Open full view").
 */
export default function MobileTicket() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { canEditTasks } = useAuth();

  const [ticket, setTicket] = useState<TD | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    getTicket(ticketId)
      .then((t) => { setTicket(t); setErr(null); })
      .catch((e: unknown) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        setErr(status === 403 ? "You don't have access to this ticket." : "Ticket not found.");
      });

  useEffect(() => { load(); }, [ticketId]);

  if (err) return <Shell><p className="p-6 text-sm text-slate-500">{err}</p></Shell>;
  if (!ticket) return <Shell><p className="p-6 text-sm text-slate-400">Loading…</p></Shell>;

  const isClosed = ticket.status === "Closed";

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

        {ticket.mr_pending && (
          <div className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-800">
            MR Pending — Blue Star claim not yet completed
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

        {/* Editable action panel — edit-capable roles only */}
        {canEditTasks && <ActionPanel ticket={ticket} isClosed={isClosed} onSaved={load} />}

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

function ActionPanel({
  ticket,
  isClosed,
  onSaved,
}: {
  ticket: TD;
  isClosed: boolean;
  onSaved: () => Promise<void>;
}) {
  // Sensible default stage: reopen if closed, else assign, else advance work.
  const defaultStage: LifecycleStage = isClosed
    ? "Reopened"
    : !ticket.is_assigned
      ? "Assigned"
      : "Work Started";

  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<LifecycleStage>(defaultStage);
  const [date, setDate] = useState(todayStr());
  const [jobLead, setJobLead] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        stage,
        action_date: date || null,
        job_lead: jobLead.trim() || null,
        remarks: remarks.trim() || null,
      };
      if (stage === "Closed") payload.end_date = date || todayStr();
      if (stage === "Reopened") { payload.reopen = true; payload.reopen_reason = remarks.trim() || null; }
      await addTicketUpdate(ticket.id, payload);
      setJobLead(""); setRemarks(""); setOpen(false);
      await onSaved();
    } catch (e2: unknown) {
      const detail = (e2 as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const fieldCls =
    "w-full rounded-md border border-slate-300 px-3 py-2.5 text-base focus:border-slate-500 focus:outline-none";

  if (!open) {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => { setStage(defaultStage); setOpen(true); }}
          className="flex-1 rounded-md bg-slate-800 py-3 text-base font-medium text-white"
        >
          {isClosed ? "Reopen job" : "Add update"}
        </button>
        {!isClosed && (
          <button
            onClick={() => { setStage("Closed"); setOpen(true); }}
            className="flex-1 rounded-md border border-slate-300 py-3 text-base font-medium text-slate-700"
          >
            Close job
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Update this job</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400">
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">Stage</span>
        <select value={stage} onChange={(e) => setStage(e.target.value as LifecycleStage)} className={fieldCls}>
          {LIFECYCLE_STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">
          {stage === "Closed" ? "Close date" : "Date"}
        </span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldCls} />
      </label>

      {stage === "Assigned" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Job lead (optional)</span>
          <input value={jobLead} onChange={(e) => setJobLead(e.target.value)}
            placeholder="Lead technician name" className={fieldCls} />
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">
          {stage === "Reopened" ? "Reopen reason / remarks" : "Remarks"}
        </span>
        <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={fieldCls} />
      </label>

      <button type="submit" disabled={saving}
        className="w-full rounded-md bg-slate-800 py-3 text-base font-medium text-white disabled:opacity-50">
        {saving ? "Saving…" : stage === "Closed" ? "Close ticket" : stage === "Reopened" ? "Reopen ticket" : "Add update"}
      </button>
    </form>
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
