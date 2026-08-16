import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
} from "../components/ui/primitives";
import {
  autoGeneratePMS,
  createPMS,
  exportPMS,
  getPMSSchedule,
  listCustomers,
  listPMS,
  removeGeneratedPMS,
} from "../api/services";
import type { Customer, PMS, PMSVisitRow } from "../types";

// PMS per year -> interval is 12 / count (4/yr = every 3 months, 6/yr = every 2 months).
const SCHEDULES = ["2 PMS/Year", "3 PMS/Year", "4 PMS/Year", "6 PMS/Year", "12 PMS/Year"];

const VISIT_STATUS_STYLE: Record<PMSVisitRow["status"], string> = {
  Generated: "bg-emerald-100 text-emerald-700",
  Due: "bg-amber-100 text-amber-800",
  Upcoming: "bg-slate-100 text-slate-600",
};

export default function PMSPage({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<PMS[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [schedule, setSchedule] = useState<PMSVisitRow[]>([]);
  const [form, setForm] = useState({
    customer_id: "",
    wo_number: "",
    wo_start_date: "",
    wo_end_date: "",
    schedule: SCHEDULES[2], // 4 PMS/Year
  });
  // Filters (WO start date range + customer).
  const [fCustomer, setFCustomer] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const load = () => {
    listPMS().then(setRows);
    getPMSSchedule().then(setSchedule);
  };
  const [searchParams] = useSearchParams();
  // When arriving from Customers (AMC → PMS), pre-select the customer in the new WO form.
  useEffect(() => {
    const cid = searchParams.get("customer");
    if (cid) setForm((f) => ({ ...f, customer_id: cid }));
  }, [searchParams]);

  // Tickets are NOT generated automatically — use the "Generate due tickets" button.
  useEffect(() => {
    load();
    listCustomers().then(setCustomers);
  }, []);

  const doGenerate = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const res = await autoGeneratePMS();
      setBanner(
        res.created > 0
          ? `Created ${res.created} PMS ticket(s): ${res.tickets.join(", ")}`
          : "No due visits to generate.",
      );
      load();
    } finally {
      setBusy(false);
    }
  };

  const doRemoveGenerated = async () => {
    if (!window.confirm(
      "Remove generated PMS tickets that have no work done?\n\n" +
      "Tickets with progress are kept. Their visits go back to \"Due\" so you can generate them manually later.",
    )) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await removeGeneratedPMS();
      setBanner(
        `Removed ${res.removed} untouched PMS ticket(s)` +
        (res.kept > 0 ? ` · kept ${res.kept} with work done` : "") +
        (res.tickets.length ? `: ${res.tickets.join(", ")}` : "."),
      );
      load();
    } finally {
      setBusy(false);
    }
  };

  const customerName = (id: number) => customers.find((c) => c.id === id)?.name ?? id;

  const shown = rows.filter((p) => {
    if (fCustomer && String(p.customer_id) !== fCustomer) return false;
    if (start && (!p.wo_start_date || p.wo_start_date < start)) return false;
    if (end && (!p.wo_start_date || p.wo_start_date > end)) return false;
    return true;
  });

  const doExport = async () => {
    setExporting(true);
    try {
      await exportPMS({ start, end, customer_id: fCustomer ? Number(fCustomer) : undefined });
    } finally {
      setExporting(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.customer_id || !form.wo_number) return;
    await createPMS({
      customer_id: Number(form.customer_id),
      wo_number: form.wo_number,
      wo_start_date: form.wo_start_date || undefined,
      wo_end_date: form.wo_end_date || undefined,
      schedule: form.schedule,
      auto_generate: true,
    });
    setForm({
      customer_id: "", wo_number: "", wo_start_date: "", wo_end_date: "",
      schedule: SCHEDULES[2],
    });
    load();
  };

  return (
    <div>
      <PageHeader
        title={embedded ? undefined : "PMS — Preventive Maintenance"}
        action={
          <div className="flex items-center gap-2">
            <Button onClick={doGenerate} disabled={busy}>
              {busy ? "Working…" : "Generate due tickets"}
            </Button>
            <Button variant="ghost" onClick={doRemoveGenerated} disabled={busy}>
              Remove generated
            </Button>
            <Button variant="ghost" onClick={doExport} disabled={exporting}>
              {exporting ? "Exporting…" : "⬇ Export to Excel"}
            </Button>
          </div>
        }
      />

      {banner && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          {banner}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input type="date" value={start} title="WO start from"
          onChange={(e) => setStart(e.target.value)} />
        <Input type="date" value={end} title="WO start to"
          onChange={(e) => setEnd(e.target.value)} />
      </div>

      <Card className="mb-6 max-w-3xl">
        <h2 className="mb-3 font-semibold text-slate-700">New work order (visit dates auto-generated)</h2>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Customer (site) *">
            <Select value={form.customer_id}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">Select…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="WO number *">
            <Input value={form.wo_number}
              onChange={(e) => setForm({ ...form, wo_number: e.target.value })} />
          </Field>
          <Field label="Schedule">
            <Select value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}>
              {SCHEDULES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="WO start">
            <Input type="date" value={form.wo_start_date}
              onChange={(e) => setForm({ ...form, wo_start_date: e.target.value })} />
          </Field>
          <Field label="WO end">
            <Input type="date" value={form.wo_end_date}
              onChange={(e) => setForm({ ...form, wo_end_date: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Card>

      <Table head={["Customer (site)", "WO No.", "Schedule", "S1", "S2", "S3", "S4", "S5", "S6"]}>
        {shown.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-2 font-medium">{customerName(p.customer_id)}</td>
            <td className="px-4 py-2 font-mono">{p.wo_number}</td>
            <td className="px-4 py-2 text-slate-500">{p.schedule}</td>
            {[p.schedule_1, p.schedule_2, p.schedule_3, p.schedule_4, p.schedule_5, p.schedule_6].map(
              (d, i) => <td key={i} className="px-4 py-2 text-xs">{d ?? "—"}</td>,
            )}
          </tr>
        ))}
        {shown.length === 0 && (
          <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-400">No work orders</td></tr>
        )}
      </Table>

      {/* Scheduled visit timeline */}
      <div className="mb-3 mt-8 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-800">Scheduled visits</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          {schedule.length}
        </span>
      </div>
      <Table head={["Scheduled date", "Site name", "WO No.", "Visit #", "Status", "Ticket"]}>
        {schedule.map((v) => (
          <tr key={`${v.pms_id}-${v.visit_no}`}>
            <td className="px-4 py-2 font-medium">{v.visit_date}</td>
            <td className="px-4 py-2">{v.customer_name ?? "—"}</td>
            <td className="px-4 py-2 font-mono text-xs">{v.wo_number}</td>
            <td className="px-4 py-2 text-xs">{v.visit_no}</td>
            <td className="px-4 py-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${VISIT_STATUS_STYLE[v.status]}`}>
                {v.status}
              </span>
            </td>
            <td className="px-4 py-2 text-xs">
              {v.ticket_id ? (
                <Link to={`/tickets/${v.ticket_id}`} className="font-mono text-sky-600 hover:underline">
                  {v.ticket_no}
                </Link>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </td>
          </tr>
        ))}
        {schedule.length === 0 && (
          <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No scheduled visits yet</td></tr>
        )}
      </Table>
    </div>
  );
}
