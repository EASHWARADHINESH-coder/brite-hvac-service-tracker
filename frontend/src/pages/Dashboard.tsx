import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card, PageHeader } from "../components/ui/primitives";
import { getBriefing, getDashboardOverview } from "../api/services";
import type { Briefing, DashboardOverview } from "../types";

const STATUS_COLOR: Record<string, string> = {
  Open: "bg-amber-400",
  "In Progress": "bg-blue-500",
  Closed: "bg-emerald-500",
  Reopened: "bg-rose-500",
};
const WORKTYPE_COLOR = "bg-slate-500";
const CONTRACT_COLOR: Record<string, string> = {
  AMC: "bg-indigo-500",
  WTY: "bg-blue-500",
  NIC: "bg-slate-400",
};
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function Bars({ data, colors }: { data: Record<string, number>; colors: Record<string, string> | string }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div className="space-y-2">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 text-sm">
          <div className="w-32 shrink-0 text-slate-500">{k}</div>
          <div className="flex-1 rounded bg-slate-100">
            <div
              className={`h-5 rounded ${typeof colors === "string" ? colors : colors[k] ?? "bg-slate-400"}`}
              style={{ width: `${(v / max) * 100}%`, minWidth: v > 0 ? "1.5rem" : "0" }}
            />
          </div>
          <div className="w-8 text-right font-semibold">{v}</div>
        </div>
      ))}
    </div>
  );
}

function DailyBriefing() {
  const [b, setB] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getBriefing().then(setB).catch(() => setB(null)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const counts = b && [
    { label: "Overdue assign", n: b.overdue_assignments.length, tone: "text-rose-600" },
    { label: "Closed · MR pending", n: b.mr_pending_closed.length, tone: "text-amber-700" },
    { label: "PMS due", n: b.pms_due.length, tone: "text-blue-600" },
    { label: "Payments pending", n: b.payments_pending.length, tone: "text-rose-600" },
  ];

  return (
    <Card className="mb-6 border-l-4 border-l-slate-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">Daily briefing</span>
          {b && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              b.used_llm ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}>
              {b.used_llm ? "AI" : "rule-based"}
            </span>
          )}
          {b && <span className="text-xs text-slate-400">{b.date}</span>}
        </div>
        <button onClick={load} disabled={loading}
          className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50">
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {loading && !b && <p className="text-sm text-slate-400">Preparing today's briefing…</p>}
      {b && (
        <>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{b.summary}</p>
          {counts && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {counts.map((c) => (
                <div key={c.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className={`text-lg font-semibold ${c.tone}`}>{c.n}</div>
                  <div className="text-[11px] text-slate-500">{c.label}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <Card>
      <div className={`text-3xl font-bold ${accent ?? "text-slate-800"}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </Card>
  );
}

function Attention({ label, value, to, accent }: {
  label: string; value: string | number; to: string; accent: string;
}) {
  return (
    <Link to={to}>
      <Card className="transition hover:shadow-md">
        <div className={`text-2xl font-bold ${accent}`}>{value}</div>
        <div className="mt-1 text-sm text-slate-500">{label} →</div>
      </Card>
    </Link>
  );
}

export default function Dashboard() {
  const [d, setD] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardOverview().then(setD).catch(() => setError("Backend unreachable"));
  }, []);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!d) return <p className="text-slate-400">Loading…</p>;

  // ---- Personal (Technician / Helper) ----
  if (d.scope === "personal") {
    const my = d.my_tickets ?? {};
    return (
      <div>
        <PageHeader title="My Dashboard" />
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Kpi label="My tickets" value={d.my_tickets_total ?? 0} />
          <Attention label="My open tasks" value={d.my_open_tasks ?? 0} to="/tasks" accent="text-blue-600" />
          <Attention label="My open queries" value={d.my_open_queries ?? 0} to="/queries" accent="text-amber-600" />
        </div>
        <Card>
          <h2 className="mb-3 font-semibold text-slate-700">My tickets by status</h2>
          <Bars data={my} colors={STATUS_COLOR} />
        </Card>
      </div>
    );
  }

  // ---- Org (Admin / Engineer) ----
  const t = d.tickets ?? {};
  const total = Object.values(t).reduce((s, v) => s + v, 0);
  const a = d.attention;

  return (
    <div>
      <PageHeader title="Dashboard" />

      {/* Proactive daily briefing agent */}
      <DailyBriefing />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Kpi label="Total Tickets" value={total} />
        <Kpi label="Open" value={t["Open"] ?? 0} accent="text-amber-600" />
        <Kpi label="In Progress" value={t["In Progress"] ?? 0} accent="text-blue-600" />
        <Kpi label="Closed" value={t["Closed"] ?? 0} accent="text-emerald-600" />
        <Kpi label="Reopened" value={t["Reopened"] ?? 0} accent="text-rose-600" />
      </div>

      {/* Attention items */}
      {a && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-700">Needs attention</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Attention label="Assign overdue (72h)" value={a.assignment_overdue} to="/tickets" accent="text-rose-600" />
            <Attention label={`Payment pending`} value={a.payment_pending_count} to="/payments" accent="text-rose-600" />
            <Attention label="Open queries" value={a.open_queries} to="/queries" accent="text-amber-600" />
            <Attention label="PMS visits due" value={a.pms_due} to="/pms" accent="text-blue-600" />
            <Attention label="Open BSL claims" value={a.open_claims} to="/materials?tab=Claims" accent="text-orange-600" />
          </div>
          {a.payment_pending_total > 0 && (
            <p className="mt-2 text-sm text-slate-500">
              Outstanding payments total: <span className="font-semibold text-rose-600">{inr(a.payment_pending_total)}</span>
            </p>
          )}
        </>
      )}

      {/* Breakdown status + Contracts */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-slate-700">Breakdown tickets by status</h2>
          <Bars data={d.breakdown_by_status ?? {}} colors={STATUS_COLOR} />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-slate-700">Customers by contract</h2>
          <Bars data={d.contracts ?? {}} colors={CONTRACT_COLOR} />
        </Card>
      </div>

      {/* Tickets by work type */}
      <Card className="mt-6">
        <h2 className="mb-3 font-semibold text-slate-700">Tickets by work type</h2>
        <Bars data={d.by_work_type ?? {}} colors={WORKTYPE_COLOR} />
      </Card>
    </div>
  );
}
