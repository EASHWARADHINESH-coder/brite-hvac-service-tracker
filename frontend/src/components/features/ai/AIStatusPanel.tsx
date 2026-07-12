import { useCallback, useEffect, useRef, useState } from "react";

import { Card } from "../../ui/primitives";
import { useAuth } from "../../../context/AuthContext";
import {
  getAIHealth,
  getAIJob,
  getAIMetrics,
  reindexAI,
} from "../../../api/services";
import type { AIHealth, AIMetrics } from "../../../types";

const POLL_MS = 12000;

function Stat({ label, value, tone = "slate" }: { label: string; value: string; tone?: string }) {
  const tones: Record<string, string> = {
    slate: "text-slate-800",
    green: "text-emerald-600",
    red: "text-rose-600",
    amber: "text-amber-600",
  };
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

export default function AIStatusPanel() {
  const { isPrivileged } = useAuth();
  const [health, setHealth] = useState<AIHealth | null>(null);
  const [metrics, setMetrics] = useState<AIMetrics | null>(null);
  const [open, setOpen] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, m] = await Promise.all([getAIHealth(), getAIMetrics()]);
      setHealth(h);
      setMetrics(m);
    } catch {
      /* transient — keep last known values */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function runReindex() {
    setReindexing(true);
    setJobMsg("Reindex queued…");
    try {
      const { job_id } = await reindexAI();
      // Poll the job until it finishes.
      const poll = async () => {
        const job = await getAIJob(job_id);
        if (job.status === "done" || job.status === "failed") {
          setJobMsg(`Reindex ${job.status}: ${job.detail ?? ""}`);
          setReindexing(false);
          refresh();
          if (pollRef.current) window.clearInterval(pollRef.current);
        } else {
          setJobMsg(`Reindex ${job.status}…`);
        }
      };
      pollRef.current = window.setInterval(poll, 2000);
      poll();
    } catch {
      setJobMsg("Reindex failed to start.");
      setReindexing(false);
    }
  }

  if (!health) return null;

  const circuitTone = health.circuit.open ? "red" : "green";
  const llmTone = health.llm_available ? "green" : "red";

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">AI System</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              health.llm_available ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            {health.enabled ? (health.llm_available ? "online" : "degraded") : "off"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isPrivileged && (
            <button
              onClick={runReindex}
              disabled={reindexing}
              className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50"
            >
              {reindexing ? "Reindexing…" : "Reindex"}
            </button>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Model chain */}
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
              Model chain (failover order)
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {health.model_chain.length === 0 && (
                <span className="text-xs text-slate-400">no models available</span>
              )}
              {health.model_chain.map((m, i) => (
                <span key={m} className="flex items-center gap-1">
                  {i > 0 && <span className="text-slate-300">→</span>}
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      i === 0 ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {m}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="LLM" value={health.llm_available ? "available" : "down"} tone={llmTone} />
            <Stat
              label="Circuit"
              value={health.circuit.open ? `open (${health.circuit.cooldown_remaining}s)` : "closed"}
              tone={circuitTone}
            />
            <Stat
              label="Vector store"
              value={health.vector_store ? `${health.indexed_documents} docs` : "off"}
              tone={health.vector_store ? "green" : "slate"}
            />
            <Stat label="Embeddings" value={health.embeddings_model} />
          </div>

          {/* Metrics */}
          {metrics && metrics.total > 0 && (
            <div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="AI calls" value={String(metrics.total)} />
                <Stat
                  label="Error rate"
                  value={`${(metrics.error_rate * 100).toFixed(1)}%`}
                  tone={metrics.error_rate > 0 ? "amber" : "green"}
                />
                <Stat
                  label="Cache hit"
                  value={`${(metrics.cache_hit_rate * 100).toFixed(1)}%`}
                />
              </div>
              {metrics.by_operation.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="py-1 pr-4 text-left font-medium">Operation</th>
                        <th className="py-1 pr-4 text-right font-medium">Calls</th>
                        <th className="py-1 pr-4 text-right font-medium">Avg ms</th>
                        <th className="py-1 text-right font-medium">Max ms</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-600">
                      {metrics.by_operation.map((o) => (
                        <tr key={o.operation} className="border-t border-slate-100">
                          <td className="py-1 pr-4">{o.operation}</td>
                          <td className="py-1 pr-4 text-right">{o.count}</td>
                          <td className="py-1 pr-4 text-right">{o.avg_ms}</td>
                          <td className="py-1 text-right">{o.max_ms}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {jobMsg && <div className="text-xs text-slate-500">{jobMsg}</div>}
        </div>
      )}
    </Card>
  );
}
