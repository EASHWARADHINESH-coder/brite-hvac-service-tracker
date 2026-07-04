import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Card, PageHeader, Table } from "../components/ui/primitives";
import StatusBadge from "../components/ui/StatusBadge";
import { getCustomer, listPMS, listTickets } from "../api/services";
import type { Customer, PMS, Ticket } from "../types";

const SCHEDULE_KEYS: (keyof PMS)[] = [
  "schedule_1", "schedule_2", "schedule_3",
  "schedule_4", "schedule_5", "schedule_6",
];

export default function CustomerDetail() {
  const { id } = useParams();
  const customerId = Number(id);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [pms, setPms] = useState<PMS[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPms, setOpenPms] = useState<number | null>(null);

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    Promise.all([
      getCustomer(customerId),
      listTickets({ customer_id: customerId }),
      listPMS(customerId),
    ])
      .then(([c, t, p]) => { setCustomer(c); setTickets(t); setPms(p); })
      .catch((e) => setError(e?.response?.data?.detail ?? "Could not load customer."))
      .finally(() => setLoading(false));
  }, [customerId]);

  if (loading) return <p className="text-slate-400">Loading…</p>;
  if (error || !customer)
    return (
      <div>
        <Link to="/customers" className="text-sm text-slate-500 hover:underline">← Back to customers</Link>
        <p className="mt-4 text-rose-600">{error ?? "Customer not found."}</p>
      </div>
    );

  const openCount = tickets.filter((t) => t.status !== "Closed").length;

  return (
    <div>
      <Link to="/customers" className="text-sm text-slate-500 hover:underline">← Back to customers</Link>
      <PageHeader title={customer.name} />

      {/* Customer info */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Contact person" value={customer.contact_person} />
          <Info label="Primary mobile" value={customer.contact_number} />
          <Info label="Secondary mobile" value={customer.secondary_mobile} />
          <Info label="Email" value={customer.mail_id} />
          <Info label="City" value={customer.city} />
          <Info label="Pincode" value={customer.pincode} />
          <div className="sm:col-span-2 lg:col-span-3">
            <Info label="Address" value={customer.address} />
          </div>
        </div>
      </Card>

      {/* Tickets */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-800">Tickets</h2>
        <Badge>{tickets.length}</Badge>
        {openCount > 0 && <span className="text-xs text-amber-700">Open: {openCount}</span>}
      </div>
      <div className="mb-8">
        <Table head={["Ticket No", "Work type", "Machine", "Complaint date", "Status"]}>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-2 font-mono font-medium">
                <Link to={`/tickets/${t.id}`} className="text-slate-800 hover:underline">
                  {t.ticket_no}
                </Link>
              </td>
              <td className="px-4 py-2">{t.work_type}</td>
              <td className="px-4 py-2">{t.machine_type}</td>
              <td className="px-4 py-2">{t.complaint_date}</td>
              <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
            </tr>
          ))}
          {tickets.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No tickets for this customer</td></tr>
          )}
        </Table>
      </div>

      {/* PMS */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-800">PMS work orders</h2>
        <Badge>{pms.length}</Badge>
      </div>
      <Table head={["WO Number", "Schedule", "WO start", "WO end", ""]}>
        {pms.map((p) => {
          const expanded = openPms === p.id;
          const visits = SCHEDULE_KEYS.map((k) => p[k]).filter(Boolean) as string[];
          return (
            <Fragment key={p.id}>
              <tr>
                <td className="px-4 py-2 font-mono font-medium">
                  <button
                    onClick={() => setOpenPms(expanded ? null : p.id)}
                    className="text-slate-800 hover:underline"
                  >
                    {p.wo_number}
                  </button>
                </td>
                <td className="px-4 py-2">{p.schedule || "—"}</td>
                <td className="px-4 py-2">{p.wo_start_date || "—"}</td>
                <td className="px-4 py-2">{p.wo_end_date || "—"}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => setOpenPms(expanded ? null : p.id)}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    {expanded ? "Hide visits" : "Show visits"}
                  </button>
                </td>
              </tr>
              {expanded && (
                <tr className="bg-slate-50">
                  <td colSpan={5} className="px-4 py-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Scheduled visits
                    </p>
                    {visits.length ? (
                      <div className="flex flex-wrap gap-2">
                        {visits.map((d, i) => (
                          <span
                            key={i}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                          >
                            <span className="text-slate-400">#{i + 1}</span> {d}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">No visit dates scheduled</p>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {pms.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No PMS work orders for this customer</td></tr>
        )}
      </Table>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm text-slate-800">{value || "—"}</p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}
