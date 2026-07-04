import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import StatusBadge from "../components/ui/StatusBadge";
import { Button, PageHeader, Select, Input, Table } from "../components/ui/primitives";
import { exportTickets, listCustomers, listTickets } from "../api/services";
import { WORK_TYPES } from "../types";
import type { Customer, Ticket, TicketStatus, WorkType } from "../types";

const STATUSES: TicketStatus[] = ["Open", "In Progress", "Closed", "Reopened"];

export default function Tickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [status, setStatus] = useState<string>("");
  const [workType, setWorkType] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [q, setQ] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => { listCustomers().then(setCustomers); }, []);

  useEffect(() => {
    listTickets({
      status: (status || undefined) as TicketStatus | undefined,
      work_type: (workType || undefined) as WorkType | undefined,
      customer_id: customerId ? Number(customerId) : undefined,
      q: q || undefined,
    }).then(setTickets);
  }, [status, workType, customerId, q]);

  // Date range filters the displayed rows client-side (complaint date).
  const shown = tickets.filter((t) => {
    if (start && t.complaint_date < start) return false;
    if (end && t.complaint_date > end) return false;
    return true;
  });

  const doExport = async () => {
    setExporting(true);
    try {
      await exportTickets({ start, end, status, work_type: workType });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Tickets"
        action={
          <Button variant="ghost" onClick={doExport} disabled={exporting}>
            {exporting ? "Exporting…" : "⬇ Export to Excel"}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Input placeholder="Search ticket no…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select value={workType} onChange={(e) => setWorkType(e.target.value)}>
          <option value="">All work types</option>
          {WORK_TYPES.map((w) => <option key={w}>{w}</option>)}
        </Select>
        <Input type="date" value={start} title="Complaint date from"
          onChange={(e) => setStart(e.target.value)} />
        <Input type="date" value={end} title="Complaint date to"
          onChange={(e) => setEnd(e.target.value)} />
      </div>

      <Table head={["Ticket No.", "Customer", "Work Type", "Machine", "Skill", "Status"]}>
        {shown.map((t) => (
          <tr key={t.id}>
            <td className="px-4 py-2 font-mono font-medium">
              <Link to={`/tickets/${t.id}`} className="text-sky-600 hover:underline">
                {t.ticket_no}
              </Link>
            </td>
            <td className="px-4 py-2">{t.customer_name ?? "—"}</td>
            <td className="px-4 py-2">{t.work_type}</td>
            <td className="px-4 py-2">{t.machine_type ?? "—"}</td>
            <td className="px-4 py-2 text-slate-500">{t.skill || "—"}</td>
            <td className="px-4 py-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={t.status} />
                {!t.is_assigned && t.assignment_overdue && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                    Assign overdue
                  </span>
                )}
              </div>
            </td>
          </tr>
        ))}
        {shown.length === 0 && (
          <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No tickets</td></tr>
        )}
      </Table>
    </div>
  );
}
