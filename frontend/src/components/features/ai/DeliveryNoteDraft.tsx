import { useState } from "react";

import { Button, Modal, Skeleton } from "../../ui/primitives";
import { useToast } from "../../ui/Toast";
import { draftDeliveryNote } from "../../../api/services";
import type { DeliveryNoteDraft as Draft } from "../../../types";

/**
 * Delivery-note draft for the materials currently allocated to a ticket.
 *
 * The line items always come from the materials ledger — the LLM only rewrites the covering
 * paragraph, so it can never invent a quantity or a part. The badge says which path produced
 * the text, and the raw lines are shown separately so they can be checked against the note.
 */
export default function DeliveryNoteDraft({ ticketId }: { ticketId: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (enhance: boolean) => {
    setLoading(true);
    setDraft(null);
    try {
      setDraft(await draftDeliveryNote(ticketId, enhance));
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Couldn't draft the delivery note", detail);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const start = () => { setOpen(true); load(true); };

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      toast.success("Delivery note copied");
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };

  return (
    <>
      <button
        onClick={start}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        📄 Delivery note
      </button>

      <Modal open={open} title="Delivery note draft" onClose={() => setOpen(false)}>
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {draft && !loading && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-medium ${
                draft.llm_enhanced
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}>
                {draft.llm_enhanced ? "AI-polished wording" : "rule-based wording"}
              </span>
              <span className="text-slate-400">
                {draft.ticket_no} · {draft.customer_name ?? "—"}
              </span>
            </div>

            {draft.lines.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-100 px-3 py-2 text-sm text-amber-800">
                No materials are currently allocated to this ticket, so the note has no line
                items. Allocate stock on the Materials page first.
              </p>
            ) : (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Line items · from the ledger
                </div>
                <ul className="rounded-md border border-slate-200 text-sm">
                  {draft.lines.map((l, i) => (
                    <li
                      key={`${l.material_name}-${i}`}
                      className="flex justify-between border-b border-slate-100 px-3 py-1.5 last:border-0"
                    >
                      <span>{l.material_name}</span>
                      <span className="tabular-nums text-slate-500">{l.qty} {l.uom}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Covering note
              </div>
              <textarea
                readOnly
                value={draft.body}
                rows={12}
                className="w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-700"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={copy}>Copy note</Button>
              <Button variant="ghost" onClick={() => load(!draft.llm_enhanced)}>
                {draft.llm_enhanced ? "Show plain version" : "Polish with AI"}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
