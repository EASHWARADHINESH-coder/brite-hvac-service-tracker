import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card } from "../../ui/primitives";
import { getTicketResolutions } from "../../../api/services";
import type { ResolutionMatch } from "../../../types";

const STATUS_STYLE: Record<string, string> = {
  Closed: "bg-emerald-100 text-emerald-700",
  "In Progress": "bg-blue-100 text-blue-800",
  Open: "bg-amber-100 text-amber-800",
  Reopened: "bg-rose-100 text-rose-700",
  Cancelled: "bg-slate-100 text-slate-500",
};

/**
 * "What fixed it last time" — semantically similar past tickets, each with how it was resolved
 * and the spare parts used. Grounded in the lifecycle + claims (no LLM), so it's instant and
 * can't invent a fix. Hidden when there's nothing useful to show.
 */
export default function WhatFixedIt({ ticketId }: { ticketId: number }) {
  const [matches, setMatches] = useState<ResolutionMatch[] | null>(null);

  useEffect(() => {
    getTicketResolutions(ticketId, 4).then(setMatches).catch(() => setMatches([]));
  }, [ticketId]);

  if (!matches) return null;
  // Only worth showing if at least one match actually has a recorded fix or parts.
  const useful = matches.filter((m) => m.resolution || m.parts.length > 0);
  if (useful.length === 0) return null;

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold text-slate-700">🔧 What fixed it last time</h2>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Similar past jobs and how they were resolved — review before acting.
      </p>
      <div className="space-y-3">
        {useful.map((m) => (
          <div key={m.ticket_id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/tickets/${m.ticket_id}`} className="font-mono text-sm font-medium text-sky-600 hover:underline">
                {m.ticket_no}
              </Link>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[m.status] ?? "bg-slate-100 text-slate-500"}`}>
                {m.status}
              </span>
              <span className="text-xs text-slate-500">
                {[m.complaint, m.machine_type].filter(Boolean).join(" · ") || "—"}
              </span>
              {m.customer_name && <span className="ml-auto truncate text-xs text-slate-400">{m.customer_name}</span>}
            </div>

            {m.resolution && (
              <p className="mt-2 text-sm text-slate-700">
                <span className="font-medium text-slate-500">Fix: </span>{m.resolution}
              </p>
            )}

            {m.parts.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-400">Parts:</span>
                {m.parts.map((p, i) => (
                  <span key={i} className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-800">
                    {p}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
