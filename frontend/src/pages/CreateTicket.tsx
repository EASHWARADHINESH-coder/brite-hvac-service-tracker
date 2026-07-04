import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
} from "../components/ui/primitives";
import {
  createTicket,
  listComplaints,
  listCustomers,
  listSkills,
} from "../api/services";
import { MACHINE_TYPES, WORK_TYPES } from "../types";
import type { Complaint, Customer, MachineType, Skill, WorkType } from "../types";

const today = () => new Date().toISOString().slice(0, 10);

export default function CreateTicket() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
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
      nav(`/tickets/${ticket.id}`);
    } catch {
      setError("Failed to create ticket");
    }
  };

  return (
    <div>
      <PageHeader title="Create Ticket" />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Customer *">
            <Select
              value={form.customer_id}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
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
              <Select
                value={form.work_type}
                onChange={(e) => setForm({ ...form, work_type: e.target.value as WorkType })}
              >
                {WORK_TYPES.map((w) => <option key={w}>{w}</option>)}
              </Select>
            </Field>
            <Field label="Machine type">
              <Select
                value={form.machine_type}
                onChange={(e) => setForm({ ...form, machine_type: e.target.value as MachineType })}
              >
                {MACHINE_TYPES.map((m) => <option key={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Primary complaint">
              <Select
                value={form.primary_complaint}
                onChange={(e) => setForm({ ...form, primary_complaint: e.target.value })}
              >
                <option value="">None</option>
                {complaints.map((c) => <option key={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Skill (auto-derived — editable)">
            <Input
              list="skill-options"
              value={skill}
              placeholder={derivedSkill || "Select or type a skill…"}
              onChange={(e) => { setSkill(e.target.value); setSkillTouched(true); }}
            />
            <datalist id="skill-options">
              {skills.map((s) => <option key={s.id} value={s.name} />)}
            </datalist>
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
      </Card>
    </div>
  );
}
