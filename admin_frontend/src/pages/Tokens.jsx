import { useState } from "react";
import { api } from "../services/api";
import { usePolling } from "../hooks/usePolling";
import { actions, useStore } from "../store/useStore";
import { fmtAgo, fmtTime, fmtWait, tokenCode } from "../utils/format";
import MagneticButton from "../components/MagneticButton";
import StatusBadge from "../components/StatusBadge";
import { Search } from "../components/Icons";

export default function Tokens() {
  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">Tokens</h1>
        <p className="page-subtitle">
          Look up a patient's token to check them in or put a no-show back in the queue, or register someone who
          is standing at the desk.
        </p>
      </header>

      <div className="tokens-grid">
        <FindToken />
        <RegisterAtDesk />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Find a token
// --------------------------------------------------------------------------- //
function FindToken() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [looking, setLooking] = useState(false);
  const [acting, setActing] = useState(false);

  async function lookup(publicId = input) {
    const id = publicId.trim();
    if (!id) return;
    setLooking(true);
    setError("");
    try {
      setResult({ ...(await api.tokenStatus(id)), lookedUpId: id });
    } catch (err) {
      setResult(null);
      setError(err.status === 404 ? "No token matches that ID. Check it and try again." : err.message);
    } finally {
      setLooking(false);
    }
  }

  async function act(fn, success) {
    setActing(true);
    try {
      await fn();
      actions.toast(success, "success");
      await lookup(result.lookedUpId);
    } catch (err) {
      actions.toast(err.message, "danger");
    } finally {
      setActing(false);
    }
  }

  const token = result?.token;
  const code = token ? tokenCode(token, result.department?.code) : null;
  const canCheckIn = token && token.queue_type === "virtual" && token.status === "waiting";
  const canReinstate = token && token.status === "no_show";

  return (
    <section className="card tool-card" aria-label="Find a token">
      <h2 className="subhead-title">Find a token</h2>
      <p className="subhead-desc">Scan the patient's QR with a handheld scanner, or paste the token ID.</p>

      <form
        className="lookup-form"
        onSubmit={(e) => {
          e.preventDefault();
          lookup();
        }}
      >
        <div className="search-field-wrap lookup-field">
          <Search className="search-icon" />
          <input
            className="search-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Token ID"
            aria-label="Token ID"
            autoComplete="off"
            spellCheck="false"
            autoFocus
          />
        </div>
        <MagneticButton type="submit" className="btn btn-primary" disabled={looking || !input.trim()}>
          {looking ? "Looking..." : "Look up"}
        </MagneticButton>
      </form>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {result && token && (
        <div className="token-result">
          <div className="token-result-top">
            <span className="token-result-code mono">{code}</span>
            <StatusBadge token={token} large />
          </div>
          <p className="token-result-where">
            {result.department?.name}
            {result.hospital?.name ? `, ${result.hospital.name}` : ""}
          </p>

          <dl className="facts">
            <div>
              <dt>Queue</dt>
              <dd>{token.queue_type === "physical" ? "On site" : "Booked, not arrived"}</dd>
            </div>
            <div>
              <dt>Position</dt>
              <dd>{result.position ?? "-"}</dd>
            </div>
            <div>
              <dt>Estimated wait</dt>
              <dd>{fmtWait(result.estimated_wait_minutes)}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{fmtAgo(token.issued_at)}</dd>
            </div>
            {token.report_by_at && (
              <div>
                <dt>Should arrive by</dt>
                <dd>{fmtTime(token.report_by_at)}</dd>
              </div>
            )}
            {token.report_deadline_at && (
              <div>
                <dt>Lapses at</dt>
                <dd>{fmtTime(token.report_deadline_at)}</dd>
              </div>
            )}
          </dl>

          {result.next_action && <p className="token-result-note">{result.next_action}</p>}

          {(canCheckIn || canReinstate) && (
            <div className="token-result-actions">
              {canCheckIn && (
                <MagneticButton
                  className="btn btn-primary"
                  disabled={acting}
                  onClick={() =>
                    act(() => api.checkInScan(token.public_id ?? result.lookedUpId), `${code} checked in.`)
                  }
                >
                  {acting ? "Checking in..." : "Check in patient"}
                </MagneticButton>
              )}
              {canReinstate && (
                <MagneticButton
                  className="btn btn-primary"
                  disabled={acting || token.id === undefined}
                  onClick={() => act(() => api.reinstate(token.id), `${code} is back in the queue.`)}
                >
                  {acting ? "Working..." : "Put back in queue"}
                </MagneticButton>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Register at the desk
// --------------------------------------------------------------------------- //
const PRIORITIES = [
  { value: 2, label: "Normal" },
  { value: 1, label: "Priority", hint: "Seniors, pregnant patients, people with disabilities." },
  { value: 0, label: "Emergency", hint: "Called before everyone else, and raises an alert for the whole hospital." },
];

function RegisterAtDesk() {
  const storedDeptId = useStore((s) => s.deptId);
  const depts = usePolling(api.departments, { interval: 60000 });
  const departments = depts.data ?? [];

  const [pickedDept, setPickedDept] = useState("");
  const deptId = pickedDept || (departments.some((d) => d.id === storedDeptId) ? String(storedDeptId) : departments[0] ? String(departments[0].id) : "");

  const [priority, setPriority] = useState(2);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState(null);

  const ready = deptId && fullName.trim() && phone.trim();
  const hint = PRIORITIES.find((p) => p.value === priority)?.hint;

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const token = await api.registerAtDesk({
        department_id: Number(deptId),
        priority,
        reason: reason.trim() || null,
        full_name: fullName.trim(),
        phone: phone.trim(),
      });
      const dept = departments.find((d) => String(d.id) === deptId);
      const code = tokenCode(token, dept?.code);
      setIssued({ code, department: dept?.name, wait: token.predicted_wait_minutes, emergency: priority === 0 });
      actions.toast(`${code} issued.`, "success");
      setFullName("");
      setPhone("");
      setReason("");
      setPriority(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card tool-card" aria-label="Register at the desk">
      <h2 className="subhead-title">Register at the desk</h2>
      <p className="subhead-desc">
        The patient goes straight into the on-site queue. If their phone number is already on file, their record is reused.
      </p>

      <form onSubmit={submit} noValidate>
        <div className="form-field form-gap">
          <label className="field-label" htmlFor="reg-dept">
            Department
          </label>
          <select id="reg-dept" value={deptId} onChange={(e) => setPickedDept(e.target.value)}>
            {departments.length === 0 && <option value="">{depts.loading ? "Loading..." : "No departments"}</option>}
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {depts.error && (
            <span className="field-hint">
              Couldn't load departments. {depts.error.status === 404 ? "See the notes at the top of src/services/api.js." : depts.error.message}
            </span>
          )}
        </div>

        <div className="form-field form-gap">
          <span className="field-label" id="priority-label">
            Priority
          </span>
          <div className="filter-buttons" role="radiogroup" aria-labelledby="priority-label">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={priority === p.value}
                className={`filter-pill${priority === p.value ? " active" : ""}${p.value === 0 ? " pill-danger" : ""}`}
                onClick={() => setPriority(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {hint && <span className="field-hint">{hint}</span>}
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="field-label" htmlFor="reg-name">
              Full name <span className="req">*</span>
            </label>
            <input id="reg-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="reg-phone">
              Phone <span className="req">*</span>
            </label>
            <input
              id="reg-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="form-field form-gap">
          <label className="field-label" htmlFor="reg-reason">
            Reason for visit
          </label>
          <input
            id="reg-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Symptoms or purpose, optional"
            autoComplete="off"
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <MagneticButton
          type="submit"
          className={`btn btn-lg ${priority === 0 ? "btn-danger" : "btn-primary"}`}
          disabled={!ready || busy}
        >
          {busy ? "Registering..." : priority === 0 ? "Register emergency" : "Register patient"}
        </MagneticButton>
      </form>

      {issued && (
        <div className={`token-result issued${issued.emergency ? " is-emergency" : ""}`} role="status">
          <span className="token-result-code mono">{issued.code}</span>
          <p className="token-result-note">
            {issued.department ? `${issued.department}. ` : ""}
            {issued.emergency
              ? "Emergency patient. They'll be called next."
              : issued.wait !== null && issued.wait !== undefined
                ? `Estimated wait ${fmtWait(issued.wait)}.`
                : "They're in the on-site queue."}
          </p>
        </div>
      )}
    </section>
  );
}
