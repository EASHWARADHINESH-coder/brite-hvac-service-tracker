import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  Button,
  Combobox,
  Field,
  Input,
  Modal,
} from "../ui/primitives";
import type { ComboOption } from "../ui/primitives";
import {
  createCustomer,
  createTicket,
  listComplaints,
  listCustomers,
  listSkills,
  triageTicket,
} from "../../api/services";
import { useAuth } from "../../context/AuthContext";
import { MACHINE_TYPES, WORK_TYPES } from "../../types";
import type { Complaint, Customer, MachineType, Skill, Ticket, TriageResult, WorkType } from "../../types";

const today = () => new Date().toISOString().slice(0, 10);

export default function TicketForm({ onCreated }: { onCreated: (ticket: Ticket) => void }) {
  const { isPrivileged } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Inline "add customer" (opened from the customer combobox when there's no match).
  const [newCust, setNewCust] = useState<{ name: string; city: string } | null>(null);
  const [savingCust, setSavingCust] = useState(false);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [form, setForm] = useState({
    customer_id: "",
    complaint_date: today(),
    work_type: "Breakdown" as WorkType,
    machine_type: "VRF" as MachineType,
    primary_complaint: "",
    remarks: "",
    total_amount: "",
    advance_amount: "",
  });
  // Skill is editable: it defaults to the derived value but the user can override it.
  const [skill, setSkill] = useState("");
  const [skillTouched, setSkillTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AI auto-triage: free text → suggested fields (review before creating).
  const [triageText, setTriageText] = useState("");
  const [triaging, setTriaging] = useState(false);
  const [triageInfo, setTriageInfo] = useState<TriageResult | null>(null);

  const doTriage = async () => {
    if (!triageText.trim()) return;
    setTriaging(true);
    setTriageInfo(null);
    try {
      const r = await triageTicket(triageText.trim(), form.machine_type);
      setForm((f) => ({
        ...f,
        work_type: (r.work_type as WorkType) || f.work_type,
        machine_type: (r.machine_type as MachineType) || f.machine_type,
        primary_complaint: r.primary_complaint || f.primary_complaint,
      }));
      setSkillTouched(false); // let the skill re-derive from the suggestion
      setTriageInfo(r);
    } catch {
      setError("Couldn't run auto-triage");
    } finally {
      setTriaging(false);
    }
  };

  const PRIORITY_STYLE: Record<string, string> = {
    High: "bg-rose-100 text-rose-700",
    Normal: "bg-slate-100 text-slate-600",
    Low: "bg-sky-100 text-sky-700",
  };

  useEffect(() => {
    listCustomers().then(setCustomers);
    listComplaints().then(setComplaints);
    listSkills().then(setSkills);
  }, []);

  // Derived skill ("<Complaint Type> - <Machine Type>").
  const derivedSkill = useMemo(() => {
    const c = complaints.find((x) => x.name === form.primary_complaint);
    return c ? `${c.complaint_type} - ${form.machine_type}` : "";
  }, [complaints, form.primary_complaint, form.machine_type]);

  // Keep the skill field in sync with the derived value until the user edits it.
  useEffect(() => {
    if (!skillTouched) setSkill(derivedSkill);
  }, [derivedSkill, skillTouched]);

  // Offer every master skill, plus the derived one when it isn't in the master list yet.
  const skillOptions = useMemo(() => {
    const opts: ComboOption[] = skills.map((s) => ({ value: s.name, label: s.name }));
    if (derivedSkill && !opts.some((o) => o.value === derivedSkill)) {
      opts.unshift({ value: derivedSkill, label: derivedSkill, hint: "auto-derived" });
    }
    return opts;
  }, [skills, derivedSkill]);

  // Create the customer, then select it on the ticket form straight away.
  const saveCustomer = async () => {
    if (!newCust?.name.trim()) return;
    setSavingCust(true);
    try {
      const c = await createCustomer({
        name: newCust.name.trim(),
        city: newCust.city.trim() || undefined,
      });
      setCustomers((prev) => [...prev, c]);
      setForm((f) => ({ ...f, customer_id: String(c.id) }));
      setNewCust(null);
    } catch {
      setError("Failed to create customer");
    } finally {
      setSavingCust(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.customer_id) { setError("Select a customer"); return; }
    const isRepaired = form.work_type === "Repaired Service";
    if (isRepaired && !form.total_amount) { setError("Total amount is required for Repaired Service"); return; }
    if (isRepaired && form.advance_amount && Number(form.advance_amount) > Number(form.total_amount)) {
      setError("Advance cannot exceed the total amount"); return;
    }
    try {
      const ticket = await createTicket({
        customer_id: Number(form.customer_id),
        complaint_date: form.complaint_date,
        work_type: form.work_type,
        machine_type: form.machine_type,
        primary_complaint: form.primary_complaint || undefined,
        skill: skill.trim() || undefined,
        remarks: form.remarks || undefined,
        total_amount: isRepaired ? Number(form.total_amount) : undefined,
        advance_amount: isRepaired && form.advance_amount ? Number(form.advance_amount) : undefined,
      });
      onCreated(ticket);
    } catch {
      setError("Failed to create ticket");
    }
  };

  return (
    <>
        <form onSubmit={submit} className="space-y-4">
          {/* AI auto-triage — describe the complaint, get suggested fields to review. */}
          <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium text-sky-900">✨ Auto-triage</span>
              <span className="text-xs text-slate-500">describe the call — AI fills the fields below (review before saving)</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <textarea
                className="min-h-[38px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                rows={2}
                placeholder="e.g. VRF outdoor unit not cooling, suspect gas leak, urgent"
                value={triageText}
                onChange={(e) => setTriageText(e.target.value)}
              />
              <Button type="button" onClick={doTriage} disabled={triaging || !triageText.trim()}>
                {triaging ? "Analysing…" : "Suggest"}
              </Button>
            </div>
            {triageInfo && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-medium ${PRIORITY_STYLE[triageInfo.priority] ?? "bg-slate-100 text-slate-600"}`}>
                  Priority: {triageInfo.priority}
                </span>
                <span className="text-slate-500">
                  {triageInfo.rationale ?? "Suggested the work type, machine, and complaint below."}
                </span>
                <span className="text-[10px] text-slate-400">
                  ({triageInfo.source === "llm" ? "AI" : "keyword match"})
                </span>
              </div>
            )}
          </div>

          <Field label="Customer *">
            <Combobox
              placeholder="Search customer by name or city…"
              value={form.customer_id}
              onChange={(v) => setForm({ ...form, customer_id: v })}
              options={customers.map((c) => ({
                value: String(c.id),
                label: c.name,
                hint: c.city || undefined,
              }))}
              onCreate={isPrivileged ? (q) => setNewCust({ name: q, city: "" }) : undefined}
              createLabel={(q) => `＋ Add new customer "${q}"`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Complaint date">
              <Input
                type="date"
                value={form.complaint_date}
                onChange={(e) => setForm({ ...form, complaint_date: e.target.value })}
              />
            </Field>
            <Field label="Work type">
              <Combobox
                allowClear={false}
                value={form.work_type}
                onChange={(v) => setForm({ ...form, work_type: v as WorkType })}
                options={WORK_TYPES.map((w) => ({ value: w, label: w }))}
              />
            </Field>
            <Field label="Machine type">
              <Combobox
                allowClear={false}
                value={form.machine_type}
                onChange={(v) => setForm({ ...form, machine_type: v as MachineType })}
                options={MACHINE_TYPES.map((m) => ({ value: m, label: m }))}
              />
            </Field>
            <Field label="Primary complaint">
              <Combobox
                placeholder="None"
                value={form.primary_complaint}
                onChange={(v) => setForm({ ...form, primary_complaint: v })}
                options={complaints.map((c) => ({
                  value: c.name,
                  label: c.name,
                  hint: c.complaint_type,
                }))}
              />
            </Field>
          </div>

          <Field label="Skill (auto-derived — editable)">
            <Combobox
              placeholder={derivedSkill || "Search a skill…"}
              value={skill}
              onChange={(v) => { setSkill(v); setSkillTouched(true); }}
              options={skillOptions}
            />
            {skillTouched && derivedSkill && skill !== derivedSkill && (
              <button
                type="button"
                className="mt-1 text-xs text-sky-600 hover:underline"
                onClick={() => { setSkill(derivedSkill); setSkillTouched(false); }}
              >
                Reset to derived ({derivedSkill})
              </button>
            )}
          </Field>

          {form.work_type === "Repaired Service" && (
            <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">Payment (Repaired Service)</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Total amount ₹ *">
                  <Input type="number" min={0} value={form.total_amount}
                    onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
                </Field>
                <Field label="Advance paid ₹">
                  <Input type="number" min={0} value={form.advance_amount}
                    onChange={(e) => setForm({ ...form, advance_amount: e.target.value })} />
                </Field>
              </div>
              <p className="text-xs text-amber-700">
                Balance is tracked on the Payments page; the ticket stays "Payment Pending" until cleared.
              </p>
            </div>
          )}

          <Field label="Remarks">
            <Input
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </Field>

          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit">Create ticket</Button>
        </form>

      <Modal
        open={!!newCust}
        title="Add new customer"
        onClose={() => setNewCust(null)}
      >
        <div className="space-y-4">
          <Field label="Customer name *">
            <Input
              autoFocus
              value={newCust?.name ?? ""}
              onChange={(e) => setNewCust((c) => c && { ...c, name: e.target.value })}
            />
          </Field>
          <Field label="City">
            <Input
              value={newCust?.city ?? ""}
              onChange={(e) => setNewCust((c) => c && { ...c, city: e.target.value })}
            />
          </Field>
          <p className="text-xs text-slate-500">
            Address, contact and AMC details can be filled in later on the Customers page.
          </p>
          <div className="flex gap-2">
            <Button onClick={saveCustomer} disabled={savingCust || !newCust?.name.trim()}>
              {savingCust ? "Saving…" : "Save & select"}
            </Button>
            <Button variant="ghost" onClick={() => setNewCust(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
