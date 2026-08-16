import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button, Card, Input, PageHeader, Table, TableSkeleton } from "../components/ui/primitives";
import { useToast } from "../components/ui/Toast";
import { downloadWipReport, getWipReport } from "../api/services";
import type { WipReport } from "../types";

const PERIODS = ["daily", "weekly", "monthly"] as const;
type Period = (typeof PERIODS)[number];
const iso = (d: Date) => d.toISOString().slice(0, 10);

const STATUS_COLOR: Record<string, string> = {
  Open: "rgb(var(--amber-600))",
  "In Progress": "rgb(var(--blue-600))",
  Closed: "rgb(var(--emerald-600))",
  Reopened: "rgb(var(--rose-600))",
  Cancelled: "rgb(var(--slate-400))",
};

function Tile({ value, label, accent = "text-slate-800" }: { value: number | string; label: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-slate-100 p-3">
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

/** Horizontal bar row for the by-status distribution and the team leaderboard. */
function Bar({ label, value, max, color, sub }: { label: string; value: number; max: number; color: string; sub?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-32 shrink-0 truncate text-sm text-slate-600" title={label}>{label}</div>
      <div className="relative h-4 flex-1 rounded bg-slate-100">
        <div className="h-4 rounded" style={{ width: `${pct}%`, background: color, minWidth: value > 0 ? 4 : 0 }} />
      </div>
      <div className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-700">
        <span className="font-semibold">{value}</span>
        {sub && <span className="ml-1 text-xs text-slate-400">{sub}</span>}
      </div>
    </div>
  );
}

/**
 * WIP Report — one overview page (Discussion 9 #5): breakdown-call status on top, team
 * performance (calls closed + active days leaderboard) below, then the ticket list. Period is
 * Daily / Weekly / Monthly with an Excel export.
 */
export default function Wip() {
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("monthly");
  const [anchor, setAnchor] = useState(iso(new Date()));
  const [d, setD] = useState<WipReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getWipReport(period, anchor).then(setD).catch(() => setD(null)).finally(() => setLoading(false));
  }, [period, anchor]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadWipReport(period, anchor);
    } catch {
      toast.error("Couldn't generate the Excel file");
    } finally {
      setDownloading(false);
    }
  };

  const bd = d?.summary.breakdown;
  const statusEntries = Object.entries(d?.summary.by_status ?? {});
  const statusMax = Math.max(1, ...statusEntries.map(([, v]) => v));
  // Leaderboard: people who actually did something in the period, best closers first.
  const leaders = (d?.per_technician ?? []).filter((p) => p.closed_count > 0 || p.active_days > 0);
  const closedMax = Math.max(1, ...leaders.map((p) => p.closed_count));

  return (
    <div>
      <PageHeader
        title="WIP Report"
        action={
          <Button onClick={download} disabled={downloading || !d}>
            {downloading ? "Preparing…" : "⬇ Excel"}
          </Button>
        }
      />

      {/* Period controls */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-md border border-slate-200 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1.5 text-sm font-medium capitalize transition ${
                period === p ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">
            {period === "daily" ? "Day" : period === "weekly" ? "Any day in week" : "Any day in month"}
          </span>
          <Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
        </label>
        {d && <span className="ml-auto text-sm text-slate-500">{d.start} → {d.end}</span>}
      </div>

      {loading || !d ? (
        <TableSkeleton cols={5} rows={8} />
      ) : (
        <>
          {/* ---- Breakdown calls ---- */}
          <Card className="mb-6">
            <h2 className="mb-3 font-semibold text-slate-800">Breakdown calls</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile value={bd?.total ?? 0} label="Breakdown calls" />
              <Tile value={bd?.opened ?? 0} label="Opened" accent="text-blue-600" />
              <Tile value={bd?.closed ?? 0} label="Closed" accent="text-emerald-600" />
              <Tile value={bd?.still_open ?? 0} label="Still open" accent="text-amber-600" />
            </div>
            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                All tickets by status ({d.summary.total})
              </div>
              {statusEntries.length === 0 ? (
                <p className="text-sm text-slate-400">No tickets in this period.</p>
              ) : (
                statusEntries.map(([s, v]) => (
                  <Bar key={s} label={s} value={v} max={statusMax} color={STATUS_COLOR[s] ?? "rgb(var(--slate-400))"} />
                ))
              )}
            </div>
          </Card>

          {/* ---- Team performance ---- */}
          <Card className="mb-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold text-slate-800">Team performance</h2>
              <span className="text-xs text-slate-400">Calls closed &amp; days active this period</span>
            </div>
            {leaders.length === 0 ? (
              <p className="text-sm text-slate-400">No technician activity in this period.</p>
            ) : (
              <>
                {/* Leaderboard — closed per technician */}
                <div className="mb-4">
                  {leaders.slice(0, 10).map((p) => (
                    <Bar
                      key={p.name}
                      label={p.name}
                      value={p.closed_count}
                      max={closedMax}
                      color="rgb(var(--emerald-600))"
                      sub={`${p.active_days}d active`}
                    />
                  ))}
                </div>
                {/* Full team table */}
                <div className="overflow-x-auto">
                  <Table head={["Technician", "Role", "Closed", "Active days", "Open workload"]}>
                    {leaders.map((p) => (
                      <tr key={p.name}>
                        <td className="px-4 py-2 font-medium">{p.name}</td>
                        <td className="px-4 py-2 text-slate-500">{p.team_type}</td>
                        <td className="px-4 py-2 font-semibold tabular-nums text-emerald-700">{p.closed_count || "—"}</td>
                        <td className="px-4 py-2 tabular-nums">{p.active_days || "—"}</td>
                        <td className="px-4 py-2 tabular-nums">{p.open_count || "—"}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </>
            )}
          </Card>

          {/* ---- Tickets in period ---- */}
          <Card>
            <h2 className="mb-3 font-semibold text-slate-800">
              Tickets in period <span className="text-slate-400">({d.tickets.length})</span>
            </h2>
            <Table head={["Ticket No.", "Customer", "Work Type", "Status", "Stage", "Job Lead", "Idle"]}>
              {d.tickets.slice(0, 100).map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2 font-mono">
                    <Link to={`/tickets/${t.id}`} className="text-sky-600 hover:underline">{t.ticket_no}</Link>
                  </td>
                  <td className="px-4 py-2">{t.customer_name ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{t.work_type}</td>
                  <td className="px-4 py-2">{t.status}</td>
                  <td className="px-4 py-2 text-slate-500">{t.stage ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{t.job_lead ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-500">{t.idle_days}d</td>
                </tr>
              ))}
              {d.tickets.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No tickets in this period</td></tr>
              )}
            </Table>
            {d.tickets.length > 100 && (
              <p className="mt-2 text-xs text-slate-400">Showing first 100 · download the Excel for the full list.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
