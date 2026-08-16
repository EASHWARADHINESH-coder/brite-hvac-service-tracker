import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getDashboardAlerts } from "../../../api/services";
import type { AlertCategory, AlertItem, DashboardAlerts } from "../../../types";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

type Tone = "critical" | "warning";

type CatDef = {
  key: string;
  title: string;
  tone: Tone;
  cat?: AlertCategory;
  headline: (c?: AlertCategory) => string;
  metric: (t: AlertItem) => string;
  metricLabel: string;
  middleLabel: string;
  middle: (t: AlertItem) => string;
  to: (t: AlertItem) => string;
  seeAll: string;
};

/**
 * Critical alerts band — a single row of four clickable tiles (long-pending breakdowns,
 * outstanding payments, assignment overdue, material returns to BSL). Clicking a tile
 * expands a detail panel listing that category's worst offenders. One open at a time.
 */
export default function CriticalAlerts() {
  const [d, setD] = useState<DashboardAlerts | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { getDashboardAlerts().then(setD).catch(() => setD(null)); }, []);
  if (!d || d.scope !== "org") return null;

  const defs: CatDef[] = [
    {
      key: "long_pending",
      title: "Long-pending breakdowns",
      tone: "critical",
      cat: d.long_pending_breakdowns,
      headline: (c) => `Open ≥ ${c?.threshold_days ?? 7} days`,
      metric: (t) => `${t.age_days}d`,
      metricLabel: "Age",
      middleLabel: "Customer",
      middle: (t) => t.customer_name ?? "—",
      to: (t) => `/tickets/${t.id}`,
      seeAll: "/tickets?work_type=Breakdown&status=Open",
    },
    {
      key: "outstanding",
      title: "Outstanding payments",
      tone: "critical",
      cat: d.outstanding_payments,
      headline: (c) => (c ? `${inr(c.total ?? 0)} outstanding` : ""),
      metric: (t) => inr(t.balance ?? 0),
      metricLabel: "Balance",
      middleLabel: "Customer",
      middle: (t) => t.customer_name ?? "—",
      to: (t) => `/tickets/${t.id}`,
      seeAll: "/payments",
    },
    {
      key: "overdue",
      title: "Assignment overdue",
      tone: "warning",
      cat: d.assignment_overdue,
      headline: () => "Past the 72h SLA",
      metric: (t) => `${t.days_overdue}d over`,
      metricLabel: "Overdue",
      middleLabel: "Customer",
      middle: (t) => t.customer_name ?? "—",
      to: (t) => `/tickets/${t.id}`,
      seeAll: "/tickets?status=Open",
    },
    {
      key: "returns",
      title: "Defective stock at office",
      tone: "warning",
      cat: d.material_returns,
      headline: () => "Ready to send to BSL",
      metric: (t) => `${t.days_waiting}d`,
      metricLabel: "Waiting",
      middleLabel: "Material",
      middle: (t) => (t.material_name ? `${t.material_name}${t.qty ? ` ×${t.qty}` : ""}` : "—"),
      to: (t) => `/tickets/${t.id}`,
      seeAll: "/materials?tab=Claims",
    },
  ];

  const totalCritical = defs.reduce((s, def) => s + (def.cat?.count ?? 0), 0);
  const active = defs.find((def) => def.key === open);

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Needs attention
        </h2>
        {totalCritical === 0 ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            All clear
          </span>
        ) : (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
            {totalCritical} item{totalCritical > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Single line: four compact tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {defs.map((def) => {
          const count = def.cat?.count ?? 0;
          const clear = count === 0;
          const isOpen = open === def.key;
          const canOpen = count > 0;

          const base = clear
            ? "border-l-emerald-400 bg-emerald-50/40"
            : def.tone === "critical"
              ? "border-l-rose-500 bg-rose-50/50"
              : "border-l-amber-500 bg-amber-50/50";
          const num = clear ? "text-emerald-600" : def.tone === "critical" ? "text-rose-600" : "text-amber-600";
          const ring = isOpen ? "ring-2 ring-slate-400" : "hover:shadow-md";

          return (
            <button
              key={def.key}
              type="button"
              onClick={() => canOpen && setOpen(isOpen ? null : def.key)}
              aria-expanded={isOpen}
              className={`rounded-lg border border-slate-200 border-l-4 p-3 text-left transition ${base} ${
                canOpen ? `cursor-pointer ${ring}` : "cursor-default"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">{def.title}</span>
                <span className={`text-2xl font-bold tabular-nums ${num}`}>{count}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  {clear ? "All clear ✓" : def.headline(def.cat)}
                </span>
                {canOpen && (
                  <span className="text-[11px] font-medium text-slate-400">
                    {isOpen ? "Hide ▲" : "Details ▼"}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Expanded detail for the selected tile */}
      {active && active.cat && active.cat.count > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              {active.title} <span className="text-slate-400">({active.cat.count})</span>
            </span>
            <Link to={active.seeAll} className="text-xs font-medium text-sky-600 hover:underline">
              See all →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-1.5 font-medium">Ticket No.</th>
                  <th className="px-3 py-1.5 font-medium">{active.middleLabel}</th>
                  {active.metricLabel && (
                    <th className="px-3 py-1.5 text-right font-medium">{active.metricLabel}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {active.cat.items.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-1.5">
                      <Link to={active.to(t)} className="font-mono text-sky-600 hover:underline">
                        {t.ticket_no}
                      </Link>
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-1.5 text-slate-600" title={active.middle(t)}>
                      {active.middle(t)}
                    </td>
                    {active.metricLabel && (
                      <td className="px-3 py-1.5 text-right font-medium text-slate-700">
                        {active.metric(t)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {active.cat.count > active.cat.items.length && (
            <Link to={active.seeAll} className="mt-2 inline-block text-xs font-medium text-sky-600 hover:underline">
              +{active.cat.count - active.cat.items.length} more →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
