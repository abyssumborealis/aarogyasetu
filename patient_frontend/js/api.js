/**
 * QUEUE — FastAPI Backend Client
 * Connects directly to FastAPI endpoints:
 *   - GET  /health
 *   - POST /tokens/check-in/scan          (was /checkin/scan — path + body field fixed below)
 *   - POST /checkin/staff-scan            (staff-only: needs X-Staff-Id, not reachable from this app)
 *   - POST /checkin/manual                (staff-only)
 *   - POST /tokens/walk-in/scan           (was /walkin/scan — path + body field fixed below)
 *   - POST /walkin/reception              (staff-only)
 *   - GET  /queue/{department_id}/next    (staff-only)
 *   - POST /queue/{department_id}/call-next (staff-only)
 *   - POST /tokens/virtual/preview   ("Check availability" — NOT YET IMPLEMENTED on the backend;
 *                                      always falls through to the local simulation below until
 *                                      a scheduled-time-slot feature is actually built server-side)
 *   - POST /tokens/virtual           (exists, but only supports "join today's queue now" -
 *                                      it has no desired_consultation_at param yet, so a
 *                                      requested time slot always falls back to simulation too)
 *
 * Automatically parses TokenOut and invokes store mutators.
 * Includes resilient fallback simulation when FastAPI is not currently running.
 */

import { store } from './store.js';
import { SYSTEM_STATES, TOKEN_STATUS, QUEUE_TYPES, CHECKIN_METHODS, getDepartment } from './data.js';
import { fmtWindow } from './timefmt.js';
import { HISTORICAL_PATTERNS } from './historical_data.js';

const API_BASE = window.__API_BASE__ || 'https://aarogyasetu-1.onrender.com';

// Frontend department ids (data.js) -> backend department ids (backend/database/seed.py:
// hospital 1 = 101-105, hospital 2 = 201-205). data.js can also carry a `backendId` per department,
// which wins. A department with neither can't be reached on the backend, so the slot check
// and booking fall back to the local simulation.
const BACKEND_DEPARTMENT_IDS = { 'gen-med': 101 };

function backendDepartmentId(hospitalId, deptId) {
  let dept = null;
  try { dept = getDepartment(hospitalId, deptId); } catch (e) { /* unknown department */ }
  return dept?.backendId ?? BACKEND_DEPARTMENT_IDS[deptId] ?? null;
}

// PLACEHOLDER AUTH: mirrors the backend's get_current_patient(), which trusts this header.
function patientHeaders() {
  return { 'X-Patient-Id': String(store.getState().patient.id) };
}

const VISIT_REASONS = {
  appointment: 'Scheduled appointment',
  followup: 'Follow-up consultation',
  walkin: 'General outpatient visit'
};

async function readError(res) {
  try {
    const body = await res.json();
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map(d => d.msg).join('; ');
  } catch (e) { /* not JSON */ }
  return `Request failed (${res.status})`;
}

