/**
 * QUEUE — Reactive State Store (QueueStore)
 * Pure state holder with listeners.add(fn) + notify() pattern.
 * Synchronizes with FastAPI TokenOut and system states.
 */

import { SYSTEM_STATES, TOKEN_STATUS, QUEUE_TYPES, TOKEN_PRIORITY, getHospital, getDepartment } from './data.js';
import { localDateString } from './timefmt.js';

class QueueStore {
  constructor() {
    this.listeners = new Set();

    this.defaultState = {
      // Routing & selection
      currentView: 'landing',
      viewParams: {},
      activeHospitalId: 'city-hospital',
      activeDeptId: 'gen-med',

      // Backend connectivity
      backendConnected: false,
      backendMessage: 'Checking FastAPI status...',

      // Official Token (FastAPI TokenOut schema)
      token: {
        id: 128,
        public_id: 'tok_c4b92a81f3',
        display_code: 'G128',
        token_number: 128,
        token_date: new Date().toISOString().split('T')[0],
        patient_id: 10482,
        department_id: 101,
        doctor_id: 4,
        priority: TOKEN_PRIORITY.NORMAL,
        status: TOKEN_STATUS.WAITING,
        reason: 'General consultation and routine checkup',
        queue_type: QUEUE_TYPES.VIRTUAL, // starts virtual during pre-reg
        source: 'ONLINE',
        checked_in_at: null,
        check_in_method: null,
        issued_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        called_at: null,
        consultation_started_at: null,
        completed_at: null,
        predicted_wait_minutes: 35
      },

      // Patient Session Information
      patient: {
        id: 10482,
        mrn: 'MRN-84920',
        name: 'Alex Morgan',
        phone: '+1 (555) 019-2834',
        visitType: 'appointment',
        appointmentId: 'APT-9921',
        preRegCode: 'PRE-10482',
        arrivalWindow: '10:30 – 11:00 AM'
      },

      // Queue state matching 9 canonical states
      queueState: SYSTEM_STATES.PRE_REGISTERED,

      // Live Physical Queue Telemetry
      position: 8,
      patientsAhead: 7,
      estimatedWaitMinutes: 35,
      currentlyServing: {
        token: 'G121',
        room: 'Consultation Room 4',
        doctor: 'Dr. Aris Vance'
      },
      physicalWaitingCount: 32, // Fixed at 32 for remote pre-reg demo

      // Pre-registration roster (remote visitors not in physical count)
      preRegisteredPool: [
        { ref: 'PRE-10482', patientName: 'Alex Morgan', arrivalWindow: '10:30 – 11:00 AM', status: 'Expected' },
        { ref: 'PRE-10483', patientName: 'Taylor Reed', arrivalWindow: '10:45 – 11:15 AM', status: 'Expected' },
        { ref: 'PRE-10484', patientName: 'Jordan Vance', arrivalWindow: '11:00 – 11:30 AM', status: 'Expected' }
      ],

      // Sequential Queue Flow Nodes
      flowSequence: [
        { token: 'G121', status: 'SERVING', room: 'Room 4', isYou: false },
        { token: 'G122', status: 'NEXT', room: null, isYou: false },
        { token: 'G123', status: 'WAITING', room: null, isYou: false },
        { token: 'G124', status: 'WAITING', room: null, isYou: false },
        { token: 'G125', status: 'WAITING', room: null, isYou: false },
        { token: 'G126', status: 'WAITING', room: null, isYou: false },
        { token: 'G127', status: 'WAITING', room: null, isYou: false },
        { token: 'G128', status: 'YOU', room: null, isYou: true },
        { token: 'G129', status: 'WAITING', room: null, isYou: false },
        { token: 'G130', status: 'WAITING', room: null, isYou: false }
      ],

      // Registration Form Step (1: Status, 2: Ident, 3: Visit)
      registrationStep: 1,
      registrationDraft: {
        patientStatus: 'existing',
        patientId: 'MRN-84920',
        phone: '+1 (555) 019-2834',
        name: 'Alex Morgan',
        dob: '1988-06-14',
        visitType: 'appointment',
        appointmentId: 'APT-9921',
        departmentId: 'gen-med'
      },

      // Requested consultation time (Step 3) and the server's arrival recommendation for it.
      // desiredDate is 'YYYY-MM-DD' and desiredTime is 'HH:MM', both in hospital-local time.
      // arrivalPlan is cleared whenever the department, date or time changes, so a result for
      // 2 PM can never sit next to a 4 PM request:
      //   null | { key, status: 'loading' } | { key, status: 'error', message }
      //        | { key, status: 'ready', ...ArrivalPreviewOut, simulated }
      desiredDate: localDateString(),
      desiredTime: '',
      arrivalPlan: null,

      // UI Controls & Audio
      audioChimeEnabled: true,
      simDockOpen: false,
      activeModal: null,
      toasts: [],

      // Location-Based Hospital Discovery (client-side only, never persisted
      // or sent to the backend; see requestUserLocation() in app.js)
      location: {
        status: 'NOT_REQUESTED', // NOT_REQUESTED | REQUESTING | AVAILABLE | DENIED | ERROR
        coords: null,            // { lat, lng } once AVAILABLE
        errorMessage: null
      },

      // Historical Crowd Patterns & Today's Forecast
      selectedHistoricalDept: 'General Medicine',
      selectedHistoricalDay: (new Date().getDay() + 6) % 7, // 0 = Monday, 6 = Sunday
      selectedHistoricalMetric: 'wait', // 'wait' | 'crowd'
      historicalPattern: null,
      todayCrowdForecast: null
    };

    this.state = JSON.parse(JSON.stringify(this.defaultState));
    this.audioContext = null;
  }

