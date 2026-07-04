import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

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
  createCustomer,
  deleteCustomer,
  exportCustomers,
  listCustomers,
  updateCustomer,
} from "../api/services";
import type { Customer } from "../types";

type ContractType = "WTY" | "AMC" | "NIC";

type FormState = {
  name: string;
  address: string;
  city: string;
  pincode: string;
  contact_person: string;
  contact_number: string;
  secondary_mobile: string;
  mail_id: string;
  contract_type: ContractType;
  warranty_start_date: string;
  warranty_end_date: string;
};

const EMPTY: FormState = {
  name: "",
  address: "",
  city: "",
  pincode: "",
  contact_person: "",
  contact_number: "",
  secondary_mobile: "",
  mail_id: "",
  contract_type: "NIC",
  warranty_start_date: "",
  warranty_end_date: "",
};

const CONTRACT_STYLE: Record<string, string> = {
  AMC: "bg-indigo-100 text-indigo-700",
  WTY: "bg-blue-100 text-blue-700",
  NIC: "bg-slate-100 text-slate-500",
};

const MOBILE_RE = /^\d{10}$/;
const PINCODE_RE = /^\d{6}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validate(f: FormState): Partial<Record<keyof FormState, string>> {
  const errs: Partial<Record<keyof FormState, string>> = {};
  if (!f.name.trim()) errs.name = "Name is required";
  if (f.contact_number && !MOBILE_RE.test(f.contact_number))
    errs.contact_number = "Must be exactly 10 digits";
  if (f.secondary_mobile && !MOBILE_RE.test(f.secondary_mobile))
    errs.secondary_mobile = "Must be exactly 10 digits";
  if (f.pincode && !PINCODE_RE.test(f.pincode))
    errs.pincode = "Must be exactly 6 digits";
  if (f.mail_id && !EMAIL_RE.test(f.mail_id))
    errs.mail_id = "Enter a valid email address";
  return errs;
}

function toForm(c: Customer): FormState {
  const contract_type: ContractType =
    c.warranty_end_date ? "WTY" : c.contract_status === "AMC" ? "AMC" : "NIC";
  return {
    name: c.name ?? "",
    address: c.address ?? "",
    city: c.city ?? "",
    pincode: c.pincode ?? "",
    contact_person: c.contact_person ?? "",
    contact_number: c.contact_number ?? "",
    secondary_mobile: c.secondary_mobile ?? "",
    mail_id: c.mail_id ?? "",
    contract_type,
    warranty_start_date: c.warranty_start_date ?? "",
    warranty_end_date: c.warranty_end_date ?? "",
  };
}

