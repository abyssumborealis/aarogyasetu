/**
 * QUEUE — Application Bootstrapper (app.js)
 * Subscribes render to store, runs initial render, checks FastAPI backend health,
 * and wires user events / clicks to api.js and store methods.
 */

import { store } from './store.js';
import { api } from './api.js';
import { render } from './render.js';
import { SYSTEM_STATES } from './data.js';

// --------------------------------------------------------------------------- //
// 1. Subscription & Initial Render
// --------------------------------------------------------------------------- //
// Register render as the primary reactive listener on the store
store.listeners.add(render);

// Initial paint
render();

// Check FastAPI connectivity on boot
api.healthCheck();

// Re-check backend health periodically every 15 seconds
setInterval(() => {
  api.healthCheck();
}, 15000);

// --------------------------------------------------------------------------- //
// 2. Hash Routing
// --------------------------------------------------------------------------- //
function handleRoute() {
  const hash = window.location.hash.slice(1) || 'landing';
  const [routePart, queryPart] = hash.split('?');
  const params = {};

  if (queryPart) {
    const searchParams = new URLSearchParams(queryPart);
    for (const [key, val] of searchParams.entries()) {
      params[key] = val;
    }
  }

  store.setView(routePart, params);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('hashchange', handleRoute);
// Handle initial route on first page load
handleRoute();

// --------------------------------------------------------------------------- //
// 3. Delegated Event Handlers (Clicks & Submissions -> api.js & store)
// --------------------------------------------------------------------------- //
document.addEventListener('click', (e) => {
  // ---- Registration Step 1 Continue ----
  const step1Btn = e.target.closest('#step-1-continue-btn');
  if (step1Btn) {
    e.preventDefault();
    const selectedRadio = document.querySelector('input[name="patientStatus"]:checked');
    if (selectedRadio) {
      store.updateRegistrationDraft({ patientStatus: selectedRadio.value });
    }
    store.setRegistrationStep(2);
    return;
  }

  // ---- Registration Step 2 Back ----
  const step2Back = e.target.closest('#step-2-back-btn');
  if (step2Back) {
    e.preventDefault();
    store.setRegistrationStep(1);
    return;
  }

  // ---- Registration Step 3 Back ----
  const step3Back = e.target.closest('#step-3-back-btn');
  if (step3Back) {
    e.preventDefault();
    store.setRegistrationStep(2);
    return;
  }

  // ---- Radio Option Card Selection ----
  const radioCard = e.target.closest('.radio-option-card');
  if (radioCard && !e.target.matches('input[type="radio"]')) {
    const input = radioCard.querySelector('input[type="radio"]');
    if (input) {
      input.checked = true;
      const groupName = input.name;
      document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
        const parent = r.closest('.radio-option-card');
        if (parent) parent.classList.toggle('selected', r.checked);
      });
      if (groupName === 'patientStatus') {
        store.updateRegistrationDraft({ patientStatus: input.value });
      } else if (groupName === 'visitType') {
        store.updateRegistrationDraft({ visitType: input.value });
      }
    }
  }

  // ---- Pre-Registration Review: Confirm Intent ----
  const confirmPreregBtn = e.target.closest('#confirm-prereg-btn');
  if (confirmPreregBtn) {
    e.preventDefault();
    api.preRegisterVisit(store.getState().registrationDraft).then(() => {
      window.location.hash = '#pre-confirmed';
    });
    return;
  }

  // ---- Physical Check-In Arrival: "Check in now" Button ----
  const doCheckinBtn = e.target.closest('#do-checkin-btn');
  if (doCheckinBtn) {
    e.preventDefault();
    doCheckinBtn.classList.add('loading');
    doCheckinBtn.innerHTML = '<span class="btn-dot pulse"></span> Verifying Campus Network...';

    // Calls FastAPI /checkin/scan (or simulated fallback)
    api.checkInScan('station_central_01.992817').then(() => {
      window.location.hash = '#live-queue';
    });
    return;
  }

  // ---- Confirm Arrival at Consultation Room (CALLED state action) ----
  const confirmRoomBtn = e.target.closest('#confirm-arrival-room-btn');
  if (confirmRoomBtn) {
    e.preventDefault();
    store.setQueueState(SYSTEM_STATES.IN_CONSULTATION);
    store.showToast('Arrival confirmed at Room 4. Dr. Vance will begin consultation.', 'success');
    return;
  }

  // ---- Leave Queue Modal Open ----
  const leaveQueueOpenBtn = e.target.closest('#leave-queue-open-btn');
  if (leaveQueueOpenBtn) {
    e.preventDefault();
    store.openModal('leave-queue');
    return;
  }

  // ---- Leave Queue Modal Close / Cancel ----
  const modalCloseBtn = e.target.closest('#modal-close-x, #modal-cancel-btn');
  if (modalCloseBtn) {
    e.preventDefault();
    store.closeModal();
    return;
  }

  // ---- Leave Queue Modal Confirm ----
  const modalConfirmLeaveBtn = e.target.closest('#modal-confirm-leave-btn');
  if (modalConfirmLeaveBtn) {
    e.preventDefault();
    store.closeModal();
    api.leaveQueue().then(() => {
      window.location.hash = '#landing';
    });
    return;
  }

  // ---- Simulator Dock Toggle ----
  const simToggleBar = e.target.closest('#sim-dock-toggle-btn');
  if (simToggleBar) {
    e.preventDefault();
    store.toggleSimDock();
    return;
  }

  // ---- Simulator Step Forward (+1 Token Advance) ----
  const simStepBtn = e.target.closest('#sim-step-forward-btn');
  if (simStepBtn) {
    e.preventDefault();
    store.advanceQueue();
    return;
  }

  // ---- Simulator Arrive at Hospital ----
  const simArriveBtn = e.target.closest('#sim-arrive-btn');
  if (simArriveBtn) {
    e.preventDefault();
    window.location.hash = '#physical-checkin';
    return;
  }

  // ---- Simulator Audio Toggle ----
  const simAudioBtn = e.target.closest('#sim-audio-toggle-btn');
  if (simAudioBtn) {
    e.preventDefault();
    store.toggleAudioChime();
    return;
  }

  // ---- Simulator Reset All ----
  const simResetBtn = e.target.closest('#sim-reset-btn');
  if (simResetBtn) {
    e.preventDefault();
    store.reset();
    window.location.hash = '#landing';
    store.showToast('Operations state reset to factory baseline.', 'info');
    return;
  }

  // ---- Simulator State Jump Pills ----
  const statePill = e.target.closest('.state-pill[data-jump-state]');
  if (statePill) {
    e.preventDefault();
    const targetState = statePill.dataset.jumpState;
    store.setQueueState(targetState);
    if (targetState === SYSTEM_STATES.PRE_REGISTERED) {
      window.location.hash = '#pre-confirmed';
    } else {
      window.location.hash = '#live-queue';
    }
    return;
  }

  // ---- Simulator 1-Click Complete Journey Guided Demo ----
  const guidedDemoBtn = e.target.closest('#sim-guided-demo-btn');
  if (guidedDemoBtn) {
    e.preventDefault();
    runGuidedJourney();
    return;
  }

  // ---- Location-Based Hospital Discovery: "Use My Location" / "Try Again" / "Refresh Location" ----
  const useLocationBtn = e.target.closest('#use-my-location-btn');
  if (useLocationBtn) {
    e.preventDefault();
    requestUserLocation();
    return;
  }

  // ---- Filter Pills in Hospital Directory ----
  const filterPill = e.target.closest('.filter-pills .pill');
  if (filterPill) {
    const parentGroup = filterPill.closest('.filter-pills');
    parentGroup.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    filterPill.classList.add('active');

    // Handle district filtering
    if (filterPill.dataset.filterDistrict) {
      const district = filterPill.dataset.filterDistrict;
      filterHospitalCards();
    } else if (filterPill.dataset.filterType) {
      filterHospitalCards();
    } else if (filterPill.dataset.filterCrowd) {
      filterHospitalCards();
    }
    return;
  }
});

