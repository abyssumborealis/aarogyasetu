/**
 * API client (replaces js/api.js). Every network call in the app goes through here.
 *
 * ── Endpoints that exist in your backend (routes/staff_queue.py, routes/tokens.py) ──
 *   POST /checkin/staff-scan            { token_public_id }
 *   POST /checkin/manual                { token_id }
 *   POST /walkin/reception              { department_id, priority, reason, patient_id | full_name + phone }
 *   GET  /queue/{department_id}
 *   GET  /queue/{department_id}/next
 *   POST /queue/{department_id}/call-next   { doctor_id }
 *   POST /queue/tokens/{id}/start | /complete | /absent | /reinstate
 *   GET  /tokens/{public_id}/status     (public, no auth)
 *   GET  /health
 *
 * ── Endpoints this console ALSO needs that were not in the files you shared ──
 *   POST /auth/staff/login              { email, password } -> { access_token, staff? }
 *   GET  /departments                   -> [{ id, name, code, hospital_id, avg_consult_minutes, ... }]
 *                                          (only the signed-in staff member's hospital; all for super_admin)
 *   GET  /departments/{id}/doctors      -> [{ id, full_name, specialization, status }]
 *   If your paths differ, change them in the PATHS object below - nothing else needs to move.
 *
 * ── Note on GET /queue/{department_id} ──
 *   It returns raw SQLAlchemy objects. Add a response_model for it. Until then normalizeQueue()
 *   below accepts [token, patient_name] pairs, { token, patient_name } objects, or flat tokens.
 */
import { actions, getState } from "../store/useStore";
import { tokenCode } from "../utils/format";

const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

const PATHS = {
  login: "/auth/staff/login",
  health: "/health",
  departments: "/departments",
  doctors: (deptId) => `/departments/${deptId}/doctors`,
};

export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** FastAPI errors: { detail: "text" } or { detail: [{ loc, msg }] } for validation failures. */
function messageFrom(data) {
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== "body").join(".") : "";
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join(". ");
  }
  return null;
}

async function request(method, path, { body, auth = true } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const { token } = getState();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check that the backend is running.");
  }

  let data = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth && token) {
      actions.logout();
      throw new ApiError(401, "Your session has expired. Sign in again.", data);
    }
    throw new ApiError(res.status, messageFrom(data) || `Request failed (${res.status})`, data);
  }
  return data;
}

const get = (path, opts) => request("GET", path, opts);
const post = (path, body, opts) => request("POST", path, { body: body ?? {}, ...opts });

// --------------------------------------------------------------------------- //
// Normalisers
// --------------------------------------------------------------------------- //
function normToken(t, deptCode) {
  if (!t || typeof t !== "object") return t;
  return { ...t, code: tokenCode(t, deptCode) };
}

function normRow(item, deptCode) {
  if (Array.isArray(item)) return { ...normToken(item[0], deptCode), patient_name: item[1] ?? null };
  if (item && item.token) {
    return {
      ...normToken(item.token, deptCode),
      patient_name: item.patient_name ?? item.full_name ?? item.name ?? null,
    };
  }
  return { ...normToken(item, deptCode), patient_name: item?.patient_name ?? item?.full_name ?? null };
}

function normalizeQueue(data) {
  const dept = data?.department ?? {};
  const rows = (list) => (Array.isArray(list) ? list.map((r) => normRow(r, dept.code)) : []);
  const c = data?.counts ?? {};
  const physical = rows(data?.physical);
  const virtual = rows(data?.virtual);
  const inProgress = rows(data?.in_progress);
  return {
    department: dept,
    counts: {
      physicalWaiting: c.physical_waiting ?? physical.length,
      virtualWaiting: c.virtual_waiting ?? virtual.length,
      inProgress: c.in_progress ?? inProgress.length,
      doctorsAvailable: c.doctors_available ?? 0,
    },
    physical,
    virtual,
    inProgress,
  };
}

// --------------------------------------------------------------------------- //
// Public surface
// --------------------------------------------------------------------------- //
export const api = {
  // auth + meta
  async login(email, password) {
    const data = await post(PATHS.login, { email, password }, { auth: false });
    const token = data?.access_token ?? data?.token;
    if (!token) throw new ApiError(500, "The server signed you in but didn't return a token.");
    return { token, staff: data.staff ?? data.user ?? { email } };
  },
  health: () => get(PATHS.health, { auth: false }),
  departments: () => get(PATHS.departments),
  doctors: (deptId) => get(PATHS.doctors(deptId)),

  // dashboard / serving
  async departmentQueue(deptId) {
    return normalizeQueue(await get(`/queue/${deptId}`));
  },
  peekNext: (deptId) => get(`/queue/${deptId}/next`),
  callNext: (deptId, doctorId) => post(`/queue/${deptId}/call-next`, { doctor_id: doctorId }),
  startConsultation: (tokenId) => post(`/queue/tokens/${tokenId}/start`),
  completeConsultation: (tokenId) => post(`/queue/tokens/${tokenId}/complete`),
  /** -> { token, outcome: "requeued" | "no_show" } */
  markAbsent: (tokenId) => post(`/queue/tokens/${tokenId}/absent`),
  reinstate: (tokenId) => post(`/queue/tokens/${tokenId}/reinstate`),

  // check-in / registration
  checkInManual: (tokenId) => post("/checkin/manual", { token_id: tokenId }),
  checkInScan: (tokenPublicId) => post("/checkin/staff-scan", { token_public_id: tokenPublicId }),
  registerAtDesk: (payload) => post("/walkin/reception", payload),

  // lookup (public endpoint: what a patient's static QR points at)
  tokenStatus: (publicId) => get(`/tokens/${encodeURIComponent(publicId)}/status`, { auth: false }),
};