export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [amcOnly, setAmcOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const load = (query?: string) => listCustomers(query).then(setCustomers);
  useEffect(() => { load(); }, []);

  const shown = amcOnly ? customers.filter((c) => c.is_amc) : customers;

  const doExport = async () => {
    setExporting(true);
    try {
      await exportCustomers({ q, amc_only: amcOnly });
    } finally {
      setExporting(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm(toForm(c));
    setErrors({});
    setModalOpen(true);
  };

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (form.contract_type === "WTY" && !form.warranty_end_date) {
      setBanner("Warranty end date is required for WTY.");
      return;
    }

    // Warranty dates only kept for WTY; contract status derives on the backend.
    const isWty = form.contract_type === "WTY";
    const payload = {
      name: form.name, address: form.address, city: form.city, pincode: form.pincode,
      contact_person: form.contact_person, contact_number: form.contact_number,
      secondary_mobile: form.secondary_mobile, mail_id: form.mail_id,
      warranty_start_date: isWty ? (form.warranty_start_date || null) : null,
      warranty_end_date: isWty ? (form.warranty_end_date || null) : null,
    };

    setSaving(true);
    setBanner(null);
    try {
      const saved = editing
        ? await updateCustomer(editing.id, payload)
        : await createCustomer(payload);
      setModalOpen(false);
      // AMC → take the user to PMS to create the work order for this customer.
      if (form.contract_type === "AMC") {
        navigate(`/pms?customer=${saved.id}`);
        return;
      }
      load(q);
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not save customer.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Customer) => {
    if (!window.confirm(`Delete customer "${c.name}"? This cannot be undone.`)) return;
    setBanner(null);
    try {
      await deleteCustomer(c.id);
      load(q);
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not delete customer.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={doExport} disabled={exporting}>
              {exporting ? "Exporting…" : "⬇ Export to Excel"}
            </Button>
            <Button onClick={openAdd}>+ Add customer</Button>
          </div>
        }
      />

      {banner && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {banner}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div className="max-w-sm flex-1">
          <Input
            placeholder="Search by name…"
            value={q}
            onChange={(e) => { setQ(e.target.value); load(e.target.value); }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={amcOnly} onChange={(e) => setAmcOnly(e.target.checked)} />
          AMC only
        </label>
      </div>

      <Table head={["Name", "City", "Contact person", "Primary mobile", "Email", ""]}>
        {shown.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-2 font-medium">
              <Link to={`/customers/${c.id}`} className="text-slate-800 hover:text-slate-900 hover:underline">
                {c.name}
              </Link>
              <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                CONTRACT_STYLE[c.contract_status ?? "NIC"]
              }`}>
                {c.contract_status ?? "NIC"}
              </span>
            </td>
            <td className="px-4 py-2">{c.city || "—"}</td>
            <td className="px-4 py-2">{c.contact_person || "—"}</td>
            <td className="px-4 py-2">{c.contact_number || "—"}</td>
            <td className="px-4 py-2">{c.mail_id || "—"}</td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              <button
                onClick={() => openEdit(c)}
                className="mr-3 text-xs font-medium text-slate-600 hover:underline"
              >
                Edit
              </button>
              <button
                onClick={() => remove(c)}
                className="text-xs font-medium text-rose-600 hover:underline"
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
        {shown.length === 0 && (
          <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No customers yet</td></tr>
        )}
      </Table>

      <Modal
        open={modalOpen}
        title={editing ? "Edit customer" : "Add customer"}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={submit} className="space-y-3">
          <FieldWithError label="Name *" error={errors.name}>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </FieldWithError>

          <Field label="Address">
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              rows={2}
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <FieldWithError label="Pincode" error={errors.pincode}>
              <Input
                value={form.pincode}
                inputMode="numeric"
                maxLength={6}
                onChange={(e) => set("pincode", e.target.value)}
              />
            </FieldWithError>
          </div>

          <Field label="Contact person name">
            <Input
              value={form.contact_person}
              onChange={(e) => set("contact_person", e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <FieldWithError label="Primary mobile no" error={errors.contact_number}>
              <Input
                value={form.contact_number}
                inputMode="numeric"
                maxLength={10}
                onChange={(e) => set("contact_number", e.target.value)}
              />
            </FieldWithError>
            <FieldWithError label="Secondary mobile no" error={errors.secondary_mobile}>
              <Input
                value={form.secondary_mobile}
                inputMode="numeric"
                maxLength={10}
                onChange={(e) => set("secondary_mobile", e.target.value)}
              />
            </FieldWithError>
          </div>

          <FieldWithError label="E-Mail ID" error={errors.mail_id}>
            <Input
              type="email"
              value={form.mail_id}
              onChange={(e) => set("mail_id", e.target.value)}
            />
          </FieldWithError>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <Field label="Contract type">
              <Select value={form.contract_type}
                onChange={(e) => set("contract_type", e.target.value as ContractType)}>
                <option value="WTY">WTY — Warranty</option>
                <option value="AMC">AMC — Annual Maintenance Contract</option>
                <option value="NIC">NIC — Not in Contract</option>
              </Select>
            </Field>
            {form.contract_type === "WTY" && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Warranty start">
                  <Input type="date" value={form.warranty_start_date}
                    onChange={(e) => set("warranty_start_date", e.target.value)} />
                </Field>
                <Field label="Warranty end *">
                  <Input type="date" value={form.warranty_end_date}
                    onChange={(e) => set("warranty_end_date", e.target.value)} />
                </Field>
              </div>
            )}
            {form.contract_type === "AMC" && (
              <p className="mt-2 text-xs text-indigo-700">
                On save you'll go to the PMS page to create this customer's work order.
                AMC status then follows the active work order.
              </p>
            )}
            {form.contract_type === "NIC" && (
              <p className="mt-2 text-xs text-slate-500">Not in contract — no warranty or AMC.</p>
            )}
          </div>

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

function FieldWithError({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Field label={label}>{children}</Field>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