// --------------------------------------------------------------------------- //
// Form Submission Handlers
// --------------------------------------------------------------------------- //
document.addEventListener('submit', (e) => {
  // Step 2 Form
  if (e.target.id === 'step-2-form') {
    e.preventDefault();
    const idInput = document.getElementById('patient-id-input');
    const phoneInput = document.getElementById('patient-phone-input');
    store.updateRegistrationDraft({
      patientId: idInput ? idInput.value : 'MRN-84920',
      phone: phoneInput ? phoneInput.value : '+1 (555) 019-2834'
    });
    store.setRegistrationStep(3);
    return;
  }

  // Step 3 Form
  if (e.target.id === 'step-3-form') {
    e.preventDefault();
    const deptSelect = document.getElementById('department-select');
    const selectedRadio = document.querySelector('input[name="visitType"]:checked');
    store.updateRegistrationDraft({
      visitType: selectedRadio ? selectedRadio.value : 'appointment',
      departmentId: deptSelect ? deptSelect.value : 'gen-med'
    });
    window.location.hash = '#pre-review';
    return;
  }
});

// --------------------------------------------------------------------------- //
// Location-Based Hospital Discovery
// --------------------------------------------------------------------------- //
// Uses the browser's native Geolocation API only. No external maps/geocoding
// APIs are used. Coordinates stay in client-side app state (QueueStore) and
// are never written to the token, patient record, or any URL.
function requestUserLocation() {
  if (!('geolocation' in navigator)) {
    store.setLocationError('Your browser does not support location services. Please browse hospitals manually below.');
    return;
  }

  store.setLocationRequesting();

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      store.setLocationAvailable({ lat: latitude, lng: longitude });
    },
    (error) => {
      // GeolocationPositionError.PERMISSION_DENIED === 1
      if (error && error.code === 1) {
        store.setLocationDenied('Location access was denied. You can still browse hospitals manually below.');
      } else {
        store.setLocationError('We could not detect your location right now. Please browse hospitals manually below.');
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5 * 60 * 1000 // allow a cached fix up to 5 min old
    }
  );
}

