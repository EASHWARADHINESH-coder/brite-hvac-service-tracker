import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import StatusBadge from "../components/ui/StatusBadge";
import TicketForm from "../components/forms/TicketForm";
import {
  Button,
  Combobox,
  Modal,
  PageHeader,
  Input,
  Pagination,
  Table,
  TableSkeleton,
  usePagination,
  useTableSort,
} from "../components/ui/primitives";
import { useToast } from "../components/ui/Toast";
import {
  addTicketUpdate,
  exportTickets,
  listCustomers,
  listTeam,
  listTickets,
} from "../api/services";
import { useAuth } from "../context/AuthContext";
import { WORK_TYPES } from "../types";
import type { Customer, TeamMember, Ticket, TicketStatus, WorkType } from "../types";

const STATUSES: TicketStatus[] = ["Open", "In Progress", "Closed", "Reopened", "Cancelled"];

// Days since the complaint was logged.
const ageDays = (t: Ticket) =>
  Math.max(0, Math.floor((Date.now() - new Date(t.complaint_date + "T00:00:00").getTime()) / 86_400_000));

// Age colour: fresh (green) → ageing (amber) → stale (rose), matching the dashboard buckets.
const ageColor = (days: number) =>
  days <= 2 ? "text-emerald-600" : days <= 5 ? "text-amber-600" : "text-rose-600";

// A subtle left-border accent per status, so the table reads as a pipeline at a glance.
const STATUS_ACCENT: Record<string, string> = {
  Open: "border-l-amber-400",
  "In Progress": "border-l-blue-400",
  Closed: "border-l-emerald-400",
  Reopened: "border-l-rose-400",
  Cancelled: "border-l-slate-300",
};

