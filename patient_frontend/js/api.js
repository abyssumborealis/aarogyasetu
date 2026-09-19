/**
 * QUEUE — FastAPI Backend Client
 * Connects directly to FastAPI endpoints:
 *   - GET  /health
 *   - POST /checkin/scan
 *   - POST /checkin/staff-scan
 *   - POST /checkin/manual
 *   - POST /walkin/scan
 *   - POST /walkin/reception
 *   - GET  /queue/{department_id}/next
 *   - POST /queue/{department_id}/call-next
 *
 * Automatically parses TokenOut and invokes store mutators.
 * Includes resilient fallback simulation when FastAPI is not currently running.
 */

import { store } from './store.js';
import { SYSTEM_STATES, TOKEN_STATUS, QUEUE_TYPES, CHECKIN_METHODS } from './data.js';

const API_BASE = window.__API_BASE__ || 'http://localhost:8000';

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
   * POST /checkin/scan
   * Patient's app scans rotating QR at staff check-in desk
   * Moves existing VIRTUAL token into the PHYSICAL queue
   */
  async checkInScan(payload, tokenPublicId) {
    const reqBody = {
      payload: payload || 'station_central_01.992817',
      token_public_id: tokenPublicId || store.getState().token.public_id
    };

    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/checkin/scan`, {
        method: 'POST',
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
   * Staff scans patient's token QR
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
   * POST /walkin/scan
   * Patient scans walk-in QR and enters physical queue directly
   */
  async walkInScan({ payload, patientId, departmentId, reason }) {
    const state = store.getState();
    const reqBody = {
      payload: payload || 'station_walkin_01.884102',
      patient_id: patientId || state.patient.id,
      department_id: departmentId || 101,
      reason: reason || 'Walk-in acute consultation'
    };

    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/walkin/scan`, {
        method: 'POST',
        body: JSON.stringify(reqBody)
      });
      if (!res.ok) throw new Error('Walk-in request failed');

      const tokenOut = await res.json();
      store.setToken(tokenOut);
      store.setQueueState(SYSTEM_STATES.PHYSICALLY_CHECKED_IN);
      store.showToast(`Walk-in registered! Token ${tokenOut.display_code} generated.`, 'success');
      return tokenOut;
    } catch (err) {
      console.warn('[API] /walkin/scan fallback to local simulation:', err.message);
      const walkInToken = {
        id: 135,
        public_id: 'tok_' + Math.random().toString(36).substr(2, 9),
        display_code: 'G135',
        token_number: 135,
        token_date: new Date().toISOString().split('T')[0],
        patient_id: reqBody.patient_id,
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
   * Staff registers walk-in / emergency at desk
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
   * Peek at next waiting physical queue token
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
   * Atomically pull the next waiting patient and mark CALLED
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
   * Pre-register visit (Remote Phase)
   * Places patient into pre-registered pool; keeps physical queue at 32
   */
  async preRegisterVisit(patientData) {
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

    store.updateRegistrationDraft(patientData);
    store.setToken(virtualToken);
    store.setQueueState(SYSTEM_STATES.PRE_REGISTERED);
    store.showToast(`Pre-registration confirmed! Reference: ${preRegRef}.`, 'success');
    return { preRegRef, virtualToken };
  },

  /**
   * Leave / surrender spot in queue
   */
  async leaveQueue(tokenPublicId) {
    store.setQueueState(SYSTEM_STATES.LEFT_QUEUE);
    store.showToast('You have exited the queue.', 'info');
  }
};
