import { useEffect, useRef, useState } from "react";

import { Button, Card, Input, PageHeader } from "../components/ui/primitives";
import AIStatusPanel from "../components/features/ai/AIStatusPanel";
import { useAuth } from "../context/AuthContext";
import {
  addTicketUpdate,
  executeAction,
  getAIStatus,
  rankTickets,
  streamAssistant,
} from "../api/services";
import type { AgentProposal, AIStatus, RankedTicket } from "../types";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "How many overdue tickets?",
  "What's the open ticket count?",
  "Any materials out of stock?",
  "How many reopened jobs?",
];

export default function Assistant() {
  const { isPrivileged } = useAuth();
  const [status, setStatus] = useState<AIStatus | null>(null);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [ranked, setRanked] = useState<RankedTicket[] | null>(null);
  const [ranking, setRanking] = useState(false);
  const [assigningId, setAssigningId] = useState<number | null>(null);

  useEffect(() => {
    getAIStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  function appendToLastAssistant(text: string) {
    setTurns((t) => {
      const next = [...t];
      next[next.length - 1] = {
        ...next[next.length - 1],
        text: next[next.length - 1].text + text,
      };
      return next;
    });
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q || asking) return;
    setInput("");
    setProposal(null);
    // Push the user turn plus an empty assistant turn that tokens stream into.
    setTurns((t) => [...t, { role: "user", text: q }, { role: "assistant", text: "" }]);
    setAsking(true);
    try {
      await streamAssistant(q, {
        onToken: appendToLastAssistant,
        onProposal: setProposal,
      });
    } catch {
      appendToLastAssistant("Sorry — the assistant is unavailable right now.");
    } finally {
      setAsking(false);
    }
  }

  async function confirmProposal() {
    if (!proposal) return;
    setConfirming(true);
    try {
      const result = await executeAction(proposal);
      setTurns((t) => [...t, { role: "assistant", text: `✅ ${result.message}` }]);
      setProposal(null);
    } catch {
      setTurns((t) => [
        ...t,
        { role: "assistant", text: "Couldn't complete that action. Please try from the form." },
      ]);
    } finally {
      setConfirming(false);
    }
  }

  async function loadRanking() {
    setRanking(true);
    try {
      setRanked(await rankTickets({ limit: 10, explain: true }));
    } finally {
      setRanking(false);
    }
  }

  // Auto-triage: confirm the suggested assignee -> add an Assigned lifecycle row.
  async function assign(r: RankedTicket) {
    if (!r.suggested_assignee_id || !r.suggested_assignee_name) return;
    if (!window.confirm(`Assign ${r.ticket_no} to ${r.suggested_assignee_name}?`)) return;
    setAssigningId(r.ticket_id);
    try {
      await addTicketUpdate(r.ticket_id, {
        stage: "Assigned",
        job_lead: r.suggested_assignee_name,
        team_ids: [r.suggested_assignee_id],
      });
      // Drop it from the list — it's no longer unassigned.
      setRanked((cur) => (cur ? cur.filter((x) => x.ticket_id !== r.ticket_id) : cur));
    } catch {
      /* ignore; the row stays so the user can retry */
    } finally {
      setAssigningId(null);
    }
  }

  const llmBadge = status?.llm_available
    ? { text: `AI · ${status.provider}:${status.model}`, cls: "bg-emerald-100 text-emerald-700" }
    : { text: "Rule-based (LLM off)", cls: "bg-slate-100 text-slate-500" };

  return (
    <div>
      <PageHeader
        title="Assistant"
        action={
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${llmBadge.cls}`}>
            {llmBadge.text}
          </span>
        }
      />

      <AIStatusPanel />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Chat */}
        <Card className="flex h-[32rem] flex-col">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
            {turns.length === 0 && (
              <div className="text-sm text-slate-400">
                Ask about tickets, overdue jobs, or stock. Answers come from live data.
              </div>
            )}
            {turns.map((t, i) => (
              <div
                key={i}
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  t.role === "user"
                    ? "ml-auto bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-800"
                }`}
              >
                {t.text || (t.role === "assistant" && asking ? "…" : "")}
              </div>
            ))}
          </div>

          {proposal && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <div className="font-medium text-amber-800">Confirm action</div>
              <div className="mt-1 text-amber-700">{proposal.summary}</div>
              <div className="mt-2 flex gap-2">
                <Button onClick={confirmProposal} disabled={confirming}>
                  {confirming ? "Working…" : "Confirm"}
                </Button>
                <Button variant="ghost" onClick={() => setProposal(null)} disabled={confirming}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={asking}
                className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              disabled={asking}
            />
            <Button type="submit" disabled={asking || !input.trim()}>
              Send
            </Button>
          </form>
        </Card>

        {/* Ranking — allocation aide, privileged users only */}
        {isPrivileged && (
          <Card className="flex h-[32rem] flex-col">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Allocation priority</h2>
              <Button variant="ghost" onClick={loadRanking} disabled={ranking}>
                {ranking ? "Ranking…" : "Rank unassigned"}
              </Button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {ranked === null && (
                <div className="text-sm text-slate-400">
                  Ranks unassigned tickets by urgency (SLA, work type, severity, age).
                </div>
              )}
              {ranked?.length === 0 && (
                <div className="text-sm text-slate-400">No unassigned tickets. 🎉</div>
              )}
              {ranked?.map((r) => (
                <div key={r.ticket_id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{r.ticket_no}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">
                      {r.score}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {r.customer_name || "—"} · {r.work_type}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{r.reasons.join(" · ")}</div>
                  {r.rationale && (
                    <div className="mt-1 text-xs italic text-emerald-700">{r.rationale}</div>
                  )}
                  {r.suggested_assignee_name && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1.5">
                      <div className="min-w-0 text-xs">
                        <span className="text-slate-400">Suggest:</span>{" "}
                        <span className="font-medium text-slate-700">{r.suggested_assignee_name}</span>
                        <span className="text-slate-400"> · {r.assignee_reason}</span>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => assign(r)}
                        disabled={assigningId === r.ticket_id}
                      >
                        {assigningId === r.ticket_id ? "…" : "Assign"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