export default function Tickets() {
  const { isPrivileged } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  // /tickets/new keeps working as a deep link: it just opens the modal over the list.
  const creating = location.pathname === "/tickets/new";
  // /tickets and /tickets/new are separate routes, so navigating between them remounts this
  // component. Carry the new ticket id in navigation state so the banner survives the remount.
  const createdId = (location.state as { createdId?: number } | null)?.createdId ?? null;
  const [dismissed, setDismissed] = useState(false);
  const justCreated = dismissed ? null : createdId;
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Filters live in the URL so dashboard KPIs can deep-link here and views stay shareable.
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const workType = params.get("work_type") ?? "";
  const customerId = params.get("customer_id") ?? "";
  const q = params.get("q") ?? "";
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  const mrPending = params.get("mr_pending") === "true";
  const defectivePending = params.get("defective_pending") === "true";
  const overdue = params.get("overdue") === "true";
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  // ---- bulk selection ----
  const [selected, setSelected] = useState<number[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [bulkAssign, setBulkAssign] = useState(false);
  const [bulkClose, setBulkClose] = useState(false);
  const [bulkLead, setBulkLead] = useState("");
  const [working, setWorking] = useState(false);
  const toast = useToast();

  const setParam = (key: string, value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  useEffect(() => { listCustomers().then(setCustomers); }, []);
  useEffect(() => { if (isPrivileged) listTeam().then(setTeam).catch(() => setTeam([])); }, [isPrivileged]);

  // Status + attention (overdue / MR / defective) are faceted client-side so the chips can show
  // live counts and toggle instantly; work type / customer / search stay server-side.
  useEffect(() => {
    listTickets({
      work_type: (workType || undefined) as WorkType | undefined,
      customer_id: customerId ? Number(customerId) : undefined,
      q: q || undefined,
    })
      .then(setTickets)
      .catch(() => toast.error("Couldn't load tickets", "The backend may be unreachable."))
      .finally(() => setLoading(false));
  }, [workType, customerId, q, createdId]);

  const isOverdue = (t: Ticket) => !t.is_assigned && !!t.assignment_overdue;

  // Base = everything loaded for the current work-type/customer/search, within the date range.
  // Facet counts are computed from the base so each chip shows its own total.
  const base = tickets.filter((t) => {
    if (start && t.complaint_date < start) return false;
    if (end && t.complaint_date > end) return false;
    return true;
  });
  const statusCounts = base.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const attentionCounts = {
    overdue: base.filter(isOverdue).length,
    mr: base.filter((t) => t.mr_pending).length,
    defective: base.filter((t) => t.defective_pending).length,
  };
  const shown = base.filter((t) => {
    if (status && t.status !== status) return false;
    if (overdue && !isOverdue(t)) return false;
    if (mrPending && !t.mr_pending) return false;
    if (defectivePending && !t.defective_pending) return false;
    return true;
  });

  const { rows: sortedRows, sort } = useTableSort(shown, {
    ticket_no: (t) => t.ticket_no,
    customer: (t) => t.customer_name ?? "",
    city: (t) => t.customer_city ?? "",
    work_type: (t) => t.work_type,
    machine: (t) => t.machine_type ?? "",
    skill: (t) => t.skill ?? "",
    status: (t) => t.status,
    age: (t) => ageDays(t),
  });
  const { pageRows, ...pag } = usePagination(sortedRows, 25);

  const customerName = customers.find((c) => String(c.id) === customerId)?.name;
  const chips = [
    status && { key: "status", label: `Status: ${status}` },
    workType && { key: "work_type", label: `Work type: ${workType}` },
    customerId && { key: "customer_id", label: `Customer: ${customerName ?? customerId}` },
    q && { key: "q", label: `Ticket no: ${q}` },
    start && { key: "start", label: `From: ${start}` },
    end && { key: "end", label: `To: ${end}` },
    mrPending && { key: "mr_pending", label: "MR Pending" },
    defectivePending && { key: "defective_pending", label: "Defective Part pending" },
  ].filter(Boolean) as { key: string; label: string }[];

  // ---- bulk actions ----
  const selectedTickets = sortedRows.filter((t) => selected.includes(t.id));
  const allShownSelected = sortedRows.length > 0 && selected.length === sortedRows.length;
  const toggleAll = () =>
    setSelected(allShownSelected ? [] : sortedRows.map((t) => t.id));
  const toggleOne = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const today = () => new Date().toISOString().slice(0, 10);

  /** Applies one lifecycle update per selected ticket, reporting partial failures honestly. */
  const runBulk = async (
    payload: (t: Ticket) => Record<string, unknown>,
    verb: string,
  ) => {
    setWorking(true);
    const results = await Promise.allSettled(
      selectedTickets.map((t) => addTicketUpdate(t.id, payload(t))),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    const ok = results.length - failed;
    setWorking(false);
    setBulkAssign(false);
    setBulkClose(false);
    setSelected([]);
    setBulkLead("");
    // Refetch so the list reflects the new statuses.
    setLoading(true);
    listTickets({
      work_type: (workType || undefined) as WorkType | undefined,
      customer_id: customerId ? Number(customerId) : undefined,
      q: q || undefined,
    }).then(setTickets).finally(() => setLoading(false));

    if (failed === 0) toast.success(`${ok} ticket${ok === 1 ? "" : "s"} ${verb}`);
    else if (ok === 0) toast.error(`Couldn't ${verb.replace(/ed$/, "")} any tickets`);
    else toast.error(`${ok} ${verb}, ${failed} failed`, "Open the failed tickets individually.");
  };

  const doBulkAssign = () => {
    const lead = team.find((m) => String(m.id) === bulkLead);
    if (!lead) { toast.error("Pick a job lead first"); return; }
    runBulk(() => ({ stage: "Assigned", action_date: today(), job_lead: lead.name }), "assigned");
  };

  const doBulkClose = () =>
    runBulk(() => ({ stage: "Closed", action_date: today(), end_date: today() }), "closed");

  const doExport = async () => {
    setExporting(true);
    try {
      await exportTickets({ start, end, status, work_type: workType });
      toast.success("Export ready", "The Excel file has been downloaded.");
    } catch {
      toast.error("Export failed", "Couldn't generate the Excel file.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Tickets"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={doExport} disabled={exporting}>
              {exporting ? "Exporting…" : "⬇ Export to Excel"}
            </Button>
            {isPrivileged && (
              <Button onClick={() => nav("/tickets/new")}>＋ New Ticket</Button>
            )}
          </div>
        }
      />

      <Modal open={creating} title="Create Ticket" onClose={() => nav("/tickets")}>
        <TicketForm
          // Stay on the list (locked decision A3) and flag the new row.
          onCreated={(t) => nav("/tickets", { state: { createdId: t.id } })}
        />
      </Modal>

      {justCreated !== null && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Ticket created.{" "}
          <Link to={`/tickets/${justCreated}`} className="font-medium underline">
            Open it
          </Link>
          <button onClick={() => setDismissed(true)} className="float-right text-emerald-600">✕</button>
        </div>
      )}
      {/* Status pipeline chips — one-click filter + a live count per status (the at-a-glance
          pipeline). "All" clears the status filter. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <StatusChip label="All" count={base.length} active={!status} onClick={() => setParam("status", "")} />
        {STATUSES.map((s) => (
          <StatusChip
            key={s}
            label={s}
            count={statusCounts[s] ?? 0}
            active={status === s}
            onClick={() => setParam("status", status === s ? "" : s)}
          />
        ))}
      </div>

      {/* Attention chips — the problem buckets, toggle to filter. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-slate-400">Attention</span>
        <AttnChip label="Assignment overdue" count={attentionCounts.overdue} active={overdue} tone="rose"
          onClick={() => setParam("overdue", overdue ? "" : "true")} />
        <AttnChip label="MR pending" count={attentionCounts.mr} active={mrPending} tone="amber"
          onClick={() => setParam("mr_pending", mrPending ? "" : "true")} />
        <AttnChip label="Defective return" count={attentionCounts.defective} active={defectivePending} tone="orange"
          onClick={() => setParam("defective_pending", defectivePending ? "" : "true")} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Input placeholder="Search ticket no…" value={q}
          onChange={(e) => setParam("q", e.target.value)} />
        <Combobox
          placeholder="All customers"
          value={customerId}
          onChange={(v) => setParam("customer_id", v)}
          options={customers.map((c) => ({
            value: String(c.id),
            label: c.name,
            hint: c.city || undefined,
          }))}
        />
        <Combobox
          placeholder="All work types"
          value={workType}
          onChange={(v) => setParam("work_type", v)}
          options={WORK_TYPES.map((w) => ({ value: w, label: w }))}
        />
        <Input type="date" value={start} title="Complaint date from"
          onChange={(e) => setParam("start", e.target.value)} />
        <Input type="date" value={end} title="Complaint date to"
          onChange={(e) => setParam("end", e.target.value)} />
      </div>

      {/* Active filters — shows what a dashboard KPI click applied, and lets you undo it. */}
      {chips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">Filtered by</span>
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setParam(c.key, "")}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              {c.label}
              <span className="text-slate-400">✕</span>
            </button>
          ))}
          <button
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
            className="text-xs text-sky-600 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Bulk action bar — only appears once something is selected. */}
      {isPrivileged && selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm">
          <span className="font-semibold text-sky-900">
            {selected.length} selected
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setBulkAssign(true)}>Assign…</Button>
            <Button variant="ghost" onClick={() => setBulkClose(true)}>Close…</Button>
            <Button variant="ghost" onClick={() => setSelected([])}>Clear</Button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={isPrivileged ? 10 : 9} rows={6} />
      ) : (
      <>
      <Table
        sort={sort}
        head={[
          ...(isPrivileged
            ? [{
                label: (
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allShownSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer align-middle"
                  />
                ),
              }]
            : []),
          "S.No",
          { label: "Ticket No.", key: "ticket_no" },
          { label: "Customer", key: "customer" },
          { label: "City", key: "city" },
          { label: "Work Type", key: "work_type" },
          { label: "Machine", key: "machine" },
          { label: "Skill", key: "skill" },
          { label: "Age", key: "age" },
          { label: "Status", key: "status" },
        ]}
      >
        {pageRows.map((t, i) => (
          <tr
            key={t.id}
            className={`border-l-4 ${STATUS_ACCENT[t.status] ?? "border-l-transparent"} ${
              selected.includes(t.id)
                ? "bg-sky-50"
                : t.id === justCreated
                  ? "bg-emerald-50"
                  : ""
            }`}
          >
            {isPrivileged && (
              <td className="px-4 py-2">
                <input
                  type="checkbox"
                  aria-label={`Select ${t.ticket_no}`}
                  checked={selected.includes(t.id)}
                  onChange={() => toggleOne(t.id)}
                  className="h-4 w-4 cursor-pointer align-middle"
                />
              </td>
            )}
            <td className="px-4 py-2 text-slate-400">{pag.start + i + 1}</td>
            <td className="px-4 py-2 font-mono font-medium">
              <Link to={`/tickets/${t.id}`} className="text-sky-600 hover:underline">
                {t.ticket_no}
              </Link>
            </td>
            <td className="px-4 py-2">{t.customer_name ?? "—"}</td>
            <td className="px-4 py-2 text-slate-500">{t.customer_city || "—"}</td>
            <td className="px-4 py-2">{t.work_type}</td>
            <td className="px-4 py-2">{t.machine_type ?? "—"}</td>
            <td className="px-4 py-2 text-slate-500">{t.skill || "—"}</td>
            <td className={`px-4 py-2 font-medium tabular-nums ${ageColor(ageDays(t))}`}>
              {ageDays(t)}d
            </td>
            <td className="px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={t.status} />
                {!t.is_assigned && t.assignment_overdue && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                    Assign overdue
                  </span>
                )}
                {t.mr_pending && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    MR Pending
                  </span>
                )}
                {t.defective_pending && (
                  <span
                    title="Work done — defective unit not yet dispatched to Blue Star"
                    className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800"
                  >
                    Defective Part
                  </span>
                )}
              </div>
            </td>
          </tr>
        ))}
        {shown.length === 0 && (
          <tr><td colSpan={isPrivileged ? 10 : 9} className="px-4 py-6 text-center text-slate-400">No tickets</td></tr>
        )}
      </Table>
      <Pagination {...pag} />
      </>
      )}

      {/* Bulk assign */}
      <Modal open={bulkAssign} title={`Assign ${selected.length} ticket(s)`} onClose={() => setBulkAssign(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Adds an <b>Assigned</b> lifecycle entry dated today to every selected ticket.
          </p>
          <Combobox
            placeholder="Search technician…"
            value={bulkLead}
            onChange={setBulkLead}
            options={team.map((m) => ({
              value: String(m.id),
              label: m.name,
              hint: m.team_type,
            }))}
          />
          <ul className="max-h-32 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            {selectedTickets.map((t) => (
              <li key={t.id} className="font-mono">{t.ticket_no} · {t.customer_name}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button onClick={doBulkAssign} disabled={working || !bulkLead}>
              {working ? "Assigning…" : "Assign"}
            </Button>
            <Button variant="ghost" onClick={() => setBulkAssign(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Bulk close — writes an end date, so the list is spelled out before confirming. */}
      <Modal open={bulkClose} title={`Close ${selected.length} ticket(s)?`} onClose={() => setBulkClose(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            This adds a <b>Closed</b> entry dated today to each ticket below. Reopen individually
            if you need to undo it.
          </p>
          <ul className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            {selectedTickets.map((t) => (
              <li key={t.id}>
                <span className="font-mono">{t.ticket_no}</span> · {t.customer_name}
                {t.status === "Closed" && (
                  <span className="ml-2 text-amber-700">already closed</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button onClick={doBulkClose} disabled={working}>
              {working ? "Closing…" : `Close ${selected.length} ticket(s)`}
            </Button>
            <Button variant="ghost" onClick={() => setBulkClose(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StatusChip({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        active
          ? "border-slate-800 bg-slate-800 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${active ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
        {count}
      </span>
    </button>
  );
}

const ATTN_TONE: Record<string, string> = {
  rose: "border-rose-300 bg-rose-50 text-rose-700",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  orange: "border-orange-300 bg-orange-50 text-orange-800",
};

function AttnChip({
  label, count, active, tone, onClick,
}: { label: string; count: number; active: boolean; tone: "rose" | "amber" | "orange"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0 && !active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        active ? ATTN_TONE[tone] : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className="rounded-full bg-black/5 px-1.5 text-[10px] tabular-nums">{count}</span>
    </button>
  );
}