  // Listener management
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    const currentState = this.getState();
    this.listeners.forEach(fn => {
      try {
        fn(currentState);
      } catch (err) {
        console.error('[QueueStore] Listener error:', err);
      }
    });
  }

  getState() {
    return { ...this.state };
  }

  // Routing
  setView(viewName, params = {}) {
    this.state.currentView = viewName;
    this.state.viewParams = params;
    if (params.id) {
      this.state.activeHospitalId = params.id;
    }
    if (params.dept) {
      this.state.activeDeptId = params.dept;
    }
    this.notify();
  }

  setSelectedHospital(hospitalId) {
    this.state.activeHospitalId = hospitalId;
    this.notify();
  }

  setSelectedDepartment(deptId) {
    this.state.activeDeptId = deptId;
    this.notify();
  }

  setBackendConnected(connected, message = '') {
    this.state.backendConnected = Boolean(connected);
    this.state.backendMessage = message || (connected ? 'FastAPI Connected (Port 8000)' : 'Local Simulation Mode');
    this.notify();
  }

  // Token update from FastAPI response
  setToken(tokenData) {
    if (!tokenData) return;
    this.state.token = {
      ...this.state.token,
      ...tokenData
    };

    // If token transitioned to PHYSICAL, update queue_type
    if (tokenData.queue_type === QUEUE_TYPES.PHYSICAL) {
      this.state.token.queue_type = QUEUE_TYPES.PHYSICAL;
    }

    // Reflect token status
    if (tokenData.status === TOKEN_STATUS.CALLED) {
      this.setQueueState(SYSTEM_STATES.CALLED);
    } else if (tokenData.status === TOKEN_STATUS.IN_CONSULTATION) {
      this.setQueueState(SYSTEM_STATES.IN_CONSULTATION);
    } else if (tokenData.status === TOKEN_STATUS.COMPLETED) {
      this.setQueueState(SYSTEM_STATES.COMPLETED);
    }

    this.notify();
  }

  // Canonical System State Transitions
  setQueueState(newState) {
    if (!SYSTEM_STATES[newState]) {
      console.warn(`[QueueStore] Unknown state: ${newState}`);
      return;
    }

    this.state.queueState = newState;

    switch (newState) {
      case SYSTEM_STATES.PRE_REGISTERED:
        this.state.token.queue_type = QUEUE_TYPES.VIRTUAL;
        this.state.token.status = TOKEN_STATUS.WAITING;
        this.state.position = 8;
        this.state.patientsAhead = 7;
        this.state.estimatedWaitMinutes = 35;
        this.state.currentlyServing.token = 'G121';
        this.updateFlowNodes('G121', 'G122', 8);
        break;

      case SYSTEM_STATES.PHYSICALLY_CHECKED_IN:
      case SYSTEM_STATES.WAITING:
        this.state.token.queue_type = QUEUE_TYPES.PHYSICAL;
        this.state.token.status = TOKEN_STATUS.WAITING;
        if (!this.state.token.checked_in_at) {
          this.state.token.checked_in_at = new Date().toISOString();
        }
        this.state.position = 8;
        this.state.patientsAhead = 7;
        this.state.estimatedWaitMinutes = 35;
        this.state.currentlyServing.token = 'G121';
        this.updateFlowNodes('G121', 'G122', 8);
        break;

      case SYSTEM_STATES.APPROACHING:
        this.state.token.queue_type = QUEUE_TYPES.PHYSICAL;
        this.state.token.status = TOKEN_STATUS.WAITING;
        this.state.position = 2;
        this.state.patientsAhead = 1;
        this.state.estimatedWaitMinutes = 5;
        this.state.currentlyServing.token = 'G127';
        this.updateFlowNodes('G127', 'G128', 2);
        this.showToast("Your turn is approaching! Please move toward Consultation Lobby near Room 4.", "warning");
        break;

      case SYSTEM_STATES.CALLED:
        this.state.token.queue_type = QUEUE_TYPES.PHYSICAL;
        this.state.token.status = TOKEN_STATUS.CALLED;
        this.state.token.called_at = new Date().toISOString();
        this.state.position = 1;
        this.state.patientsAhead = 0;
        this.state.estimatedWaitMinutes = 0;
        this.state.currentlyServing.token = this.state.token.display_code;
        this.updateFlowNodes(this.state.token.display_code, 'G129', 1);
        this.playChime();
        this.showToast(`TOKEN ${this.state.token.display_code} CALLED TO ${this.state.currentlyServing.room}!`, "success", 6000);
        break;

      case SYSTEM_STATES.IN_CONSULTATION:
        this.state.token.status = TOKEN_STATUS.IN_CONSULTATION;
        this.state.token.consultation_started_at = new Date().toISOString();
        this.state.position = 0;
        this.state.patientsAhead = 0;
        this.state.estimatedWaitMinutes = 0;
        break;

      case SYSTEM_STATES.COMPLETED:
        this.state.token.status = TOKEN_STATUS.COMPLETED;
        this.state.token.completed_at = new Date().toISOString();
        this.showToast("Consultation completed. Discharge instructions saved.", "success");
        break;

      case SYSTEM_STATES.NO_SHOW:
        this.state.token.status = TOKEN_STATUS.NO_SHOW;
        this.showToast("Token marked as No-Show after final call.", "error");
        break;

      case SYSTEM_STATES.LEFT_QUEUE:
        this.state.token.status = TOKEN_STATUS.CANCELLED;
        this.showToast("You have surrendered your spot in the queue.", "info");
        break;
    }

    this.notify();
  }

  // Update sequential timeline
  updateFlowNodes(servingToken, nextToken, userPos) {
    const num = parseInt(servingToken.replace(/\D/g, ''), 10) || 121;
    const prefix = servingToken.replace(/\d/g, '') || 'G';

    this.state.flowSequence = Array.from({ length: 10 }, (_, i) => {
      const tokenNum = num + i;
      const code = `${prefix}${tokenNum}`;
      const isYou = code === this.state.token.display_code;
      let nodeStatus = 'WAITING';

      if (i === 0) {
        nodeStatus = 'SERVING';
      } else if (code === nextToken || i === 1) {
        nodeStatus = 'NEXT';
      }
      if (isYou) {
        nodeStatus = 'YOU';
      }

      return {
        token: code,
        status: nodeStatus,
        room: i === 0 ? 'Room 4' : null,
        isYou: isYou
      };
    });
  }

  // Stepping forward in queue
  advanceQueue() {
    if (this.state.queueState === SYSTEM_STATES.CALLED || this.state.queueState === SYSTEM_STATES.COMPLETED) {
      this.setQueueState(SYSTEM_STATES.COMPLETED);
      return;
    }

    if (this.state.position > 3) {
      this.state.position -= 1;
      this.state.patientsAhead = Math.max(0, this.state.position - 1);
      this.state.estimatedWaitMinutes = Math.max(5, this.state.estimatedWaitMinutes - 4);
      
      const currentServingNum = parseInt(this.state.currentlyServing.token.replace(/\D/g, ''), 10) || 121;
      const nextServing = `G${currentServingNum + 1}`;
      this.state.currentlyServing.token = nextServing;
      this.updateFlowNodes(nextServing, `G${currentServingNum + 2}`, this.state.position);
      this.notify();
    } else if (this.state.position === 3 || this.state.position === 2) {
      this.setQueueState(SYSTEM_STATES.APPROACHING);
    } else if (this.state.position <= 2) {
      this.setQueueState(SYSTEM_STATES.CALLED);
    }
  }

  // Registration draft
  setRegistrationStep(step) {
    this.state.registrationStep = step;
    this.notify();
  }

  updateRegistrationDraft(patch) {
    const deptChanged = patch.departmentId !== undefined
      && patch.departmentId !== this.state.registrationDraft.departmentId;
    this.state.registrationDraft = {
      ...this.state.registrationDraft,
      ...patch
    };
    if (deptChanged) this.state.arrivalPlan = null;
    this.notify();
  }

  // Requested consultation slot -------------------------------------------- //
  setDesiredDate(date) {
    this.state.desiredDate = date || '';
    this.state.arrivalPlan = null;
    this.notify();
  }

  setDesiredTime(time) {
    this.state.desiredTime = time || '';
    this.state.arrivalPlan = null;
    this.notify();
  }

  setDesiredSlot(date, time) {
    this.state.desiredDate = date || '';
    this.state.desiredTime = time || '';
    this.state.arrivalPlan = null;
    this.notify();
  }

  /** Identifies the request a plan answers: department | date | time. */
  arrivalKey() {
    const { registrationDraft, desiredDate, desiredTime } = this.state;
    return `${registrationDraft.departmentId}|${desiredDate}|${desiredTime}`;
  }

  /** Ignores a result whose request is no longer the current one (slow response, user moved on). */
  setArrivalPlan(plan) {
    if (plan && plan.key !== this.arrivalKey()) return;
    this.state.arrivalPlan = plan;
    this.notify();
  }

  updatePatient(patch) {
    this.state.patient = { ...this.state.patient, ...patch };
    this.notify();
  }

  // Simulator dock
  toggleSimDock(forceState = null) {
    if (forceState !== null) {
      this.state.simDockOpen = Boolean(forceState);
    } else {
      this.state.simDockOpen = !this.state.simDockOpen;
    }
    this.notify();
  }

  toggleAudioChime() {
    this.state.audioChimeEnabled = !this.state.audioChimeEnabled;
    this.showToast(`Audio announcements: ${this.state.audioChimeEnabled ? 'ENABLED' : 'MUTED'}`, 'info');
    this.notify();
  }

  // Web Audio chime synthesizer
  playChime() {
    if (!this.state.audioChimeEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioContext) {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const now = this.audioContext.currentTime;
      const osc1 = this.audioContext.createOscillator();
      const osc2 = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.setValueAtTime(880.00, now + 0.22); // A5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(293.66, now); // D4
      osc2.frequency.setValueAtTime(440.00, now + 0.22); // A4

      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.25, now + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.95);
      osc2.stop(now + 0.95);
    } catch (e) {
      console.warn('[Audio] Could not play synthesized chime:', e);
    }
  }

  // Toasts & Modals
  showToast(message, type = 'info', duration = 3500) {
    const id = Date.now() + Math.random().toString(36).substr(2, 4);
    const toast = { id, message, type };
    this.state.toasts = [...this.state.toasts, toast];
    this.notify();

    setTimeout(() => {
      this.dismissToast(id);
    }, duration);
  }

  dismissToast(id) {
    this.state.toasts = this.state.toasts.filter(t => t.id !== id);
    this.notify();
  }

  openModal(modalId) {
    this.state.activeModal = modalId;
    this.notify();
  }

  closeModal() {
    this.state.activeModal = null;
    this.notify();
  }

  // ------------------------------------------------------------------- //
  // Location-Based Hospital Discovery
  // ------------------------------------------------------------------- //
  setLocationRequesting() {
    this.state.location = { status: 'REQUESTING', coords: null, errorMessage: null };
    this.notify();
  }

  setLocationAvailable(coords) {
    this.state.location = { status: 'AVAILABLE', coords, errorMessage: null };
    this.notify();
  }

  setLocationDenied(message) {
    this.state.location = {
      status: 'DENIED',
      coords: null,
      errorMessage: message || 'Location access was denied.'
    };
    this.notify();
  }

  setLocationError(message) {
    this.state.location = {
      status: 'ERROR',
      coords: null,
      errorMessage: message || 'Unable to determine your location.'
    };
    this.notify();
  }

  // Historical Crowd Pattern & Live Forecast Actions ------------------ //
  setHistoricalDept(dept) {
    this.state.selectedHistoricalDept = dept;
    this.notify();
  }

  setHistoricalDay(dayOfWeek) {
    this.state.selectedHistoricalDay = parseInt(dayOfWeek, 10) % 7;
    this.notify();
  }

  setHistoricalMetric(metric) {
    this.state.selectedHistoricalMetric = metric;
    this.notify();
  }

  setHistoricalPattern(pattern) {
    this.state.historicalPattern = pattern;
    this.notify();
  }

  setTodayCrowdForecast(forecast) {
    this.state.todayCrowdForecast = forecast;
    this.notify();
  }

  // Reset demo
  reset() {
    this.state = JSON.parse(JSON.stringify(this.defaultState));
    this.notify();
  }
}

export const store = new QueueStore();
