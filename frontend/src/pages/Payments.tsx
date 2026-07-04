import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  Table,
} from "../components/ui/primitives";
import { addPayment, getPaymentFollowUp } from "../api/services";
import type { PaymentFollowUpRow } from "../types";

const today = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function Payments() {
  const [rows, setRows] = useState<PaymentFollowUpRow[]>([]);
  const [pay, setPay] = useState<PaymentFollowUpRow | null>(null);
  const [amount, setAmount] = useState("");
  const [paidDate, setPaidDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const load = () => getPaymentFollowUp().then(setRows);
  useEffect(() => { load(); }, []);

  const openPay = (r: PaymentFollowUpRow) => {
    setPay(r);
    setAmount(String(r.balance));
    setPaidDate(today());
    setRemarks("");
    setBanner(null);
  };

  const confirmPay = async () => {
    if (!pay) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) { setBanner("Enter a valid amount."); return; }
    setSaving(true);
    setBanner(null);
    try {
      const res = await addPayment(pay.ticket_id, { amount: amt, paid_date: paidDate, remarks: remarks || undefined });
      setBanner(
        res.fully_paid
          ? `${pay.ticket_no} fully paid ✓`
          : `Recorded ${inr(amt)} on ${pay.ticket_no}. Balance ${inr(res.balance)}.`,
      );
      setPay(null);
      load();
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not record payment.");
    } finally {
      setSaving(false);
    }
  };

  const totalOutstanding = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <div>
      <PageHeader title="Payments — Repaired Service follow-up" />

      {banner && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          {banner}
        </div>
      )}

      <div className="mb-4 flex gap-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Outstanding tickets</div>
          <div className="text-2xl font-bold text-slate-800">{rows.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Total outstanding</div>
          <div className="text-2xl font-bold text-rose-600">{inr(totalOutstanding)}</div>
        </div>
      </div>

      <Table head={["Ticket No.", "Customer", "Date", "Total", "Paid", "Balance", ""]}>
        {rows.map((r) => (
          <tr key={r.ticket_id}>
            <td className="px-4 py-2 font-mono font-medium">
              <Link to={`/tickets/${r.ticket_id}`} className="text-sky-600 hover:underline">
                {r.ticket_no}
              </Link>
            </td>
            <td className="px-4 py-2">{r.customer_name ?? "—"}</td>
            <td className="px-4 py-2 text-xs">{r.complaint_date}</td>
            <td className="px-4 py-2">{inr(r.total_amount)}</td>
            <td className="px-4 py-2 text-emerald-700">{inr(r.paid_amount)}</td>
            <td className="px-4 py-2 font-semibold text-rose-600">{inr(r.balance)}</td>
            <td className="px-4 py-2 text-right">
              <button onClick={() => openPay(r)}
                className="text-xs font-medium text-slate-700 hover:underline">
                Record payment →
              </button>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No outstanding payments 🎉</td></tr>
        )}
      </Table>

      <Modal
        open={!!pay}
        title={pay ? `Record payment — ${pay.ticket_no}` : ""}
        onClose={() => setPay(null)}
      >
        {pay && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {pay.customer_name} · Total {inr(pay.total_amount)} · Paid {inr(pay.paid_amount)} ·
              <span className="font-medium text-rose-600"> Balance {inr(pay.balance)}</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount ₹ *">
                <Input type="number" min={0} value={amount}
                  onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Date">
                <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Remarks">
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setPay(null)}>Cancel</Button>
              <Button type="button" onClick={confirmPay} disabled={saving}>
                {saving ? "Saving…" : "Record"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