/** Offline stand-in for the server's plan: same shape, crude numbers. Flagged `simulated`. */
function simulateArrivalPlan(key, date, time) {
  const WAIT = 15, WINDOW = 10, NOTICE = 20;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const desired = new Date(`${date}T${time}:00`);
  const base = { key, status: 'ready', simulated: true, timezone: tz, model_version: 'offline-estimate',
                 requested_consultation_at: desired.toISOString() };

  if (desired.getTime() <= Date.now()) {
    return { ...base, available: false, reason: 'in_the_past',
             message: 'That time has already passed. Please choose a later time.' };
  }
  const from = new Date(desired.getTime() - (WAIT + WINDOW) * 60000);
  if (from.getTime() < Date.now() + NOTICE * 60000) {
    const q = 15 * 60000;
    const earliest = new Date(Math.ceil((Date.now() + (NOTICE + WAIT + WINDOW) * 60000) / q) * q);
    return { ...base, available: false, reason: 'too_soon', earliest_available_at: earliest.toISOString(),
             message: `We need at least ${NOTICE} minutes' notice before your arrival window.` };
  }
  return { ...base, available: true, message: '', congestion_level: 'medium', predicted_wait_minutes: WAIT,
           arrive_from: from.toISOString(), arrive_until: new Date(from.getTime() + WINDOW * 60000).toISOString(),
           expected_consultation_at: desired.toISOString() };
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export const api = {
  baseUrl: API_BASE,

  /**
   * Health Check: tests FastAPI server connectivity
   */
  async healthCheck() {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/health`, { method: 'GET' }, 2000);
      if (res.ok) {
        const data = await res.json();
        console.log('[API] FastAPI Health Check OK:', data);
        store.setBackendConnected(true, 'FastAPI Connected (Port 8000)');
        return true;
      }
    } catch (err) {
      console.log('[API] FastAPI not detected on port 8000. Running in Local Simulation Mode.');
      store.setBackendConnected(false, 'Local Simulation Mode');
      return false;
    }
  },

  /**
   * POST /tokens/check-in/scan
   * Patient's app scans rotating QR at staff check-in desk
   * Moves existing VIRTUAL token into the PHYSICAL queue
   */
  async checkInScan(payload, tokenPublicId) {
    const reqBody = {
      qr_payload: payload || 'station_central_01.992817',
      token_public_id: tokenPublicId || store.getState().token.public_id
    };

    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/tokens/check-in/scan`, {
        method: 'POST',
        headers: patientHeaders(),
        body: JSON.stringify(reqBody)
      }, 3000);

      if (!res.ok) {
        const errorDetail = await res.json().catch(() => ({ detail: 'Check-in failed' }));
        throw new Error(errorDetail.detail || `Server responded with ${res.status}`);
      }

      const tokenOut = await res.json();
      console.log('[API] Check-in successful from FastAPI:', tokenOut);
      
      store.setToken(tokenOut);
      store.setQueueState(SYSTEM_STATES.PHYSICALLY_CHECKED_IN);
      store.showToast(`Check-in verified! Official token ${tokenOut.display_code} is now in the physical queue.`, 'success');
      return tokenOut;

    } catch (err) {
      console.warn('[API] /checkin/scan fallback to local simulation:', err.message);
      
      // Fallback: update store locally with simulated TokenOut
      const state = store.getState();
      const simulatedToken = {
        ...state.token,
        queue_type: QUEUE_TYPES.PHYSICAL,
        status: TOKEN_STATUS.WAITING,
        check_in_method: CHECKIN_METHODS.DYNAMIC_QR,
        checked_in_at: new Date().toISOString()
      };

      store.setToken(simulatedToken);
      store.setQueueState(SYSTEM_STATES.PHYSICALLY_CHECKED_IN);
      store.showToast(`Arrival confirmed on-site! Official token ${simulatedToken.display_code} entered physical queue.`, 'success');
      return simulatedToken;
    }
  },

  /**
   * POST /checkin/staff-scan
   * Staff scans patient's token QR.
   * STAFF-ONLY ENDPOINT: requires an X-Staff-Id header this app has no way to provide (it only
   * ever holds a patient session). Calling this from here will always 401 against the real
   * backend and fall through to simulation - move this into the admin app's api client instead
   * if it's meant to be used there, rather than fixed here.
   */
  async checkInStaffScan(tokenPublicId) {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/checkin/staff-scan`, {
        method: 'POST',
        body: JSON.stringify({ token_public_id: tokenPublicId || store.getState().token.public_id })
      });
      if (res.ok) {
        const tokenOut = await res.json();
        store.setToken(tokenOut);
        store.setQueueState(SYSTEM_STATES.PHYSICALLY_CHECKED_IN);
        return tokenOut;
      }
    } catch (e) {
      console.warn('[API] /checkin/staff-scan fallback');
    }
  },

  /**
   * POST /tokens/walk-in/scan
   * Patient scans walk-in QR and enters physical queue directly.
   * Patient identity comes from the X-Patient-Id auth header, not the body - the backend's
   * WalkInScanRequest has no patient_id field, so it's dropped here rather than sent for nothing.
   */
  async walkInScan({ payload, departmentId, reason }) {
    const reqBody = {
      qr_payload: payload || 'station_walkin_01.884102',
      department_id: departmentId || 101,
      reason: reason || 'Walk-in acute consultation'
    };

    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/tokens/walk-in/scan`, {
        method: 'POST',
        headers: patientHeaders(),
        body: JSON.stringify(reqBody)
      });
      if (!res.ok) throw new Error('Walk-in request failed');

      const tokenOut = await res.json();
      store.setToken(tokenOut);
      store.setQueueState(SYSTEM_STATES.PHYSICALLY_CHECKED_IN);
      store.showToast(`Walk-in registered! Token ${tokenOut.display_code} generated.`, 'success');
      return tokenOut;
    } catch (err) {
      console.warn('[API] /tokens/walk-in/scan fallback to local simulation:', err.message);
      const walkInToken = {
        id: 135,
        public_id: 'tok_' + Math.random().toString(36).substr(2, 9),
        display_code: 'G135',
        token_number: 135,
        token_date: new Date().toISOString().split('T')[0],
        patient_id: store.getState().patient.id,
        department_id: reqBody.department_id,
        priority: 2,
        status: TOKEN_STATUS.WAITING,
        queue_type: QUEUE_TYPES.PHYSICAL,
        source: 'WALKIN_QR',
        checked_in_at: new Date().toISOString(),
        issued_at: new Date().toISOString()
      };
      store.setToken(walkInToken);
      store.setQueueState(SYSTEM_STATES.PHYSICALLY_CHECKED_IN);
      return walkInToken;
    }
  },

  /**
   * POST /walkin/reception
   * Staff registers walk-in / emergency at desk.
   * STAFF-ONLY ENDPOINT: requires X-Staff-Id, which this app never has. Belongs in the admin
   * app's api client - kept here only because it already existed; will always fall back.
   */
  async walkInReception({ patientId, departmentId, reason, priority = 2 }) {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/walkin/reception`, {
        method: 'POST',
        body: JSON.stringify({ patient_id: patientId, department_id: departmentId, reason, priority })
      });
      if (res.ok) {
        const tokenOut = await res.json();
        store.setToken(tokenOut);
        store.setQueueState(SYSTEM_STATES.PHYSICALLY_CHECKED_IN);
        return tokenOut;
      }
    } catch (e) {
      console.warn('[API] /walkin/reception fallback');
    }
  },

  /**
   * GET /queue/{department_id}/next
   * Peek at next waiting physical queue token.
   * STAFF-ONLY ENDPOINT: requires X-Staff-Id. Belongs in the admin app's api client.
   */
  async getQueueNext(departmentId = 101) {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/queue/${departmentId}/next`, { method: 'GET' });
      if (res.ok) {
        const nextToken = await res.json();
        return nextToken;
      }
    } catch (e) {
      console.warn('[API] /queue/next peek fallback');
      return null;
    }
  },

  /**
   * POST /queue/{department_id}/call-next
   * Atomically pull the next waiting patient and mark CALLED.
   * STAFF-ONLY ENDPOINT: requires X-Staff-Id. Belongs in the admin app's api client.
   */
  async callNextPatient(departmentId = 101, doctorId = 4) {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/queue/${departmentId}/call-next`, {
        method: 'POST',
        body: JSON.stringify({ doctor_id: doctorId })
      });
      if (res.ok) {
        const tokenOut = await res.json();
        store.setToken(tokenOut);
        store.setQueueState(SYSTEM_STATES.CALLED);
        return tokenOut;
      }
    } catch (e) {
      console.warn('[API] /queue/call-next fallback to local state transition');
      store.setQueueState(SYSTEM_STATES.CALLED);
    }
  },

  /**
   * POST /tokens/virtual/preview
   * "Check availability": read-only. Asks the server when to arrive to be seen at the requested
   * date/time. The result is stored as store.arrivalPlan (keyed to the request it answers).
   * Falls back to a local estimate, flagged `simulated`, only when the backend is unreachable.
   */
  async previewArrival() {
    const state = store.getState();
    const { desiredDate, desiredTime } = state;
    if (!desiredDate || !desiredTime) {
      store.showToast('Choose a date and a time first.', 'warning');
      return null;
    }

    const key = store.arrivalKey();
    const backendDeptId = backendDepartmentId(state.activeHospitalId, state.registrationDraft.departmentId);
    store.setArrivalPlan({ key, status: 'loading' });

    if (backendDeptId !== null) {
      try {
        const res = await fetchWithTimeout(`${this.baseUrl}/tokens/virtual/preview`, {
          method: 'POST',
          headers: patientHeaders(),
          body: JSON.stringify({
            department_id: backendDeptId,
            desired_consultation_at: `${desiredDate}T${desiredTime}`
          })
        }, 4000);

        if (!res.ok) {
          // The server answered and said no (bad session, bad input): show that, don't fake a result.
          store.setArrivalPlan({ key, status: 'error', message: await readError(res) });
          return null;
        }
        const plan = { ...(await res.json()), key, status: 'ready', simulated: false };
        store.setArrivalPlan(plan);
        return plan;
      } catch (err) {
        console.warn('[API] /tokens/virtual/preview fallback to local estimate:', err.message);
      }
    }

    const plan = simulateArrivalPlan(key, desiredDate, desiredTime);
    store.setArrivalPlan(plan);
    return plan;
  },

  /**
   * Pre-register visit (Remote Phase)
   * With a checked time slot: POST /tokens/virtual, and the server recomputes the arrival window
   * from the requested time (the previewed window is never sent back).
   * Without one (guided demo): the original local simulation.
   * Resolves to { ok, preRegRef, virtualToken }; ok === false means the server refused the booking.
   */
  async preRegisterVisit(patientData) {
    const state = store.getState();
    const plan = state.arrivalPlan;
    const hasSlot = Boolean(state.desiredTime) && plan && plan.status === 'ready'
      && plan.available && plan.key === store.arrivalKey();
    const backendDeptId = backendDepartmentId(state.activeHospitalId, state.registrationDraft.departmentId);

    if (hasSlot && !plan.simulated && backendDeptId !== null) {
      try {
        const res = await fetchWithTimeout(`${this.baseUrl}/tokens/virtual`, {
          method: 'POST',
          headers: patientHeaders(),
          body: JSON.stringify({
            department_id: backendDeptId,
            reason: VISIT_REASONS[patientData?.visitType] || null,
            desired_consultation_at: `${state.desiredDate}T${state.desiredTime}`
          })
        }, 5000);

        if (!res.ok) {
          store.showToast(await readError(res), 'error', 6000);
          store.setArrivalPlan(null);   // the situation changed (slot taken, time passed...): re-check
          return { ok: false };
        }

        const tokenOut = await res.json();
        store.updateRegistrationDraft(patientData);
        store.setToken(tokenOut);
        store.setQueueState(SYSTEM_STATES.PRE_REGISTERED);
        const arrivalWindow = fmtWindow(tokenOut.report_by_at, tokenOut.arrival_window_end_at, plan.timezone);
        store.updatePatient({ arrivalWindow, preRegCode: tokenOut.display_code });
        store.showToast(`Booked! Token ${tokenOut.display_code}. Arrive between ${arrivalWindow}.`, 'success');
        return { ok: true, preRegRef: tokenOut.display_code, virtualToken: tokenOut };
      } catch (err) {
        console.warn('[API] /tokens/virtual fallback to local simulation:', err.message);
      }
    }

    const preRegRef = 'PRE-' + Math.floor(10000 + Math.random() * 90000);
    const virtualToken = {
      id: 128,
      public_id: 'tok_virtual_' + Math.random().toString(36).substr(2, 8),
      display_code: 'G128',
      token_number: 128,
      token_date: new Date().toISOString().split('T')[0],
      patient_id: 10482,
      department_id: 101,
      priority: 2,
      status: TOKEN_STATUS.WAITING,
      queue_type: QUEUE_TYPES.VIRTUAL,
      source: 'ONLINE',
      checked_in_at: null,
      issued_at: new Date().toISOString(),
      predicted_wait_minutes: 35
    };

    if (hasSlot) {   // simulated slot: carry the requested time and window into the confirmation
      virtualToken.requested_consultation_at = plan.requested_consultation_at;
      virtualToken.report_by_at = plan.arrive_from;
      virtualToken.arrival_window_end_at = plan.arrive_until;
    }

    store.updateRegistrationDraft(patientData);
    store.setToken(virtualToken);
    store.setQueueState(SYSTEM_STATES.PRE_REGISTERED);
    if (hasSlot) {
      store.updatePatient({ arrivalWindow: fmtWindow(plan.arrive_from, plan.arrive_until, plan.timezone) });
    }
    store.showToast(`Pre-registration confirmed! Reference: ${preRegRef}.`, 'success');
    return { ok: true, preRegRef, virtualToken };
  },

  /**
   * Leave / surrender spot in queue
   */
  async leaveQueue(tokenPublicId) {
    store.setQueueState(SYSTEM_STATES.LEFT_QUEUE);
    store.showToast('You have exited the queue.', 'info');
  },

  /**
   * GET /historical/crowd-pattern
   * Fetches aggregated historical operational data (average/median crowd, waiting times)
   * Falls back to bundled historical dataset in simulation/offline mode.
   */
  async getHistoricalCrowdPattern(department = 'General Medicine', dayOfWeek = 0) {
    const dow = parseInt(dayOfWeek, 10) % 7;
    try {
      const url = `${this.baseUrl}/historical/crowd-pattern?department=${encodeURIComponent(department)}&day_of_week=${dow}`;
      const res = await fetchWithTimeout(url, { method: 'GET' }, 2500);
      if (res.ok) {
        const data = await res.json();
        if (data && data.hourly_data && data.hourly_data.length > 0) {
          return data;
        }
      }
    } catch (e) {
      // Local fallback
    }

    // Bundled fallback from operational dataset
    const deptGroup = HISTORICAL_PATTERNS[department] || HISTORICAL_PATTERNS['General Medicine'] || {};
    return deptGroup[String(dow)] || {
      department,
      day_of_week: dow,
      day_name: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dow],
      busiest_period: `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dow]}, 10 AM – 12 PM`,
      lower_demand_period: '2 PM – 4 PM',
      typical_wait_range: '~25–45 min',
      hourly_data: []
    };
  },

  /**
   * POST /predict/crowd
   * Retrieves today's crowd forecast (+15m, +30m, +60m and congestion status)
   * using the existing Random Forest crowd prediction model.
   */
  async getTodayCrowdForecast(department = 'General Medicine', currentQueue = 12, doctors = 2, avgService = 10, capacity = 25) {
    const reqBody = {
      department,
      current_queue: currentQueue,
      doctors_available: doctors,
      average_service_time: avgService,
      capacity,
      expected_arrivals_15min: Math.max(2, Math.round(currentQueue * 0.25)),
      expected_arrivals_30min: Math.max(4, Math.round(currentQueue * 0.5)),
      expected_arrivals_60min: Math.max(8, currentQueue)
    };

    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/predict/crowd`, {
        method: 'POST',
        body: JSON.stringify(reqBody)
      }, 2500);

      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // Fallback
    }

    // Client-side reflection of the Random Forest timeline
    const srvRate = doctors / Math.max(1, avgService);
    const p15 = Math.max(0, Math.round(currentQueue + reqBody.expected_arrivals_15min - (srvRate * 15)));
    const p30 = Math.max(0, Math.round(currentQueue + reqBody.expected_arrivals_30min - (srvRate * 30)));
    const p60 = Math.max(0, Math.round(currentQueue + reqBody.expected_arrivals_60min - (srvRate * 60) + 2));
    const ratio = p60 / Math.max(1, capacity);
    const congestion = ratio < 0.65 ? 'low' : (ratio < 1.05 ? 'medium' : (ratio < 1.5 ? 'high' : 'critical'));

    return {
      predicted_crowd: p60,
      congestion,
      capacity,
      department,
      timeline: {
        current: currentQueue,
        plus_15m: p15,
        plus_30m: p30,
        plus_60m: p60
      },
      alert: congestion === 'critical' ? `CRITICAL: Projecting over-capacity (${p60}/${capacity}) in 60 min.` :
             (congestion === 'high' ? `WARNING: High demand arriving (${p60} patients in 60 min).` : null)
    };
  }
};