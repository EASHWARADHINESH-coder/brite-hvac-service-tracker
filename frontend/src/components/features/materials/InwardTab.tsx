import { FormEvent, useEffect, useState } from "react";

import { Button, Card, Field, Input, Select, Table } from "../../ui/primitives";
import {
  createInward,
  listInward,
  listMaterials,
} from "../../../api/services";
import { INWARD_SOURCES } from "../../../types";
import type { MaterialInward, MaterialItem } from "../../../types";

const today = () => new Date().toISOString().slice(0, 10);

export default function InwardTab() {
  const [rows, setRows] = useState<MaterialInward[]>([]);
  const [catalog, setCatalog] = useState<MaterialItem[]>([]);
  const [form, setForm] = useState({
    source_type: INWARD_SOURCES[2], material_name: "", uom: "", qty: "",
    received_date: today(), supplier: "", doc_no: "",
  });

  const load = () => listInward().then(setRows);
  useEffect(() => { load(); listMaterials().then(setCatalog); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.material_name || !form.qty) return;
    await createInward({
      source_type: form.source_type,
      material_name: form.material_name,
      uom: form.uom || "Nos",
      qty: Number(form.qty),
      received_date: form.received_date,
      supplier: form.supplier || undefined,
      doc_no: form.doc_no || undefined,
    });
    setForm({ ...form, material_name: "", uom: "", qty: "", supplier: "", doc_no: "" });
    load();
  };

  return (
    <div>
      <Card className="mb-4">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Source">
            <Select value={form.source_type}
              onChange={(e) => setForm({ ...form, source_type: e.target.value as typeof form.source_type })}>
              {INWARD_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Material">
            <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.material_name}
              onChange={(e) => {
                const m = catalog.find((x) => x.name === e.target.value);
                setForm({ ...form, material_name: e.target.value, uom: m?.uom ?? "" });
              }}>
              <option value="">Select…</option>
              {catalog.map((m) => <option key={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Qty">
            <Input type="number" value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </Field>
          <Field label="Received date">
            <Input type="date" value={form.received_date}
              onChange={(e) => setForm({ ...form, received_date: e.target.value })} />
          </Field>
          <Field label="Supplier / source ref">
            <Input value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          </Field>
          <Field label="Doc no.">
            <Input value={form.doc_no}
              onChange={(e) => setForm({ ...form, doc_no: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Record inward</Button>
          </div>
        </form>
      </Card>

      <Table head={["Inward No.", "Date", "Source", "Material", "Qty", "UOM", "Supplier"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-2 font-mono">{r.inward_no}</td>
            <td className="px-4 py-2">{r.received_date}</td>
            <td className="px-4 py-2">{r.source_type}</td>
            <td className="px-4 py-2">{r.material_name}</td>
            <td className="px-4 py-2">{r.qty}</td>
            <td className="px-4 py-2">{r.uom}</td>
            <td className="px-4 py-2 text-slate-500">{r.supplier ?? "—"}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No inward records</td></tr>
        )}
      </Table>
    </div>
  );
}
