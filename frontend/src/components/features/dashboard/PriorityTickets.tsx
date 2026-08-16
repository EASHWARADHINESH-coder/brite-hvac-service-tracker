import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card } from "../../ui/primitives";
import { getDashboardPriority } from "../../../api/services";
import type { DashboardPriority, PriorityItem } from "../../../types";

// A short badge per reason, coloured by kind. Keeps the "why it's important" scannable.
function reasonTone(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("starred")) return "bg-amber-100 text-amber-800";
  if (r.includes("vip") || r.includes("key")) return "bg-violet-100 text-violet-700";
  if (r.includes("overdue")) return "bg-rose-100 text-rose-700";
  if (r.includes("reopen")) return "bg-rose-100 text-rose-700";
  if (r.includes("major")) return "bg-orange-100 text-orange-800";
  return "bg-slate-100 text-slate-600";
}

/**
 * Priority tickets — an automatically ranked "what to look at first" list for the dashboard.
 * Combines the deterministic urgency score with a manual star and a key/VIP-customer boost;
 * each row shows why it ranked. Built for a new employee to know where to start.
 */
export default function PriorityTickets() {
  const [d, setD] = useState<DashboardPriority | null>(null);
  useEffect(() => { getDashboardPriority(8).then(setD).catch(() => setD(null)); }, []);
  if (!d || d.scope !== "org" || !d.items || d.items.length === 0) return null;

  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Priority tickets</h2>
        <span className="text-xs text-slate-400">Most important first · auto-ranked</span>
      </div>
      <div className="divide-y divide-slate-100">
        {d.items.map((t, i) => (
          <PriorityRow key={t.id} t={t} rank={i + 1} />
        ))}
      </div>
    </Card>
  );
}

function PriorityRow({ t, rank }: { t: PriorityItem; rank: number }) {
  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <span className="w-5 shrink-0 text-right font-semibold text-slate-400">{rank}</span>
      {t.starred && <span className="shrink-0 text-amber-500" title="Starred important">★</span>}
      <Link
        to={`/tickets/${t.id}`}
        className="w-28 shrink-0 truncate font-mono font-medium text-sky-600 hover:underline"
      >
        {t.ticket_no}
      </Link>
      <span className="min-w-0 flex-1 truncate text-slate-700">{t.customer_name ?? "—"}</span>
      <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{t.work_type} · {t.status}</span>
      <div className="hidden shrink-0 items-center gap-1 md:flex">
        {t.reasons.slice(0, 2).map((r) => (
          <span key={r} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${reasonTone(r)}`}>
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}
