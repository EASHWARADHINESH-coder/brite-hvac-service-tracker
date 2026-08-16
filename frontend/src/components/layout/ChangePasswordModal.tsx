import { FormEvent, useState } from "react";

import { Button, Field, Input, Modal } from "../ui/primitives";
import { changeOwnPassword } from "../../api/services";

const MIN_LEN = 8;

/** Self-service password change. Rendered only for the Managing Director (locked decision Q3). */
export default function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent(""); setNext(""); setConfirm("");
    setError(null); setDone(false);
  };

  const close = () => { reset(); onClose(); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_LEN) { setError(`New password must be at least ${MIN_LEN} characters`); return; }
    if (next !== confirm) { setError("The two new passwords do not match"); return; }
    setSaving(true);
    try {
      await changeOwnPassword(current, next);
      setDone(true);
    } catch (err) {
      // Surface the server's reason (wrong current password, reused password, etc.).
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Could not change the password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Change password" onClose={close}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-emerald-700">
            Password changed. Use the new one next time you sign in.
          </p>
          <Button onClick={close}>Done</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password">
            <Input type="password" autoFocus value={current}
              onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label={`New password (min ${MIN_LEN} characters)`}>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || !current || !next || !confirm}>
              {saving ? "Saving…" : "Change password"}
            </Button>
            <Button variant="ghost" type="button" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
