"use client";

import { useState } from "react";

import { createAuthBrowserClient } from "@/lib/supabase/auth-browser";
import { no } from "@/lib/locale/no";

// Sunday Account login for the turnering admin layer. Magic link + Google,
// against the ISSUER project (auth-browser client). On success the callback
// lands the session cookie scoped to .sundaysuite.app and redirects to /admin.
export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createAuthBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setSent(true);
    } catch {
      setError(no.admin.loginError);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setError(null);
    try {
      const supabase = createAuthBrowserClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
    } catch {
      setError(no.admin.loginError);
    }
  }

  return (
    <main className="center-screen">
      <div className="stack" style={{ maxWidth: 440, width: "100%" }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="brand" style={{ fontSize: "2rem" }}>
            {no.brand}
          </h1>
          <p className="faint">{no.admin.loginLede}</p>
        </div>

        <div className="card card-pad stack">
          {sent ? (
            <p>
              {no.admin.loginSentTo} <b>{email}</b> {no.admin.loginSentTail}
            </p>
          ) : (
            <form onSubmit={sendMagicLink} className="stack">
              <div className="field">
                <label className="label" htmlFor="email">
                  {no.admin.email}
                </label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="deg@menigheten.no"
                  autoComplete="email"
                />
              </div>
              {error && (
                <p className="faint" style={{ color: "#f0a6a0" }}>
                  {error}
                </p>
              )}
              <button className="btn btn-gold btn-block" disabled={busy}>
                {busy ? <span className="spin" /> : null}
                {busy ? no.admin.loginSending : no.admin.loginSend}
              </button>
            </form>
          )}
        </div>

        <button
          className="btn btn-ghost btn-block"
          onClick={signInWithGoogle}
          type="button"
        >
          {no.admin.loginGoogle}
        </button>
      </div>
    </main>
  );
}