// --------------------------------------------------------------------------- //
// Real-Time Search & Filtering in Hospital Directory
// --------------------------------------------------------------------------- //
document.addEventListener('input', (e) => {
  if (e.target.id === 'hospital-search-input') {
    filterHospitalCards();
  }
});

function filterHospitalCards() {
  const query = (document.getElementById('hospital-search-input')?.value || '').toLowerCase();
  const activeDistrictPill = document.querySelector('.pill[data-filter-district].active');
  const districtFilter = activeDistrictPill ? activeDistrictPill.dataset.filterDistrict : 'all';

  const cards = document.querySelectorAll('.hospital-card');
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    
    let matchesDistrict = true;
    if (districtFilter !== 'all') {
      matchesDistrict = text.includes(districtFilter.toLowerCase());
    }

    card.style.display = (matchesQuery && matchesDistrict) ? 'block' : 'none';
  });
}

// --------------------------------------------------------------------------- //
// Guided Walkthrough Runner (Automated Demonstration)
// --------------------------------------------------------------------------- //
function runGuidedJourney() {
  const steps = [
    {
      action: () => {
        window.location.hash = '#landing';
        store.showToast('Step 1: Patient discovers hospital crowd telemetry...', 'info', 2500);
      },
      delay: 0
    },
    {
      action: () => {
        window.location.hash = '#hospitals';
        store.showToast('Step 2: Inspecting facilities and comparative wait times...', 'info', 2500);
      },
      delay: 2600
    },
    {
      action: () => {
        window.location.hash = '#hospital-overview?id=city-hospital';
        store.showToast('Step 3: Reviewing City Hospital active clinical departments...', 'info', 2500);
      },
      delay: 5200
    },
    {
      action: () => {
        window.location.hash = '#access-type?hospital=city-hospital&dept=gen-med';
        store.showToast('Step 4: Choosing Pre-registration vs On-site check-in...', 'info', 2500);
      },
      delay: 7800
    },
    {
      action: () => {
        window.location.hash = '#register?flow=prereg';
        store.setRegistrationStep(1);
        store.showToast('Step 5: Patient Identification & Non-Clinical Routing...', 'info', 2500);
      },
      delay: 10400
    },
    {
      action: () => {
        store.setRegistrationStep(2);
      },
      delay: 12000
    },
    {
      action: () => {
        store.setRegistrationStep(3);
      },
      delay: 13500
    },
    {
      action: () => {
        window.location.hash = '#pre-review';
        store.showToast('Step 6: Reviewing pre-registration (Warning: not in physical queue)...', 'warning', 3000);
      },
      delay: 15000
    },
    {
      action: () => {
        api.preRegisterVisit(store.getState().registrationDraft);
        window.location.hash = '#pre-confirmed';
        store.showToast('Step 7: Pre-registration Confirmed (PRE-10482; Physical queue remains at 32)...', 'success', 3500);
      },
      delay: 18200
    },
    {
      action: () => {
        window.location.hash = '#physical-checkin';
        store.showToast('Step 8: Patient arrives at hospital. Campus geofence detected...', 'info', 3000);
      },
      delay: 22000
    },
    {
      action: () => {
        api.checkInScan('station_central_01.992817');
        window.location.hash = '#live-queue';
        store.showToast('Step 9: Physical check-in complete! Token G128 entered queue at #8.', 'success', 3500);
      },
      delay: 25500
    },
    {
      action: () => {
        store.setQueueState(SYSTEM_STATES.APPROACHING);
        store.showToast('Step 10: State APPROACHING (#2 / 1 ahead / 5 min wait)...', 'warning', 3500);
      },
      delay: 29500
    },
    {
      action: () => {
        store.setQueueState(SYSTEM_STATES.CALLED);
        store.showToast('Step 11: TOKEN G128 CALLED TO ROOM 4! (Web Audio chime sounding)...', 'success', 4000);
      },
      delay: 33500
    },
    {
      action: () => {
        store.setQueueState(SYSTEM_STATES.IN_CONSULTATION);
        store.showToast('Step 12: In consultation with Dr. Aris Vance.', 'info', 3500);
      },
      delay: 38000
    },
    {
      action: () => {
        store.setQueueState(SYSTEM_STATES.COMPLETED);
        store.showToast('Guided Journey Complete: Consultation finished & discharge logged!', 'success', 5000);
      },
      delay: 42000
    }
  ];

  steps.forEach(s => {
    setTimeout(s.action, s.delay);
  });
}

// Expose on window for testing and console inspection
window.queueApp = {
  store,
  api,
  render,
  runGuidedJourney
};

console.log('[App] QUEUE patient frontend booted successfully.');
