import { useState } from "react";
import { api } from "../services/api";
import { actions } from "../store/useStore";
import MagneticButton from "../components/MagneticButton";
import { QueueGlyph } from "../components/Icons";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { token, staff } = await api.login(email.trim(), password);
      actions.setSession(token, staff);
      window.location.hash = "#/";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={submit} noValidate>
        <div className="brand-wrap login-brand">
          <span className="brand-symbol">
            <QueueGlyph />
          </span>
          <div className="brand-text-col">
            <span className="brand-title">Queue</span>
            <span className="brand-subtitle">Staff console</span>
          </div>
        </div>

        <h1 className="login-title">Sign in</h1>
        <p className="login-lead">Use the email and password your hospital admin gave you.</p>

        <div className="form-field">
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <MagneticButton
          type="submit"
          className="btn btn-primary btn-lg btn-full"
          disabled={busy || !email || !password}
        >
          {busy ? "Signing in..." : "Sign in"}
        </MagneticButton>

        {import.meta.env.DEV && (
          <p className="field-hint login-dev-hint">
            Dev seed accounts: admin.citygeneral@queue.local or admin.lifeline@queue.local, password
            ChangeMe123!
          </p>
        )}
      </form>
    </main>
  );
}
