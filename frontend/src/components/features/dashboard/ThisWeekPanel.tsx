import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card, Skeleton } from "../../ui/primitives";
import { getThisWeek } from "../../../api/services";
import type { ThisWeek } from "../../../types";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

/** This week at a glance: cash position, PMS visits due, and breakdowns logged. */
export default function ThisWeekPanel() {
  const [d, setD] = useState<ThisWeek | null>(null);
  useEffect(() => { getThisWeek().then(setD).catch(() => setD(null)); }, []);

  if (!d) {
    return (
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-16 w-full" /></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <h2 className="font-semibold text-slate-700">Cash</h2>
        <div className="mt-3">
          <div className="text-sm text-slate-500">Outstanding</div>
          <Link to="/payments" className="text-2xl font-bold text-rose-600 hover:underline">
            {inr(d.cash.outstanding)}
          </Link>
        </div>
        <div className="mt-3 border-t border-slate-100 pt-2">
          <div className="text-sm text-slate-500">Collected this month</div>
          <div className="text-lg font-semibold text-emerald-600">
            {inr(d.cash.collected_this_month)}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-700">
          PMS this week <span className="text-slate-400">({d.pms_this_week.length})</span>
        </h2>
        <div className="mt-2 space-y-1 text-sm">
          {d.pms_this_week.slice(0, 5).map((v) => (
            <div key={`${v.wo_number}-${v.scheduled_on}`} className="flex items-baseline gap-2">
              <span className="flex-1 truncate text-slate-700">{v.customer ?? v.wo_number}</span>
              <span className="shrink-0 text-xs text-slate-400">{day(v.scheduled_on)}</span>
            </div>
          ))}
          {d.pms_this_week.length === 0 && (
            <p className="text-slate-400">No visits scheduled this week.</p>
          )}
          {d.pms_this_week.length > 5 && (
            <Link to="/wip?tab=Future" className="text-xs text-sky-600 hover:underline">
              +{d.pms_this_week.length - 5} more →
            </Link>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-700">
          Breakdowns this week <span className="text-slate-400">({d.breakdown_this_week.length})</span>
        </h2>
        <div className="mt-2 space-y-1 text-sm">
          {d.breakdown_this_week.slice(0, 5).map((b) => (
            <div key={b.ticket_no} className="flex items-baseline gap-2">
              <span className="flex-1 truncate text-slate-700">{b.customer ?? "—"}</span>
              <span className="shrink-0 text-xs text-slate-400">{b.status}</span>
            </div>
          ))}
          {d.breakdown_this_week.length === 0 && (
            <p className="text-slate-400">No breakdowns logged this week.</p>
          )}
          {d.breakdown_this_week.length > 5 && (
            <Link to="/tickets?work_type=Breakdown" className="text-xs text-sky-600 hover:underline">
              +{d.breakdown_this_week.length - 5} more →
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
