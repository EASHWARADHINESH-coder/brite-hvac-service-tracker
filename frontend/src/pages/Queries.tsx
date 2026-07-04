import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Table,
} from "../components/ui/primitives";
import {
  createQuery,
  listQueries,
  listTickets,
  resolveQuery,
} from "../api/services";
import { useAuth } from "../context/AuthContext";
import type { Query, Ticket } from "../types";

export default function Queries() {
  const { isPrivileged } = useAuth(); // Admin/Engineer manage
  const [queries, setQueries] = useState<Query[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [form, setForm] = useState({ subject: "", message: "", ticket_id: "" });
  const [fStatus, setFStatus] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  // resolve modal
  const [resolving, setResolving] = useState<Query | null>(null);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => listQueries(fStatus || undefined).then(setQueries);
  useEffect(() => { load(); }, [fStatus]);
  useEffect(() => { listTickets().then(setTickets).catch(() => setTickets([])); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) { setBanner("Subject and message are required."); return; }
    setBanner(null);
    try {
      await createQuery({
        subject: form.subject.trim(),
        message: form.message.trim(),
        ticket_id: form.ticket_id ? Number(form.ticket_id) : null,
      });
      setForm({ subject: "", message: "", ticket_id: "" });
      load();
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not raise query.");
    }
  };

  const openResolve = (q: Query) => { setResolving(q); setReply(""); setBanner(null); };

  const confirmResolve = async () => {
    if (!resolving) return;
    if (!reply.trim()) { setBanner("Enter a reply to close the query."); return; }
    setSaving(true);
    setBanner(null);
    try {
      await resolveQuery(resolving.id, reply.trim());
      setResolving(null);
      load();
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not resolve query.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Queries" />

      {banner && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {banner}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Raise a query — available to everyone */}
        <Card>
          <h2 className="mb-3 font-semibold text-slate-700">Raise a query</h2>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Subject *">
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </Field>
            <Field label="Message *">
              <textarea
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                rows={4}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
            <Field label="Related ticket (optional)">
              <Select value={form.ticket_id} onChange={(e) => setForm({ ...form, ticket_id: e.target.value })}>
                <option value="">None</option>
                {tickets.map((t) => <option key={t.id} value={t.id}>{t.ticket_no}</option>)}
              </Select>
            </Field>
            <Button type="submit">Send to Service Admin</Button>
          </form>
        </Card>

        <div className="lg:col-span-2">
          <div className="mb-4 max-w-xs">
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option>Open</option>
              <option>Closed</option>
            </Select>
          </div>

          <Table head={[
            "Subject", ...(isPrivileged ? ["Raised by"] : []), "Ticket", "Status", "Reply", ...(isPrivileged ? [""] : []),
          ]}>
            {queries.map((q) => (
              <tr key={q.id}>
                <td className="px-4 py-2">
                  <div className="font-medium">{q.subject}</div>
                  <div className="text-xs text-slate-500">{q.message}</div>
                  <div className="text-[10px] text-slate-400">{q.created_at}</div>
                </td>
                {isPrivileged && <td className="px-4 py-2 text-sm">{q.raised_by_name ?? "—"}</td>}
                <td className="px-4 py-2 font-mono text-xs">
                  {q.ticket_id ? (
                    <Link to={`/tickets/${q.ticket_id}`} className="text-sky-600 hover:underline">{q.ticket_no}</Link>
                  ) : "—"}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    q.status === "Open" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {q.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-sm">
                  {q.reply ? (
                    <div>
                      <div>{q.reply}</div>
                      <div className="text-[10px] text-slate-400">
                        by {q.resolved_by_name} · {q.resolved_at}
                      </div>
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                {isPrivileged && (
                  <td className="px-4 py-2 text-right">
                    {q.status === "Open" && (
                      <button onClick={() => openResolve(q)}
                        className="text-xs font-medium text-slate-700 hover:underline">
                        Reply & close →
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {queries.length === 0 && (
              <tr>
                <td colSpan={isPrivileged ? 6 : 4} className="px-4 py-6 text-center text-slate-400">
                  No queries
                </td>
              </tr>
            )}
          </Table>
        </div>
      </div>

      <Modal
        open={!!resolving}
        title={resolving ? `Reply — ${resolving.subject}` : ""}
        onClose={() => setResolving(null)}
      >
        {resolving && (
          <div className="space-y-3">
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span className="font-medium">{resolving.raised_by_name}:</span> {resolving.message}
            </p>
            <Field label="Reply / resolution *">
              <textarea
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                rows={4}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setResolving(null)}>Cancel</Button>
              <Button type="button" onClick={confirmResolve} disabled={saving}>
                {saving ? "Saving…" : "Reply & close"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
