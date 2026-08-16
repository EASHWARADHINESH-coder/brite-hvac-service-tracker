import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card, Skeleton } from "../../ui/primitives";
import { similarTickets } from "../../../api/services";
import type { AIRetrieved } from "../../../types";

/**
 * Past tickets semantically closest to this one — "have we seen this fault before?".
 *
 * Backed by the local vector store (embeddings only, no chat model), so it returns in
 * milliseconds and works even when no LLM is running. Silently hides itself if the AI
 * layer is off or the caller lacks org-wide scope, rather than showing a broken panel.
 */
export default function SimilarTickets({ ticketId }: { ticketId: number }) {
  const [hits, setHits] = useState<AIRetrieved[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHits(null);
    setHidden(false);
    similarTickets(ticketId, 5)
      .then((r) => setHits(r.filter((h) => h.ref_id !== ticketId)))
      .catch(() => setHidden(true));
  }, [ticketId]);

  if (hidden) return null;

  return (
    <Card>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-semibold text-slate-700">Similar past tickets</h2>
        <span className="text-[11px] text-slate-400">semantic match</span>
      </div>

      {hits === null ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : hits.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing comparable in the history yet.</p>
      ) : (
        <ul className="space-y-2">
          {hits.map((h) => (
            <li key={`${h.kind}-${h.ref_id}`} className="text-sm">
              <Link
                to={h.kind === "ticket" ? `/tickets/${h.ref_id}` : "/customers-pms?tab=Customers"}
                className="font-mono font-medium text-sky-600 hover:underline"
              >
                {h.label}
              </Link>
              {/* The indexed sentence already reads well — trim the redundant prefix. */}
              <div className="mt-0.5 text-xs text-slate-500">
                {h.text.replace(/^Ticket \S+ \| /, "")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
