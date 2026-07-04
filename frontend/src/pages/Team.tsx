import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

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
  createTeamMember,
  deleteTeamMember,
  listSkills,
  listTeam,
  updateTeamMember,
} from "../api/services";
import { TEAM_TYPES } from "../types";
import type { Skill, TeamMember, TeamType } from "../types";

type FormState = {
  name: string;
  team_type: TeamType;
  years_experience: string;
  mobile: string;
  email: string;
  skills: string[];
  grant_access: boolean;
  username: string;
  password: string;
};

const EMPTY: FormState = {
  name: "",
  team_type: "Technician",
  years_experience: "",
  mobile: "",
  email: "",
  skills: [],
  grant_access: false,
  username: "",
  password: "",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Mobile-login role granted per category (mirrors the backend). Contractors get none.
const accessRoleFor = (t: TeamType): string | null =>
  t === "Technician" ? "Technician" : t === "Helper" ? "Helper" : null;

const splitSkills = (s?: string | null): string[] =>
  (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function toForm(m: TeamMember): FormState {
  return {
    ...EMPTY,
    name: m.name ?? "",
    team_type: m.team_type,
    years_experience: m.years_experience != null ? String(m.years_experience) : "",
    mobile: m.mobile ?? "",
    email: m.email ?? "",
    skills: splitSkills(m.skills),
  };
}

export default function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [nameError, setNameError] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const load = () => listTeam().then(setMembers);
  useEffect(() => {
    load();
    listSkills().then(setSkills);
  }, []);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    return q ? skills.filter((s) => s.name.toLowerCase().includes(q)) : skills;
  }, [skills, skillQuery]);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setNameError(null);
    setSkillQuery("");
    setModalOpen(true);
  };

  const openEdit = (m: TeamMember) => {
    setEditing(m);
    setForm(toForm(m));
    setNameError(null);
    setSkillQuery("");
    setModalOpen(true);
  };

  const toggleSkill = (name: string) =>
    setForm((f) => ({
      ...f,
      skills: f.skills.includes(name)
        ? f.skills.filter((s) => s !== name)
        : [...f.skills, name],
    }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setNameError("Name is required");
      return;
    }
    if (form.mobile && !/^\d{10}$/.test(form.mobile)) {
      setBanner("Mobile number must be exactly 10 digits.");
      return;
    }
    if (form.email && !EMAIL_RE.test(form.email)) {
      setBanner("Enter a valid email address.");
      return;
    }
    const grant = !editing && form.grant_access;
    if (grant && (!form.username.trim() || !form.password)) {
      setBanner("Username and password are required for mobile access.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      team_type: form.team_type,
      years_experience: form.years_experience ? Number(form.years_experience) : null,
      mobile: form.mobile || null,
      email: form.email || null,
      skills: form.skills.length ? form.skills.join(", ") : null,
      ...(grant
        ? { grant_access: true, username: form.username.trim(), password: form.password }
        : {}),
    };
    setSaving(true);
    setBanner(null);
    try {
      if (editing) await updateTeamMember(editing.id, payload);
      else await createTeamMember(payload);
      setModalOpen(false);
      load();
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not save team member.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: TeamMember) => {
    if (!window.confirm(`Delete team member "${m.name}"?`)) return;
    setBanner(null);
    try {
      await deleteTeamMember(m.id);
      load();
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not delete team member.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Team"
        action={<Button onClick={openAdd}>+ Add person</Button>}
      />

      {banner && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {banner}
        </div>
      )}

      <Table head={["Name", "Category", "Experience (Yrs)", "Mobile", "Email", "Skills", ""]}>
        {members.map((m) => {
          const sk = splitSkills(m.skills);
          return (
            <tr key={m.id}>
              <td className="px-4 py-2 font-medium">
                <Link to={`/team/${m.id}`} className="text-slate-800 hover:underline">
                  {m.name}
                </Link>
              </td>
              <td className="px-4 py-2">{m.team_type}</td>
              <td className="px-4 py-2">{m.years_experience ?? "—"}</td>
              <td className="px-4 py-2">{m.mobile || "—"}</td>
              <td className="px-4 py-2">{m.email || "—"}</td>
              <td className="px-4 py-2">
                {sk.length ? (
                  <div className="flex flex-wrap gap-1">
                    {sk.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                <button
                  onClick={() => openEdit(m)}
                  className="mr-3 text-xs font-medium text-slate-600 hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(m)}
                  className="text-xs font-medium text-rose-600 hover:underline"
                >
                  Delete
                </button>
              </td>
            </tr>
          );
        })}
        {members.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No team members yet</td></tr>
        )}
      </Table>

      <Modal
        open={modalOpen}
        title={editing ? "Edit person" : "Add person"}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Field label="Name *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            {nameError && <p className="mt-1 text-xs text-rose-600">{nameError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category *">
              <Select
                value={form.team_type}
                onChange={(e) => setForm({ ...form, team_type: e.target.value as TeamType })}
              >
                {TEAM_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Experience (Yrs)">
              <Input
                value={form.years_experience}
                inputMode="numeric"
                onChange={(e) =>
                  setForm({ ...form, years_experience: e.target.value.replace(/[^\d]/g, "") })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile number (optional)">
              <Input
                value={form.mobile}
                inputMode="numeric"
                maxLength={10}
                placeholder="10 digits"
                onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/[^\d]/g, "") })}
              />
            </Field>
            <Field label="Email ID (optional)">
              <Input
                type="email"
                value={form.email}
                placeholder="name@example.com"
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-600">
              {`Skills${form.skills.length ? ` (${form.skills.length})` : ""}`}
            </span>
            <div>
              {form.skills.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {form.skills.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-white"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => toggleSkill(s)}
                        className="text-slate-300 hover:text-white"
                        aria-label={`Remove ${s}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                placeholder="Search skills…"
                value={skillQuery}
                onChange={(e) => setSkillQuery(e.target.value)}
              />
              <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-200">
                {filteredSkills.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={form.skills.includes(s.name)}
                      onChange={() => toggleSkill(s.name)}
                    />
                    <span>{s.name}</span>
                  </label>
                ))}
                {filteredSkills.length === 0 && (
                  <p className="px-3 py-2 text-xs text-slate-400">No matching skills</p>
                )}
              </div>
            </div>
          </div>

          {/* Mobile access (only when adding a new person) */}
          {!editing && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              {accessRoleFor(form.team_type) ? (
                <>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.grant_access}
                      onChange={(e) => setForm({ ...form, grant_access: e.target.checked })}
                    />
                    Grant mobile access (create a login)
                  </label>
                  {form.grant_access && (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-slate-500">
                        Role: <span className="font-medium text-slate-700">{accessRoleFor(form.team_type)}</span>{" "}
                        (auto from category)
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Username *">
                          <Input
                            value={form.username}
                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                          />
                        </Field>
                        <Field label="Password *">
                          <Input
                            type="password"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                          />
                        </Field>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Contractors don't get mobile access. Choose Technician or Helper to enable a login.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
