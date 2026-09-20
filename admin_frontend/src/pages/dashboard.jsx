import { api } from "../services/api";
import { usePolling } from "../hooks/usePolling";
import { actions } from "../store/useStore";
import { fmtToday } from "../utils/format";
import TiltCard from "../components/TiltCard";
import MagneticButton from "../components/MagneticButton";
import PriorityTag from "../components/PriorityTag";
import { Alert } from "../components/Icons";

const POLL_MS = 10000;

/** One request for the department list, then one per department. A failed department doesn't sink the page. */
async function loadOverview() {
  const departments = await api.departments();
  const settled = await Promise.allSettled(departments.map((d) => api.departmentQueue(d.id)));
  return departments.map((department, i) => ({
    department,
    queue: settled[i].status === "fulfilled" ? settled[i].value : null,
    error: settled[i].status === "rejected" ? settled[i].reason : null,
  }));
}

function openQueue(deptId) {
  actions.setDeptId(deptId);
  window.location.hash = "#/queue";
}

export default function Dashboard() {
  const { data, error, loading, updatedAt } = usePolling(loadOverview, { interval: POLL_MS });

  const loaded = (data ?? []).filter((r) => r.queue);
  const totals = loaded.reduce(
    (t, { queue }) => ({
      onSite: t.onSite + queue.counts.physicalWaiting,
      booked: t.booked + queue.counts.virtualWaiting,
      withDoctor: t.withDoctor + queue.counts.inProgress,
      doctors: t.doctors + queue.counts.doctorsAvailable,
    }),
    { onSite: 0, booked: 0, withDoctor: 0, doctors: 0 }
  );

  const emergencies = loaded.flatMap(({ department, queue }) =>
    queue.physical.filter((t) => t.priority === 0).map((t) => ({ department, token: t }))
  );

  return (
    <div className="page-container">
      <header className="page-header page-header-row">
        <div>
          <h1 className="page-title">Today's queues</h1>
          <p className="page-subtitle">
            {fmtToday()}.{" "}
            {updatedAt ? `Updated ${updatedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}.` : "Loading..."}
          </p>
        </div>
        <span className="live-pulse-badge">
          <span className="pulse-dot" />
          Refreshes every {POLL_MS / 1000} seconds
        </span>
      </header>

      {error && !data && (
        <div className="high-priority-alert-banner alert-noshow" role="alert">
          <Alert width={28} height={28} />
          <div>
            <div className="alert-headline">Couldn't load the queues</div>
            <div className="alert-message">{error.message}</div>
          </div>
        </div>
      )}

      {emergencies.map(({ department, token }) => (
        <div key={token.id} className="high-priority-alert-banner alert-noshow" role="alert">
          <Alert width={28} height={28} />
          <div>
            <div className="alert-headline">
              Emergency in {department.name}: {token.code}
            </div>
            <div className="alert-message">
              {token.patient_name ? `${token.patient_name}. ` : ""}
              {token.reason || "No reason recorded."}
            </div>
          </div>
          <MagneticButton
            className="btn btn-danger btn-sm alert-action"
            onClick={() => openQueue(department.id)}
          >
            Open queue
          </MagneticButton>
        </div>
      ))}

      <section className="kpi-telemetry-bar" aria-label="Totals across all departments">
        <Kpi label="Waiting on site" value={totals.onSite} note="Checked in, can be called" loading={loading} />
        <Kpi label="Booked, not arrived" value={totals.booked} note="Virtual queue" loading={loading} />
        <Kpi label="With a doctor" value={totals.withDoctor} note="Called or in consultation" loading={loading} />
        <Kpi label="Doctors available" value={totals.doctors} note="Not on break or off duty" loading={loading} />
      </section>

      <section className="overview-section">
        <div className="section-subhead-row">
          <div>
            <h2 className="subhead-title">Departments</h2>
            <p className="subhead-desc">Open a department to call patients and manage its queue.</p>
          </div>
        </div>

        {loading && !data && (
          <div className="departments-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="department-card skeleton-card" aria-hidden="true" />
            ))}
          </div>
        )}

        {data && data.length === 0 && (
          <div className="empty-state">
            <h3>No departments yet</h3>
            <p>Add departments for this hospital and they'll show up here with live counts.</p>
          </div>
        )}

        <div className="departments-grid">
          {(data ?? []).map(({ department, queue, error: deptError }) => (
            <DepartmentCard key={department.id} department={department} queue={queue} error={deptError} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, note, loading }) {
  return (
    <div className="kpi-item">
      <span className="kpi-label">{label}</span>
      <div className="kpi-val-row">
        <span className="kpi-val">{loading ? "-" : value}</span>
      </div>
      <span className="kpi-subtext">{note}</span>
    </div>
  );
}

function DepartmentCard({ department, queue, error }) {
  const next = queue?.physical[0];
  return (
    <TiltCard className="department-card" maxTilt={3.5}>
      <div className="department-card-top">
        <div>
          <span className="dept-prefix-badge">{department.code}</span>
          <h3 className="dept-name">{department.name}</h3>
          {department.avg_consult_minutes ? (
            <div className="dept-sub-info">About {department.avg_consult_minutes} min per patient</div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="card-error" role="alert">
          Couldn't load this queue. {error.message}
        </p>
      ) : (
        <>
          <div className="dept-metrics-grid">
            <Metric label="On site" value={queue?.counts.physicalWaiting} />
            <Metric label="Booked" value={queue?.counts.virtualWaiting} />
            <Metric label="With doctor" value={queue?.counts.inProgress} />
          </div>

          <p className="next-up">
            {next ? (
              <>
                <span className="next-up-label">Next up</span>
                <strong className="mono">{next.code}</strong>
                {next.patient_name ? <span>{next.patient_name}</span> : null}
                <PriorityTag priority={next.priority} />
              </>
            ) : (
              <span className="next-up-label">No one is waiting on site</span>
            )}
          </p>
        </>
      )}

      <div className="department-card-actions">
        <span className="dept-roster-footnote">
          {queue ? `${queue.counts.doctorsAvailable} doctor${queue.counts.doctorsAvailable === 1 ? "" : "s"} available` : ""}
        </span>
        <MagneticButton className="btn btn-primary btn-sm" onClick={() => openQueue(department.id)}>
          Open queue
        </MagneticButton>
      </div>
    </TiltCard>
  );
}

function Metric({ label, value }) {
  return (
    <div className="dept-metric-box">
      <span className="cell-label">{label}</span>
      <span className="dept-metric-value">{value ?? "-"}</span>
    </div>
  );
}
