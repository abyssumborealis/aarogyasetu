import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { usePolling } from "../hooks/usePolling";
import { actions, useStore } from "../store/useStore";
import { fmtAgo, fmtTime, parseDate, tokenCode } from "../utils/format";
import MagneticButton from "../components/MagneticButton";
import ConfirmDialog from "../components/ConfirmDialog";
import PriorityTag from "../components/PriorityTag";
import StatusBadge from "../components/StatusBadge";
import { Bell, Pulse } from "../components/Icons";

const QUEUE_POLL_MS = 5000;

function missingEndpointHint(err) {
  return err?.status === 404
    ? "The API doesn't have this endpoint yet. See the notes at the top of src/services/api.js."
    : null;
}

export default function StaffQueue() {
  const storedDeptId = useStore((s) => s.deptId);

  const depts = usePolling(api.departments, { interval: 60000 });
  const departments = depts.data ?? [];

  // Fall back to the first department when nothing (or something stale) is selected
  const deptId = departments.some((d) => d.id === storedDeptId) ? storedDeptId : departments[0]?.id ?? null;
  useEffect(() => {
    if (deptId !== null && deptId !== storedDeptId) actions.setDeptId(deptId);
  }, [deptId, storedDeptId]);

  const department = departments.find((d) => d.id === deptId) ?? null;

  const queue = usePolling(() => api.departmentQueue(deptId), {
    interval: QUEUE_POLL_MS,
    enabled: deptId !== null,
    deps: [deptId],
  });
  const doctors = usePolling(() => api.doctors(deptId), {
    interval: 30000,
    enabled: deptId !== null,
    deps: [deptId],
  });

  const q = queue.data;
  const doctorList = doctors.data ?? [];
  const busyDoctorIds = useMemo(
    () => new Set((q?.inProgress ?? []).map((t) => t.doctor_id).filter(Boolean)),
    [q]
  );

  // Doctor picker: keep the choice while it's still valid, otherwise pick a free available doctor
  const [doctorId, setDoctorId] = useState("");
  useEffect(() => setDoctorId(""), [deptId]);
  useEffect(() => {
    if (doctors.error) return; // manual doctor ID mode
    const valid = doctorList.some(
      (d) => String(d.id) === String(doctorId) && d.status === "available" && !busyDoctorIds.has(d.id)
    );
    if (!valid) {
      const free = doctorList.find((d) => d.status === "available" && !busyDoctorIds.has(d.id));
      setDoctorId(free ? String(free.id) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorList.length, busyDoctorIds, doctors.error]);

  const [busy, setBusy] = useState(null);
  const [confirmAbsent, setConfirmAbsent] = useState(null);

  async function run(key, fn, success) {
    setBusy(key);
    try {
      const result = await fn();
      if (success) actions.toast(typeof success === "function" ? success(result) : success, "success");
      return result;
    } catch (err) {
      actions.toast(err.message, "danger");
      return null;
    } finally {
      setBusy(null);
      queue.refresh(); // state may have moved under us (another doctor, another desk)
    }
  }

  const codeOf = (t) => tokenCode(t, department?.code);
  const next = q?.physical[0] ?? null;
  const canCall = !!doctorId && !!next && !busy;

  const callNext = () =>
    run("call", () => api.callNext(deptId, Number(doctorId)), (t) => `Called ${codeOf(t)}. They've been notified.`);

  const doctorName = (id) => doctorList.find((d) => d.id === id)?.full_name;

  async function confirmAbsentNow() {
    const token = confirmAbsent;
    await run(
      `absent-${token.id}`,
      () => api.markAbsent(token.id),
      (r) =>
        r.outcome === "requeued"
          ? `${codeOf(token)} moved to the back of the queue.`
          : `${codeOf(token)} closed as no-show.`
    );
    setConfirmAbsent(null); // on failure the toast explains why; the queue refresh shows the real state
  }

  // ---------------------------------------------------------------- render ----
  if (depts.error && !depts.data) {
    return (
      <div className="page-container">
        <div className="high-priority-alert-banner alert-noshow" role="alert">
          <div>
            <div className="alert-headline">Couldn't load departments</div>
            <div className="alert-message">
              {depts.error.message} {missingEndpointHint(depts.error)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header page-header-row">
        <div>
          <h1 className="page-title">{department ? department.name : "Staff queue"}</h1>
          <p className="page-subtitle">
            {q
              ? `${q.counts.physicalWaiting} waiting on site, ${q.counts.virtualWaiting} booked and on the way, ${q.counts.inProgress} with a doctor.`
              : "Loading the queue..."}
          </p>
        </div>
        {queue.updatedAt && (
          <span className="live-pulse-badge">
            <span className="pulse-dot" />
            Live, updates every {QUEUE_POLL_MS / 1000} seconds
          </span>
        )}
      </header>

      {departments.length > 1 && (
        <div className="filter-buttons dept-picker" role="tablist" aria-label="Department">
          {departments.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={d.id === deptId}
              className={`filter-pill${d.id === deptId ? " active" : ""}`}
              onClick={() => actions.setDeptId(d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {queue.error && (
        <div className="high-priority-alert-banner alert-noshow" role="alert">
          <div>
            <div className="alert-headline">Couldn't refresh this queue</div>
            <div className="alert-message">{queue.error.message}</div>
          </div>
        </div>
      )}

      {/* ---- call next ---- */}
      <section className="card call-bar" aria-label="Call the next patient">
        <div className="call-bar-info">
          <span className="section-label">Next in line</span>
          {next ? (
            <p className="call-bar-next">
              <strong className="mono">{codeOf(next)}</strong>
              {next.patient_name && <span>{next.patient_name}</span>}
              <PriorityTag priority={next.priority} />
              {next.reason && <span className="muted">{next.reason}</span>}
            </p>
          ) : (
            <p className="call-bar-next muted">No one is waiting on site. Booked patients appear here once they check in.</p>
          )}
        </div>

        <div className="call-bar-controls">
          <div className="form-field">
            <label className="field-label" htmlFor="doctor">
              Calling for
            </label>
            {doctors.error ? (
              <input
                id="doctor"
                type="number"
                min="1"
                placeholder="Doctor ID"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
              />
            ) : (
              <select id="doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="" disabled>
                  {doctors.loading ? "Loading doctors..." : "Choose a doctor"}
                </option>
                {doctorList.map((d) => {
                  const withPatient = busyDoctorIds.has(d.id);
                  const unavailable = d.status !== "available";
                  return (
                    <option key={d.id} value={d.id} disabled={unavailable || withPatient}>
                      {d.full_name}
                      {unavailable ? ` (${d.status.replace(/_/g, " ")})` : withPatient ? " (with a patient)" : ""}
                    </option>
                  );
                })}
              </select>
            )}
            {doctors.error && (
              <span className="field-hint">
                Couldn't load doctors. {missingEndpointHint(doctors.error) ?? "Enter the doctor's ID instead."}
              </span>
            )}
          </div>

          <MagneticButton className="btn btn-primary btn-lg" onClick={callNext} disabled={!canCall}>
            {busy === "call" ? "Calling..." : "Call next patient"}
          </MagneticButton>
        </div>
      </section>

      {/* ---- being served ---- */}
      {q && q.inProgress.length > 0 && (
        <section className="serving-section" aria-label="Being served">
          <h2 className="subhead-title">With a doctor</h2>
          <div className="serving-list">
            {q.inProgress.map((t) => {
              const called = t.status === "called";
              return (
                <div
                  key={t.id}
                  className={`high-priority-alert-banner ${called ? "alert-called" : "alert-consultation"}`}
                >
                  <span className={called ? "bell-ring" : "pulse-icon"}>
                    {called ? <Bell width={28} height={28} /> : <Pulse width={28} height={28} />}
                  </span>
                  <div>
                    <div className="alert-headline">
                      <span className="mono">{codeOf(t)}</span>
                      {t.patient_name ? `, ${t.patient_name}` : ""}
                    </div>
                    <div className="alert-message">
                      {called
                        ? `Called ${fmtAgo(t.called_at)}${doctorName(t.doctor_id) ? ` for ${doctorName(t.doctor_id)}` : ""}. Waiting for them to reach the room.`
                        : `In consultation since ${fmtTime(t.consultation_started_at)}${doctorName(t.doctor_id) ? ` with ${doctorName(t.doctor_id)}` : ""}.`}
                    </div>
                  </div>
                  <div className="alert-action row-actions">
                    {called ? (
                      <>
                        <button
                          className="btn btn-outline-danger btn-sm"
                          disabled={!!busy}
                          onClick={() => setConfirmAbsent(t)}
                        >
                          Patient is absent
                        </button>
                        <MagneticButton
                          className="btn btn-primary btn-sm"
                          disabled={!!busy}
                          onClick={() => run(`start-${t.id}`, () => api.startConsultation(t.id), `${codeOf(t)} is with the doctor.`)}
                        >
                          {busy === `start-${t.id}` ? "Starting..." : "Start consultation"}
                        </MagneticButton>
                      </>
                    ) : (
                      <MagneticButton
                        className="btn btn-emerald btn-sm"
                        disabled={!!busy}
                        onClick={() => run(`done-${t.id}`, () => api.completeConsultation(t.id), `${codeOf(t)} completed.`)}
                      >
                        {busy === `done-${t.id}` ? "Completing..." : "Complete"}
                      </MagneticButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- the two queues ---- */}
      <div className="queues-grid">
        <section className="queue-panel" aria-label="Waiting on site">
          <div className="section-subhead-row">
            <div>
              <h2 className="subhead-title">Waiting on site</h2>
              <p className="subhead-desc">In serving order: emergency first, then priority, then arrival time.</p>
            </div>
            <span className="count-pill">{q?.counts.physicalWaiting ?? 0}</span>
          </div>

          {q && q.physical.length === 0 && <p className="empty-note">No one is waiting on site.</p>}
          <ol className="q-list">
            {(q?.physical ?? []).map((t, i) => (
              <li key={t.id} className={`q-row${t.priority === 0 ? " is-emergency" : ""}`}>
                <span className="q-pos">{i + 1}</span>
                <div className="q-main">
                  <div className="q-title">
                    <strong className="mono">{codeOf(t)}</strong>
                    <span>{t.patient_name}</span>
                    <PriorityTag priority={t.priority} />
                    {t.absence_count > 0 && <span className="priority-tag priority-priority">Missed a call</span>}
                  </div>
                  <div className="q-meta">
                    Checked in {fmtAgo(t.checked_in_at)}
                    {t.reason ? `. ${t.reason}` : ""}
                  </div>
                </div>
                <StatusBadge token={t} />
              </li>
            ))}
          </ol>
        </section>

        <section className="queue-panel" aria-label="Booked, not arrived">
          <div className="section-subhead-row">
            <div>
              <h2 className="subhead-title">Booked, not arrived</h2>
              <p className="subhead-desc">They can't be called until they check in.</p>
            </div>
            <span className="count-pill">{q?.counts.virtualWaiting ?? 0}</span>
          </div>

          {q && q.virtual.length === 0 && <p className="empty-note">No booked patients are on their way.</p>}
          <ol className="q-list">
            {(q?.virtual ?? []).map((t, i) => {
              const due = parseDate(t.report_by_at) && parseDate(t.report_by_at).getTime() <= Date.now();
              return (
                <li key={t.id} className="q-row">
                  <span className="q-pos">{i + 1}</span>
                  <div className="q-main">
                    <div className="q-title">
                      <strong className="mono">{codeOf(t)}</strong>
                      <span>{t.patient_name}</span>
                      {due && <span className="priority-tag priority-priority">Due now</span>}
                    </div>
                    <div className="q-meta">
                      {t.report_by_at
                        ? `Should arrive by ${fmtTime(t.report_by_at)}. Token lapses at ${fmtTime(t.report_deadline_at)}.`
                        : `Booked ${fmtAgo(t.issued_at)}.`}
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary btn-xs"
                    disabled={!!busy}
                    onClick={() =>
                      run(`in-${t.id}`, () => api.checkInManual(t.id), `${codeOf(t)} checked in. They're now on the on-site queue.`)
                    }
                  >
                    {busy === `in-${t.id}` ? "Checking in..." : "Mark arrived"}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      {confirmAbsent && (
        <ConfirmDialog
          title={`Mark ${codeOf(confirmAbsent)} as absent?`}
          confirmLabel="Mark absent"
          danger
          busy={busy === `absent-${confirmAbsent.id}`}
          onConfirm={confirmAbsentNow}
          onCancel={() => setConfirmAbsent(null)}
        >
          <p className="modal-subtext">
            {confirmAbsent.patient_name ? `${confirmAbsent.patient_name} didn't reach the doctor. ` : ""}
            They'll go to the back of the on-site queue. If they've already missed a call, the token closes as a
            no-show instead. You can put a no-show back from the Tokens page.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

