import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card, Input, Skeleton } from "../../ui/primitives";
import { getTodayWip } from "../../../api/services";
import type { TodayWip, WipPerson, WipTicketBrief } from "../../../types";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// The lifecycle in flow order, so the stage summary reads as a process left-to-right.
const STAGE_ORDER = [
  "Logged",
  "Assigned",
  "Work Started",
  "Material Pending",
  "Testing & Commissioning",
  "Reopened",
];

// How many technicians to show inline before the "+N more" link (keeps the dashboard short).
const SHOWN_PEOPLE = 6;

const stuckCount = (p: WipPerson) => p.today.filter((t) => t.ongoing).length;

/**
 * Today's WIP — grouped by technician (Discussion 8, Option A).
 *
 * Each in-progress person is a collapsible row: name → today's job count → a "stuck" flag when
 * any of their jobs carried over with no update today. Expanding lists their jobs with stage and
 * idle days. Busiest first; a compact top-N with a link to the full WIP report.
 */
export default function TodayWipPanel() {
  const [day, setDay] = useState(iso(new Date()));
  const [d, setD] = useState<TodayWip | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setOpen(new Set());
    getTodayWip(day).then(setD).catch(() => setD(null)).finally(() => setLoading(false));
  }, [day]);

  const isToday = day === iso(new Date());
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // Only people who actually have work in progress on the chosen day, busiest first
  // (the backend already sorts people by today_count desc).
  const active = (d?.people ?? []).filter((p) => p.today_count > 0);
  const shown = active.slice(0, SHOWN_PEOPLE);
  const morepeople = active.length - shown.length;

  // Total stuck = unique in-progress tickets carried over with no update today.
  const stuckTotal = (d?.tickets ?? []).filter((t) => t.ongoing).length;

  const stageSummary = STAGE_ORDER
    .map((label) => ({ label, value: d?.by_stage[label] ?? 0 }))
    .filter((s) => s.value > 0);

  return (
    <Card className="mb-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-lg font-semibold text-slate-800">
          {isToday ? "Today's WIP" : "Work in progress"}
        </span>
        <Input
          type="date"
          value={day}
          max={iso(new Date())}
          onChange={(e) => setDay(e.target.value || iso(new Date()))}
          className="!w-auto"
        />
        <Link to="/wip" className="ml-auto text-xs font-medium text-sky-600 hover:underline">
          Full WIP report →
        </Link>
      </div>

      {loading && !d && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {d && (
        <>
          {/* Headline counts, with stuck jobs flagged loudly. */}
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-2xl font-bold text-blue-600">{d.total_touched}</span>
              <span className="ml-1 text-slate-500">
                job{d.total_touched === 1 ? "" : "s"} in progress
              </span>
            </div>
            <div>
              <span className="text-2xl font-bold text-slate-800">{d.active_people}</span>
              <span className="ml-1 text-slate-500">
                {d.active_people === 1 ? "person" : "people"} on site
              </span>
            </div>
            {stuckTotal > 0 && (
              <div>
                <span className="text-2xl font-bold text-rose-600">{stuckTotal}</span>
                <span className="ml-1 text-slate-500">stuck / no update today</span>
              </div>
            )}
          </div>

          {/* Compact one-line stage summary. */}
          {stageSummary.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              {stageSummary.map((s) => (
                <span key={s.label}>
                  {s.label} <span className="font-semibold text-slate-700">{s.value}</span>
                </span>
              ))}
            </div>
          )}

          {active.length === 0 ? (
            <p className="text-sm text-slate-400">
              No work in progress on {isToday ? "today's date" : day}.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {shown.map((p) => {
                const isOpen = open.has(p.name);
                const stuck = stuckCount(p);
                return (
                  <div key={p.name}>
                    <button
                      type="button"
                      onClick={() => toggle(p.name)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-2 py-2.5 text-left hover:bg-slate-50"
                    >
                      <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <span className="text-xs text-slate-400">{p.team_type}</span>
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                        {p.today_count}
                      </span>
                      {stuck > 0 && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                          {stuck} stuck
                        </span>
                      )}
                      <span className="ml-auto text-xs text-slate-400">
                        {p.open_count} open
                      </span>
                    </button>

                    {isOpen && (
                      <ul className="space-y-1 pb-3 pl-6">
                        {p.today.map((t) => (
                          <JobRow key={t.ticket_no} t={t} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {morepeople > 0 && (
            <div className="mt-3 text-xs text-slate-500">
              +{morepeople} more {morepeople === 1 ? "person" : "people"} ·{" "}
              <Link to="/wip" className="font-medium text-sky-600 hover:underline">
                Full WIP report →
              </Link>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** One job under a technician: ticket + customer + stage, with an idle / stuck badge. */
function JobRow({ t }: { t: WipTicketBrief }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <Link
        to={`/tickets/${t.id}`}
        className="w-28 shrink-0 truncate font-mono text-sky-600 hover:underline"
      >
        {t.ticket_no}
      </Link>
      <span className="min-w-0 flex-1 truncate text-slate-600">{t.customer_name ?? "—"}</span>
      {t.stage && <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{t.stage}</span>}
      {t.ongoing ? (
        <span
          title={`Carried over — in progress since ${t.started_on}, no update today`}
          className="shrink-0 whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700"
        >
          idle {t.idle_days}d
        </span>
      ) : (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          today
        </span>
      )}
    </li>
  );
}
