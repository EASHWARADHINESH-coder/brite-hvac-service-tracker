import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Field, Input } from "../components/ui/primitives";
import Logo from "../components/ui/Logo";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      nav("/");
    } catch {
      setError("Incorrect username or password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo markClassName="h-12 w-12 text-2xl" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-lg font-bold text-slate-800">Welcome back</h1>
          <p className="mb-6 text-sm text-slate-400">Sign in to continue</p>
          <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">brite engineers · AI Service Tracker</p>
      </div>
    </div>
  );
}
