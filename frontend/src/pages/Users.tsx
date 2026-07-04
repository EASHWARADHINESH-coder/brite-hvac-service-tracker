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
import { createUser, listUsers, updateUser } from "../api/services";
import { USER_ROLES } from "../types";
import type { AppUser, UserRole } from "../types";

const EMPTY = {
  username: "", password: "", full_name: "", role: "Service Engineer" as UserRole,
};

export default function Users() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [edit, setEdit] = useState({
    username: "", full_name: "", role: "Service Engineer" as UserRole, password: "",
  });
  const [editErr, setEditErr] = useState<string | null>(null);

  const load = () => listUsers().then(setUsers);
  useEffect(() => { load(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.username || !form.password) { setError("Username and password required"); return; }
    try {
      await createUser({
        username: form.username,
        password: form.password,
        role: form.role,
        full_name: form.full_name || undefined,
      });
      setForm({ ...EMPTY });
      load();
    } catch {
      setError("Could not create user (username may exist)");
    }
  };

  const openEdit = (u: AppUser) => {
    setEditing(u);
    setEdit({
      username: u.username,
      full_name: u.full_name ?? "",
      role: u.role,
      password: "",
    });
    setEditErr(null);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setEditErr(null);
    if (!edit.username.trim()) { setEditErr("Username is required"); return; }
    try {
      await updateUser(editing.id, {
        username: edit.username.trim(),
        full_name: edit.full_name || undefined,
        role: edit.role,
        password: edit.password || undefined,
      });
      setEditing(null);
      load();
    } catch (err: any) {
      setEditErr(err?.response?.data?.detail ?? "Could not update user");
    }
  };

  const toggleActive = (u: AppUser) =>
    updateUser(u.id, { is_active: !u.is_active }).then(load);

  return (
    <div>
      <PageHeader title="Users" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold text-slate-700">Add user</h2>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Username *">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Password *">
              <Input type="password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Full name (match Team member name)">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
                {USER_ROLES.map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <Button type="submit">Create user</Button>
          </form>
        </Card>

        <div className="lg:col-span-2">
          <Table head={["Username", "Name", "Role", "Active", ""]}>
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? "" : "opacity-60"}>
                <td className="px-4 py-2 font-medium">{u.username}</td>
                <td className="px-4 py-2">
                  {(u.role === "Technician" || u.role === "Helper") && u.team_member_id ? (
                    <Link to={`/team/${u.team_member_id}`} className="text-sky-600 hover:underline"
                      title="Open Team profile">
                      {u.full_name ?? "—"}
                    </Link>
                  ) : (
                    u.full_name ?? "—"
                  )}
                </td>
                <td className="px-4 py-2">{u.role}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                  }`}>
                    {u.is_active ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(u)}
                    className="mr-3 text-xs font-medium text-slate-600 hover:underline">Edit</button>
                  <button onClick={() => toggleActive(u)}
                    className={`text-xs font-medium hover:underline ${
                      u.is_active ? "text-rose-600" : "text-emerald-600"
                    }`}>
                    {u.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No users</td></tr>
            )}
          </Table>
        </div>
      </div>

      <Modal
        open={!!editing}
        title={editing ? `Edit user — ${editing.username}` : ""}
        onClose={() => setEditing(null)}
      >
        <form onSubmit={saveEdit} className="space-y-3">
          <Field label="Username *">
            <Input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} />
          </Field>
          <Field label="Full name (match Team member name)">
            <Input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={edit.role}
              onChange={(e) => setEdit({ ...edit, role: e.target.value as UserRole })}>
              {USER_ROLES.map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Reset password (leave blank to keep)">
            <Input type="password" value={edit.password}
              onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
          </Field>
          {editErr && <p className="text-sm text-rose-600">{editErr}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
