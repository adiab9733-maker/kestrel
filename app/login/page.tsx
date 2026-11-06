"use client";
import { useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) window.location.href = "/";
    else { setError("Wrong password"); setBusy(false); }
  }

  return (
    <main className="home" style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      <p className="lede">Enter the password you set for this Kestrel.</p>
      <form className="composer" onSubmit={submit}>
        <input
          type="password" placeholder="Password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password"
          style={{ width: "100%", border: 0, outline: "none", background: "transparent", color: "var(--text)", font: "inherit", fontSize: 16, padding: "6px 2px" }}
        />
        <div className="composer-row">
          <span className="hint" style={{ color: error ? "var(--err)" : undefined }}>{error ?? ""}</span>
          <button className="btn" disabled={busy || !password}>{busy ? "Checking…" : "Sign in"}</button>
        </div>
      </form>
    </main>
  );
}
