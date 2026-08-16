import { FormEvent, useEffect, useState } from "react";

import {
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Table,
} from "../components/ui/primitives";
import {
  createTask,
  deleteTask,
  listAssignees,
  listTasks,
  listTickets,
  updateTask,
} from "../api/services";
import type { Assignee } from "../api/services";
import { useAuth } from "../context/AuthContext";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types";
import type { Task, TaskPriority, TaskStatus, Ticket } from "../types";

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  High: "bg-rose-100 text-rose-700",
  Normal: "bg-slate-100 text-slate-600",
  Low: "bg-sky-100 text-sky-700",
};
const STATUS_STYLE: Record<TaskStatus, string> = {
  Open: "bg-amber-100 text-amber-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Done: "bg-emerald-100 text-emerald-700",
};
// Left-accent per priority, so the list scans quickly.
const PRIORITY_ACCENT: Record<TaskPriority, string> = {
  High: "border-l-rose-400",
  Normal: "border-l-slate-200",
  Low: "border-l-sky-300",
};

const EMPTY = {
  title: "", description: "", assignee_user_id: "",
  priority: "Normal" as TaskPriority, due_date: "", ticket_id: "",
};

export default function Tasks() {
  const { isPrivileged } = useAuth(); // Admin/Engineer can assign
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // filters (client-side, so the status chips can show live counts)
  const [fStatus, setFStatus] = useState<TaskStatus | "">("");
  const [fPriority, setFPriority] = useState("");
  const [fAssignee, setFAssignee] = useState("");

  const load = () => listTasks({}).then(setTasks);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (isPrivileged) {
      listAssignees().then(setAssignees).catch(() => setAssignees([]));
      listTickets().then(setTickets).catch(() => setTickets([]));
    }
  }, [isPrivileged]);

  const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const openOverdue = tasks.filter((t) => t.overdue && t.status !== "Done").length;

  const shown = tasks.filter((t) => {
    if (fStatus && t.status !== fStatus) return false;
    if (fPriority && t.priority !== fPriority) return false;
    if (fAssignee && String(t.assignee_user_id) !== fAssignee) return false;
    return true;
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim() || !form.assignee_user_id) {
      setError("Title and assignee are required");
      return;
    }
    setSaving(true);
    try {
      await createTask({
        title: form.title.trim(),
        description: form.description || null,
        assignee_user_id: Number(form.assignee_user_id),
        priority: form.priority,
        due_date: form.due_date || null,
        ticket_id: form.ticket_id ? Number(form.ticket_id) : null,
      });
      setForm({ ...EMPTY });
      setCreateOpen(false);
      load();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Could not create task");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = (t: Task, status: TaskStatus) => updateTask(t.id, { status }).then(load);

  const remove = (t: Task) => {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    deleteTask(t.id).then(load);
  };

  const chip = (label: string, value: TaskStatus | "", count: number) => (
    <button
      key={label}
      type="button"
      onClick={() => setFStatus(value)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        fStatus === value
          ? "border-slate-800 bg-slate-800 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${fStatus === value ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
        {count}
      </span>
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Tasks"
        action={isPrivileged && <Button onClick={() => { setForm({ ...EMPTY }); setError(null); setCreateOpen(true); }}>＋ New Task</Button>}
      />

      {/* Status chips + secondary filters */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {chip("All", "", tasks.length)}
        {TASK_STATUSES.map((s) => chip(s, s, statusCounts[s] ?? 0))}
        {openOverdue > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">
            ⚠ {openOverdue} overdue
          </span>
        )}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <Select value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
          <option value="">All priorities</option>
          {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </Select>
        {isPrivileged && (
          <Select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
            <option value="">All assignees</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        )}
      </div>

      <Table head={["Task", "Assignee", "Priority", "Due", "Ticket", "Status", ""]}>
        {shown.map((t) => (
          <tr key={t.id} className={`border-l-4 ${PRIORITY_ACCENT[t.priority]}`}>
            <td className="px-4 py-2">
              <div className="font-medium text-slate-800">{t.title}</div>
              {t.description && <div className="max-w-md truncate text-xs text-slate-500">{t.description}</div>}
            </td>
            <td className="px-4 py-2 whitespace-nowrap">{t.assignee_name ?? "—"}</td>
            <td className="px-4 py-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[t.priority]}`}>
                {t.priority}
              </span>
            </td>
            <td className="px-4 py-2 whitespace-nowrap text-sm">
              {t.due_date ? (
                <span className={t.overdue && t.status !== "Done" ? "font-medium text-rose-600" : "text-slate-600"}>
                  {t.due_date}{t.overdue && t.status !== "Done" ? " ⚠" : ""}
                </span>
              ) : "—"}
            </td>
            <td className="px-4 py-2 font-mono text-xs">{t.ticket_no ?? "—"}</td>
            <td className="px-4 py-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>
                {t.status}
              </span>
            </td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              <select
                className="mr-2 rounded-md border border-slate-300 px-2 py-1 text-xs"
                value={t.status}
                onChange={(e) => setStatus(t, e.target.value as TaskStatus)}
              >
                {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              {isPrivileged && (
                <button onClick={() => remove(t)}
                  className="text-xs font-medium text-rose-600 hover:underline">Delete</button>
              )}
            </td>
          </tr>
        ))}
        {shown.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No tasks</td></tr>
        )}
      </Table>

      {/* Create task modal (Admin/Engineer) */}
      <Modal open={createOpen} title="Assign task" onClose={() => setCreateOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Title *">
            <Input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="Assign to *">
            <Select value={form.assignee_user_id}
              onChange={(e) => setForm({ ...form, assignee_user_id: e.target.value })}>
              <option value="">Select user…</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>{a.label} ({a.role})</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <Select value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
                {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label="Due date">
              <Input type="date" value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </Field>
          </div>
          <Field label="Link to ticket (optional)">
            <Select value={form.ticket_id}
              onChange={(e) => setForm({ ...form, ticket_id: e.target.value })}>
              <option value="">None</option>
              {tickets.map((t) => <option key={t.id} value={t.id}>{t.ticket_no}</option>)}
            </Select>
          </Field>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Assigning…" : "Assign task"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
