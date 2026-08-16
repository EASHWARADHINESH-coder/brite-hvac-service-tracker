import { useEffect, useState } from "react";

import { Button, Combobox, Field, Modal } from "../ui/primitives";
import { useToast } from "../ui/Toast";
import { editTicket, listComplaints, listCustomers } from "../../api/services";
import { WORK_TYPES } from "../../types";
import type { Complaint, Customer, TicketDetail, WorkType } from "../../types";

/**
 * Edit a ticket's core fields after creation (Admin/Engineer).
 * Changing the work type re-prefixes the ticket number on the server.
 */
export default function EditTicketModal({
  ticket,
  open,
  onClose,
  onSaved,
}: {
  ticket: TicketDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (t: TicketDetail) => void;
}) {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [customerId, setCustomerId] = useState(String(ticket.customer_id));
  const [workType, setWorkType] = useState<WorkType>(ticket.work_type);
  const [complaint, setComplaint] = useState(ticket.primary_complaint ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    listCustomers().then(setCustomers).catch(() => setCustomers([]));
    listComplaints().then(setComplaints).catch(() => setComplaints([]));
    setCustomerId(String(ticket.customer_id));
    setWorkType(ticket.work_type);
    setComplaint(ticket.primary_complaint ?? "");
  }, [open, ticket]);

  const save = async () => {
    setSaving(true);
    try {
      const payload: { customer_id?: number; work_type?: WorkType; primary_complaint?: string | null } = {};
      if (Number(customerId) !== ticket.customer_id) payload.customer_id = Number(customerId);
      if (workType !== ticket.work_type) payload.work_type = workType;
      if (complaint !== (ticket.primary_complaint ?? "")) payload.primary_complaint = complaint || null;

      if (Object.keys(payload).length === 0) {
        toast.info("Nothing changed");
        onClose();
        return;
      }
      const updated = await editTicket(ticket.id, payload);
      toast.success("Ticket updated", updated.ticket_no !== ticket.ticket_no
        ? `Renumbered to ${updated.ticket_no}` : undefined);
      onSaved(updated);
      onClose();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Couldn't update the ticket", detail);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={`Edit ${ticket.ticket_no}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Customer">
          <Combobox
            placeholder="Search customer…"
            value={customerId}
            onChange={setCustomerId}
            options={customers.map((c) => ({ value: String(c.id), label: c.name, hint: c.city || undefined }))}
          />
        </Field>
        <Field label="Work type">
          <Combobox
            allowClear={false}
            value={workType}
            onChange={(v) => setWorkType(v as WorkType)}
            options={WORK_TYPES.map((w) => ({ value: w, label: w }))}
          />
        </Field>
        <Field label="Primary complaint">
          <Combobox
            placeholder="None"
            value={complaint}
            onChange={setComplaint}
            options={complaints.map((c) => ({ value: c.name, label: c.name, hint: c.complaint_type }))}
          />
        </Field>
        <p className="text-xs text-slate-400">
          Changing the work type re-prefixes the ticket number (date and sequence stay the same).
          Every edit is logged.
        </p>
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
