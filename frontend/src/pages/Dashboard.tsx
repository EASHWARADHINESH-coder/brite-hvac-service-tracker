import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card, CardSkeleton, PageHeader, Skeleton } from "../components/ui/primitives";
import { useToast } from "../components/ui/Toast";
import { BarList } from "../components/ui/charts";
import TodayWipPanel from "../components/features/wip/TodayWipPanel";
import CriticalAlerts from "../components/features/dashboard/CriticalAlerts";
import DailyActivity from "../components/features/dashboard/DailyActivity";
import { getDashboardOverview } from "../api/services";
import type { DashboardOverview } from "../types";

/** Record -> bar data, dropping empty categories so the chart shows only what exists. */
const toBars = (rec: Record<string, number> | undefined) =>
  Object.entries(rec ?? {}).map(([label, value]) => ({ label, value }));

function Kpi({ label, value, accent, to }: {
  label: string; value: string | number; accent?: string; to?: string;
}) {
  const card = (
    <Card className={to ? "h-full transition hover:shadow-md" : "h-full"}>
      <div className={`text-3xl font-bold ${accent ?? "text-slate-800"}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}{to && " →"}</div>
    </Card>
  );
  return to ? <Link to={to}>{card}</Link> : card;
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
  const [failed, setFailed] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getDashboardOverview()
      .then(setD)
      .catch(() => {
        setFailed(true);
        toast.error("Backend unreachable", "Couldn't load the dashboard. Is the API running?");
      });
  }, []);

  if (failed) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <Card>
          <p className="text-sm text-slate-600">
            Couldn't reach the backend. Start it and reload this page.
          </p>
        </Card>
      </div>
    );
  }
  if (!d) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <Skeleton className="mb-6 h-24 w-full" />
        <Skeleton className="mb-3 h-5 w-32" />
        <CardSkeleton count={5} />
      </div>
    );
  }

  // ---- Personal (Technician / Helper) ----
  if (d.scope === "personal") {
    const my = d.my_tickets ?? {};
    return (
      <div>
        <PageHeader title="My Dashboard" />
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Kpi label="My tickets" value={d.my_tickets_total ?? 0} />
          <Attention label="My open tasks" value={d.my_open_tasks ?? 0} to="/tasks" accent="text-blue-600" />
        </div>
        <Card>
          <h2 className="mb-3 font-semibold text-slate-700">My tickets by status</h2>
          <BarList data={toBars(my)} useStatusColor />
        </Card>
      </div>
    );
  }

  // ---- Org (Admin / Engineer) — compact: alerts + a tight KPI pulse + today's WIP ----
  const t = d.tickets ?? {};
  const total = Object.values(t).reduce((s, v) => s + v, 0);

  const kpis = [
    { label: "Total tickets", value: total, to: "/tickets", accent: "text-slate-800" },
    { label: "Open", value: t["Open"] ?? 0, to: "/tickets?status=Open", accent: "text-amber-600" },
    { label: "In progress", value: t["In Progress"] ?? 0, to: "/tickets?status=In+Progress", accent: "text-blue-600" },
    { label: "Closed", value: t["Closed"] ?? 0, to: "/tickets?status=Closed", accent: "text-emerald-600" },
    { label: "Reopened", value: t["Reopened"] ?? 0, to: "/tickets?status=Reopened", accent: "text-rose-600" },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" />

      {/* The loud, prioritised top: what needs chasing right now */}
      <CriticalAlerts />

      {/* Tight KPI pulse — the neutral one-line read */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <Kpi key={k.label} label={k.label} value={k.value} to={k.to} accent={k.accent} />
        ))}
      </div>

      {/* Daily activity — manpower vs load mini-charts */}
      <DailyActivity />

      {/* Today's WIP — the one detail view kept inline */}
      <TodayWipPanel />
    </div>
  );
}
