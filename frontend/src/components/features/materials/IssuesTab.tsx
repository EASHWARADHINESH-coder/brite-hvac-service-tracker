import { FormEvent, useEffect, useState } from "react";

import { Button, Card, Field, Input, Table } from "../../ui/primitives";
import {
  allocateIssue,
  deliverIssue,
  listIssues,
  listMaterials,
  listTickets,
} from "../../../api/services";
import type { MaterialIssue, MaterialItem, Ticket } from "../../../types";

const today = () => new Date().toISOString().slice(0, 10);

export default function IssuesTab() {
  const [rows, setRows] = useState<MaterialIssue[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [catalog, setCatalog] = useState<MaterialItem[]>([]);
  const [form, setForm] = useState({
    ticket_id: "", material_name: "", uom: "", qty: "", issue_date: today(), customer_site: "",
  });

  const load = () => listIssues().then(setRows);
  useEffect(() => {
    load();
    listTickets().then(setTickets);
    listMaterials().then(setCatalog);
  }, []);

  const ticketNo = (id: number) => tickets.find((t) => t.id === id)?.ticket_no ?? id;

  const allocate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.ticket_id || !form.material_name || !form.qty) return;
    await allocateIssue({
      ticket_id: Number(form.ticket_id),
      material_name: form.material_name,
      uom: form.uom || "Nos",
      qty: Number(form.qty),
      issue_date: form.issue_date,
      customer_site: form.customer_site || undefined,
    });
    setForm({ ...form, material_name: "", uom: "", qty: "", customer_site: "" });
    load();
  };

  const deliver = async (id: number, outcome: "Used" | "Not Used") => {
    await deliverIssue(id, outcome);
    load();
  };

  return (
    <div>
      <Card className="mb-4">
        <h3 className="mb-3 font-semibold text-slate-700">Allocate material to a ticket</h3>
        <form onSubmit={allocate} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Ticket">
            <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.ticket_id}
              onChange={(e) => setForm({ ...form, ticket_id: e.target.value })}>
              <option value="">Select…</option>
              {tickets.map((t) => <option key={t.id} value={t.id}>{t.ticket_no}</option>)}
            </select>
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
          <Field label="Customer / site">
            <Input value={form.customer_site}
              onChange={(e) => setForm({ ...form, customer_site: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Allocate</Button>
          </div>
        </form>
      </Card>

      <Table head={["Issue No.", "Ticket", "Material", "Qty", "Status", "Outcome", "Delivery Note", ""]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-2 font-mono">{r.issue_no}</td>
            <td className="px-4 py-2 font-mono">{ticketNo(r.ticket_id)}</td>
            <td className="px-4 py-2">{r.material_name}</td>
            <td className="px-4 py-2">{r.qty} {r.uom}</td>
            <td className="px-4 py-2">{r.status}</td>
            <td className="px-4 py-2">{r.outcome ?? "—"}</td>
            <td className="px-4 py-2 font-mono text-xs">{r.delivery_note_no ?? "—"}</td>
            <td className="px-4 py-2 text-right">
              {r.status === "Allocated" && (
                <span className="space-x-2">
                  <button onClick={() => deliver(r.id, "Used")}
                    className="text-xs text-emerald-700 hover:underline">Used</button>
                  <button onClick={() => deliver(r.id, "Not Used")}
                    className="text-xs text-slate-500 hover:underline">Not used</button>
                </span>
              )}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">No allocations</td></tr>
        )}
      </Table>
    </div>
  );
}
