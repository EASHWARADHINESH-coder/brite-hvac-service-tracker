import { useEffect, useState } from "react";

import { Card, Skeleton } from "../../ui/primitives";
import { getBacklogTrend } from "../../../api/services";
import type { BacklogTrend as Trend } from "../../../types";

/**
 * Backlog trend — opened vs closed per week (is the backlog growing?), plus a team
 * attendance grid: who was present (logged work) or absent each week.
 */
export default function BacklogTrend() {
  const [d, setD] = useState<Trend | null>(null);
  useEffect(() => { getBacklogTrend(8).then(setD).catch(() => setD(null)); }, []);

  if (!d) {
    return (
      <Card className="mb-6">
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="h-28 w-full" />
      </Card>
    );
  }

  const max = Math.max(1, ...d.weeks.flatMap((w) => [w.opened, w.closed]));

  return (
    <Card className="mb-6">
      <h2 className="font-semibold text-slate-700">Backlog trend</h2>
      <p className="mb-3 text-xs text-slate-400">
        Opened vs closed per week — are we keeping up? · presence = logged work that week
      </p>

      {/* Column chart: paired opened/closed bars per week */}
      <div className="flex items-end gap-2" style={{ height: 110 }}>
        {d.weeks.map((w) => (
          <div key={w.week_start} className="flex flex-1 flex-col items-center">
            <div className="flex h-full w-full items-end justify-center gap-1">
              <div
                title={`${w.opened} opened`}
                className="w-3 rounded-t bg-sky-600"
                style={{ height: `${(w.opened / max) * 100}%`, minHeight: w.opened ? 3 : 0 }}
              />
              <div
                title={`${w.closed} closed`}
                className="w-3 rounded-t bg-emerald-600"
                style={{ height: `${(w.closed / max) * 100}%`, minHeight: w.closed ? 3 : 0 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {d.weeks.map((w) => (
          <div key={w.week_start} className="flex-1 text-center text-[10px] text-slate-400">
            {w.label.split(" ")[0]}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-600" /> opened
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" /> closed
        </span>
      </div>

      {/* Attendance grid: team member × week, present/absent */}
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Team presence
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium text-slate-500">Member</th>
                {d.weeks.map((w) => (
                  <th key={w.week_start} className="px-1.5 py-1 text-center text-[10px] font-medium text-slate-400">
                    {w.label.split(" ")[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.team.map((m) => (
                <tr key={m.name} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">
                    {m.name}
                    <span className="ml-1 text-[10px] text-slate-400">{m.team_type}</span>
                  </td>
                  {m.present.map((p, i) => (
                    <td key={i} className="px-1.5 py-1.5 text-center">
                      {p ? (
                        <span
                          title="Present"
                          className="inline-block h-3 w-3 rounded-full bg-emerald-500 align-middle"
                        />
                      ) : (
                        <span
                          title="Absent"
                          className="inline-block h-3 w-3 rounded-full border border-slate-300 align-middle"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" /> present
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full border border-slate-300" /> absent
          </span>
        </div>
      </div>
    </Card>
  );
}
