import { Link } from "react-router-dom";

import type { DashboardOverview } from "../../../types";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * At-a-glance health strip — the one-second read at the very top of the Dashboard.
 * Five clickable tiles: Open, Needs action (assign overdue), Breakdown today,
 * Outstanding cash, MR pending.
 */
export default function HealthStrip({ d }: { d: DashboardOverview }) {
  const t = d.tickets ?? {};
  const a = d.attention;

  const tiles: { label: string; value: string | number; accent?: string; to: string; hint?: string }[] = [
    { label: "Open", value: t["Open"] ?? 0, accent: "text-amber-600", to: "/tickets?status=Open" },
    {
      label: "Needs action",
      value: a?.assignment_overdue ?? 0,
      accent: "text-rose-600",
      to: "/tickets?status=Open",
      hint: "assign overdue",
    },
    {
      label: "Breakdown today",
      value: d.breakdown_today ?? 0,
      accent: "text-blue-600",
      to: "/tickets?work_type=Breakdown",
    },
    {
      label: "Outstanding",
      value: inr(a?.payment_pending_total ?? 0),
      accent: "text-rose-600",
      to: "/payments",
    },
    {
      label: "MR pending",
      value: d.mr_pending ?? 0,
      accent: "text-orange-600",
      to: "/tickets?mr_pending=true",
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map((tile) => (
        <Link key={tile.label} to={tile.to}>
          <div className="h-full rounded-lg bg-slate-100 p-3 transition hover:bg-slate-200">
            <div className="text-sm text-slate-500">{tile.label}</div>
            <div className={`mt-0.5 text-2xl font-bold ${tile.accent ?? "text-slate-800"}`}>
              {tile.value}
            </div>
            {tile.hint && <div className="text-[11px] text-slate-400">{tile.hint}</div>}
          </div>
        </Link>
      ))}
    </div>
  );
}
