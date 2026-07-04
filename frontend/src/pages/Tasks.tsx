import { FormEvent, useEffect, useState } from "react";

import {
  Button,
  Card,
  Field,
  Input,
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

  // filters
  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fAssignee, setFAssignee] = useState("");

  const load = () =>
    listTasks({
      status: fStatus || undefined,
      priority: fPriority || undefined,
      assignee_user_id: fAssignee ? Number(fAssignee) : undefined,
    }).then(setTasks);

  useEffect(() => { load(); }, [fStatus, fPriority, fAssignee]);
  useEffect(() => {
    if (isPrivileged) {
      listAssignees().then(setAssignees).catch(() => setAssignees([]));
      listTickets().then(setTickets).catch(() => setTickets([]));
    }
  }, [isPrivileged]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim() || !form.assignee_user_id) {
      setError("Title and assignee are required");
      return;
    }
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
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Could not create task");
    }
  };

  const setStatus = (t: Task, status: TaskStatus) =>
    updateTask(t.id, { status }).then(load);

  const remove = (t: Task) => {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    deleteTask(t.id).then(load);
  };

  return (
    <div>
      <PageHeader title="Tasks" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Assign form — Admin/Engineer only */}
        {isPrivileged && (
          <Card>
            <h2 className="mb-3 font-semibold text-slate-700">Assign task</h2>
            <form onSubmit={submit} className="space-y-3">
              <Field label="Title *">
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
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
              <Button type="submit">Assign task</Button>
            </form>
          </Card>
        )}

        <div className={isPrivileged ? "lg:col-span-2" : "lg:col-span-3"}>
          {/* Filters */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">All statuses</option>
              {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
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
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2">
                  <div className="font-medium">{t.title}</div>
                  {t.description && <div className="text-xs text-slate-500">{t.description}</div>}
                </td>
                <td className="px-4 py-2">{t.assignee_name ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[t.priority]}`}>
                    {t.priority}
                  </span>
                </td>
                <td className="px-4 py-2 text-sm">
                  {t.due_date
                    ? <span className={t.overdue ? "font-medium text-rose-600" : ""}>{t.due_date}</span>
                    : "—"}
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
            {tasks.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No tasks</td></tr>
            )}
          </Table>
        </div>
      </div>
    </div>
  );
}
