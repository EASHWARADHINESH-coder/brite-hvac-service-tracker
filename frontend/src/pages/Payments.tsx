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
import { useToast } from "../components/ui/Toast";
import { addPayment, addPaymentCorrection, getPaymentFollowUp } from "../api/services";
import { useAuth } from "../context/AuthContext";
import type { PaymentFollowUpRow } from "../types";

const today = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function Payments() {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<PaymentFollowUpRow[]>([]);
  const [pay, setPay] = useState<PaymentFollowUpRow | null>(null);
  const [amount, setAmount] = useState("");
  const [paidDate, setPaidDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  // Admin-only signed correction to the collected amount.
  const [correct, setCorrect] = useState<PaymentFollowUpRow | null>(null);
  const [corrAmount, setCorrAmount] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const [corrSaving, setCorrSaving] = useState(false);

  const doCorrect = async () => {
    if (!correct) return;
    const amt = Number(corrAmount);
    if (!amt) { toast.error("Enter a non-zero amount (use a minus sign to decrease)"); return; }
    if (!corrReason.trim()) { toast.error("A reason is required"); return; }
    setCorrSaving(true);
    try {
      await addPaymentCorrection(correct.ticket_id, { amount: amt, reason: corrReason.trim() });
      toast.success(`Correction applied (${amt > 0 ? "+" : ""}${amt})`);
      setCorrect(null);
      load();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Couldn't apply the correction", detail);
    } finally {
      setCorrSaving(false);
    }
  };

  const load = () => getPaymentFollowUp().then(setRows);
  useEffect(() => { load(); }, []);

  const openPay = (r: PaymentFollowUpRow) => {
    setPay(r);
    setAmount(String(r.balance));
    setPaidDate(today());
    setRemarks("");
  };

  const confirmPay = async () => {
    if (!pay) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    setSaving(true);
    try {
      const res = await addPayment(pay.ticket_id, { amount: amt, paid_date: paidDate, remarks: remarks || undefined });
      if (res.fully_paid) toast.success(`${pay.ticket_no} fully paid`);
      else toast.success(`Recorded ${inr(amt)} on ${pay.ticket_no}`, `Balance ${inr(res.balance)}`);
      setPay(null);
      load();
    } catch (err: any) {
      toast.error("Could not record payment", err?.response?.data?.detail);
    } finally {
      setSaving(false);
    }
  };

  const totalOutstanding = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <div>
      <PageHeader title="Payments — Repaired Service follow-up" />

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

      <Table head={["Ticket No.", "Customer", "Date", "Bill No.", "Bill Date", "Total", "Paid", "Balance", ""]}>
        {rows.map((r) => (
          <tr key={r.ticket_id}>
            <td className="px-4 py-2 font-mono font-medium">
              <Link to={`/tickets/${r.ticket_id}`} className="text-sky-600 hover:underline">
                {r.ticket_no}
              </Link>
            </td>
            <td className="px-4 py-2">{r.customer_name ?? "—"}</td>
            <td className="px-4 py-2 text-xs">{r.complaint_date}</td>
            <td className="px-4 py-2 text-xs">{r.bill_no ?? "—"}</td>
            <td className="px-4 py-2 text-xs">{r.bill_date ?? "—"}</td>
            <td className="px-4 py-2">{inr(r.total_amount)}</td>
            <td className="px-4 py-2 text-emerald-700">{inr(r.paid_amount)}</td>
            <td className="px-4 py-2 font-semibold text-rose-600">{inr(r.balance)}</td>
            <td className="px-4 py-2 text-right">
              <div className="flex justify-end gap-3">
                {isAdmin && (
                  <button onClick={() => { setCorrAmount(""); setCorrReason(""); setCorrect(r); }}
                    className="text-xs font-medium text-slate-500 hover:underline">
                    ± Correction
                  </button>
                )}
                <button onClick={() => openPay(r)}
                  className="text-xs font-medium text-slate-700 hover:underline">
                  Record payment →
                </button>
              </div>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-400">No outstanding payments 🎉</td></tr>
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

      <Modal
        open={!!correct}
        title={correct ? `Ledger correction — ${correct.ticket_no}` : ""}
        onClose={() => setCorrect(null)}
      >
        {correct && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {correct.customer_name} · Paid {inr(correct.paid_amount)} ·
              <span className="font-medium text-rose-600"> Balance {inr(correct.balance)}</span>
            </p>
            <Field label="Correction ₹ * (minus to decrease collected)">
              <Input type="number" value={corrAmount} autoFocus placeholder="e.g. 500 or -200"
                onChange={(e) => setCorrAmount(e.target.value)} />
            </Field>
            <Field label="Reason *">
              <Input value={corrReason} onChange={(e) => setCorrReason(e.target.value)}
                placeholder="Why is the collected amount being adjusted?" />
            </Field>
            <p className="text-xs text-slate-400">
              Records a signed adjustment in the ledger (Admin only). It doesn't change the agreed total.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setCorrect(null)}>Cancel</Button>
              <Button type="button" onClick={doCorrect} disabled={corrSaving}>
                {corrSaving ? "Saving…" : "Apply correction"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
