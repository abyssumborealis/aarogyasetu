/**
 * QUEUE — Pure DOM Renderer (render.js)
 * THE ONLY place that reads store state and writes to the DOM.
 * Formats every view with pixel-perfect Light Healthcare Design System classes.
 */

import { store } from './store.js';
import { SYSTEM_STATES, HOSPITALS, getHospital, getDepartment, getHospitalsWithDistance, formatDistance } from './data.js';
import { fmtClock, fmtWindow, fmtDayLabel, localDateString } from './timefmt.js';

export function render() {
  const state = store.getState();

  // 1. Header System / FastAPI connectivity
  renderHeaderStatus(state);

  // 2. Header Active User Token Badge
  renderHeaderBadge(state);

  // 3. Main View Dispatch
  renderMainView(state);

  // 4. Modal Layer
  renderModal(state);

  // 5. Toast Notifications
  renderToasts(state);

  // 6. Queue Operations Simulator Dock
  renderSimulatorDock(state);
}

// --------------------------------------------------------------------------- //
// 1. Header Status Indicator
// --------------------------------------------------------------------------- //
function renderHeaderStatus(state) {
  const el = document.getElementById('system-status-indicator');
  const textEl = document.getElementById('system-status-text');
  if (!el || !textEl) return;

  if (state.backendConnected) {
    el.className = 'system-status-indicator connected';
    textEl.textContent = 'FASTAPI CONNECTED (PORT 8000)';
    el.title = 'Real-time REST connection to FastAPI backend active';
  } else {
    el.className = 'system-status-indicator';
    textEl.textContent = 'LOCAL SIMULATION MODE';
    el.title = 'FastAPI server not detected on :8000. Running with automatic operational simulation.';
  }
}

// --------------------------------------------------------------------------- //
// 2. Header Active Token Badge
// --------------------------------------------------------------------------- //
function renderHeaderBadge(state) {
  const badgeMount = document.getElementById('header-user-badge');
  if (!badgeMount) return;

  const hasToken = state.token && state.token.display_code;
  const isCheckedIn = state.queueState !== SYSTEM_STATES.PRE_REGISTERED && state.queueState !== SYSTEM_STATES.LEFT_QUEUE;

  if (hasToken && isCheckedIn) {
    badgeMount.innerHTML = `
      <a href="#live-queue" class="active-token-pill" title="Go to your live queue screen">
        <span class="active-pulse-dot"></span>
        <span class="token-text mono">Token ${state.token.display_code} (#${state.position})</span>
      </a>
    `;
  } else if (hasToken && state.queueState === SYSTEM_STATES.PRE_REGISTERED) {
    badgeMount.innerHTML = `
      <a href="#pre-confirmed" class="active-token-pill pre-reg" title="View pre-registration pass">
        <span class="holding-dot"></span>
        <span class="token-text mono">Pre-Reg ${state.patient.preRegCode}</span>
      </a>
    `;
  } else {
    badgeMount.innerHTML = '';
  }
}

// --------------------------------------------------------------------------- //
// 3. Main View Dispatcher
// --------------------------------------------------------------------------- //
function renderMainView(state) {
  const mount = document.getElementById('app-mount');
  if (!mount) return;

  updateActiveNavLink(state.currentView);

  switch (state.currentView) {
    case 'landing':
      mount.innerHTML = renderLandingView(state);
      break;
    case 'hospitals':
      mount.innerHTML = renderHospitalsView(state);
      break;
    case 'hospital-overview':
      mount.innerHTML = renderHospitalOverviewView(state);
      break;
    case 'access-type':
      mount.innerHTML = renderAccessTypeView(state);
      break;
    case 'register':
      mount.innerHTML = renderRegisterView(state);
      break;
    case 'pre-review':
      mount.innerHTML = renderPreReviewView(state);
      break;
    case 'pre-confirmed':
      mount.innerHTML = renderPreConfirmedView(state);
      break;
    case 'physical-checkin':
      mount.innerHTML = renderPhysicalCheckinView(state);
      break;
    case 'live-queue':
      mount.innerHTML = renderLiveQueueView(state);
      break;
    case 'crowd-telemetry':
      mount.innerHTML = renderCrowdTelemetryView(state);
      break;
    case 'how-it-works':
      mount.innerHTML = renderHowItWorksView(state);
      break;
    case 'for-hospitals':
      mount.innerHTML = renderForHospitalsView(state);
      break;
    case 'about':
      mount.innerHTML = renderAboutView(state);
      break;
    default:
      mount.innerHTML = renderLandingView(state);
      break;
  }
}

function updateActiveNavLink(currentView) {
  const navMap = {
    'hospitals': 'nav-hospitals',
    'hospital-overview': 'nav-hospitals',
    'crowd-telemetry': 'nav-crowd',
    'how-it-works': 'nav-how',
    'for-hospitals': 'nav-hospitals-admin',
    'about': 'nav-about'
  };
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
  const activeId = navMap[currentView];
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) el.classList.add('active');
  }
}

// --------------------------------------------------------------------------- //
// View: Landing Page
// --------------------------------------------------------------------------- //
function renderLandingView(state) {
  const cityHospital = getHospital('city-hospital');
  const genMed = cityHospital.departments.find(d => d.id === 'gen-med');

  return `
    <div class="landing-page">
      <section class="landing-hero-section">
        <div class="landing-hero-grid">
          <div class="hero-content">
            <div class="telemetry-pill">
              <span class="pulse-indicator"></span>
              <span class="telemetry-pill-text">REGIONAL PATIENT FLOW INTELLIGENCE • 48 HOSPITALS MONITORED</span>
            </div>

            <h1 class="hero-headline">Know the queue before you wait.</h1>

            <p class="hero-supporting-text">
              See hospital crowd levels, estimate your waiting time, and join the right queue without standing in line unnecessarily.
            </p>

            <div class="hero-cta-group">
              <a href="#hospitals" class="btn btn-primary btn-lg" id="cta-find-hospital">
                Find a Hospital
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
              </a>
              <a href="#how-it-works" class="btn btn-secondary btn-lg">
                How It Works
              </a>
            </div>

            <div class="hero-stats-row">
              <div class="hero-stat-item">
                <span class="hero-stat-val mono">31 min</span>
                <span class="hero-stat-lbl">Regional Avg Wait</span>
              </div>
              <div class="hero-stat-sep">/</div>
              <div class="hero-stat-item">
                <span class="hero-stat-val mono">94.2%</span>
                <span class="hero-stat-lbl">ETA Accuracy</span>
              </div>
              <div class="hero-stat-sep">/</div>
              <div class="hero-stat-item">
                <span class="hero-stat-val mono">0 PHI</span>
                <span class="hero-stat-lbl">Privacy Guarantee</span>
              </div>
            </div>
          </div>

          <!-- Live system visual preview on the right -->
          <div class="hero-visual-side">
            <div class="live-telemetry-preview-card">
              <div class="preview-card-header">
                <div class="preview-header-left">
                  <span class="dept-lead mono">CITY HOSPITAL</span>
                  <h3 class="dept-title">GENERAL MEDICINE</h3>
                </div>
                <div class="preview-badge-row">
                  <span class="live-pulse-badge">
                    <span class="pulse-dot"></span> LIVE TELEMETRY
                  </span>
                </div>
              </div>

              <div class="preview-metric-hero">
                <div class="preview-metric-number mono">
                  32
                </div>
                <div class="preview-metric-sub">
                  patients waiting in physical queue
                </div>
              </div>

              <div class="preview-details-grid">
                <div class="preview-detail-cell">
                  <span class="cell-label">Estimated wait</span>
                  <span class="cell-val mono highlight-cyan">28–35 min</span>
                </div>
                <div class="preview-detail-cell">
                  <span class="cell-label">Crowd trend</span>
                  <span class="cell-val mono highlight-emerald">↓ Decreasing</span>
                </div>
                <div class="preview-detail-cell">
                  <span class="cell-label">Currently Serving</span>
                  <span class="cell-val mono highlight-white">G121</span>
                </div>
              </div>

              <div class="preview-card-footer">
                <div class="preview-footer-note">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  Real-time admissions telemetry • Updated 12s ago
                </div>
                <a href="#hospital-overview?id=city-hospital" class="btn btn-primary btn-sm">
                  Inspect Facility Queue
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Operational Architecture Highlights -->
      <section class="landing-features-section">
        <div class="section-container">
          <div class="section-title-wrap text-center">
            <span class="section-eyebrow">INTELLIGENCE PLATFORM CAPABILITIES</span>
            <h2 class="section-headline">Engineered for patient flow transparency</h2>
            <p class="section-subtext">A universal operational layer operating across both public health networks and private medical systems.</p>
          </div>

          <div class="features-grid-3">
            <div class="feature-card">
              <div class="feature-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><polyline points="17 11 19 13 23 9"></polyline></svg>
              </div>
              <h3 class="feature-title">Separation of Intent & Physical Queue</h3>
              <p class="feature-desc">
                Pre-registration logs intent without distorting the physical queue. Only verified on-site arrivals enter the live triage line.
              </p>
            </div>

            <div class="feature-card">
              <div class="feature-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              </div>
              <h3 class="feature-title">Multi-Hospital Crowd Radar</h3>
              <p class="feature-desc">
                Compare real-time crowd velocities, wait forecasts, and active consultation rates across regional healthcare centers before traveling.
              </p>
            </div>

            <div class="feature-card">
              <div class="feature-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              </div>
              <h3 class="feature-title">Zero PHI Exposure</h3>
              <p class="feature-desc">
                Operates purely on token telemetry and throughput mathematics. Medical records, clinical histories, and diagnoses never leave hospital walls.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// View: Hospital Selection Directory
// --------------------------------------------------------------------------- //
function renderHospitalsView(state) {
  const hospitals = HOSPITALS;

  return `
    <div class="page-container">
      <div class="page-header">
        <div class="page-breadcrumb">
          <a href="#landing">QUEUE</a> <span class="crumb-sep">/</span> <span>Select Facility</span>
        </div>
        <h1 class="page-title">Select a hospital</h1>
        <p class="page-subtitle">Choose the hospital you plan to visit to view live queue conditions and access admissions.</p>
      </div>

      ${renderLocationDiscoverySection(state)}

      <div class="filter-controls-card">
        <div class="search-field-wrap">
          <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="hospital-search" class="form-input search-input" placeholder="Search hospitals by name, district, or specialty..." />
        </div>

        <div class="filter-pills-row">
          <div class="filter-category">
            <span class="filter-category-label">Location:</span>
            <div class="filter-buttons" data-filter="district">
              <button class="filter-pill active" data-val="all">All Districts</button>
              <button class="filter-pill" data-val="Central District">Central</button>
              <button class="filter-pill" data-val="North Hub">North Hub</button>
              <button class="filter-pill" data-val="West Valley">West Valley</button>
              <button class="filter-pill" data-val="Metro South">Metro South</button>
            </div>
          </div>

          <div class="filter-category">
            <span class="filter-category-label">Type:</span>
            <div class="filter-buttons" data-filter="type">
              <button class="filter-pill active" data-val="all">All Facilities</button>
              <button class="filter-pill" data-val="Public Hospital">Public</button>
              <button class="filter-pill" data-val="Private Hospital">Private</button>
            </div>
          </div>

          <div class="filter-category">
            <span class="filter-category-label">Crowd:</span>
            <div class="filter-buttons" data-filter="crowd">
              <button class="filter-pill active" data-val="all">Any Crowd</button>
              <button class="filter-pill" data-val="Low">Low</button>
              <button class="filter-pill" data-val="Moderate">Moderate</button>
              <button class="filter-pill" data-val="High">High</button>
            </div>
          </div>
        </div>
      </div>

      <div class="synthetic-disclaimer-banner">
        <span class="disclaimer-dot"></span>
        <span class="disclaimer-text">Simulated Regional Telemetry: Live metrics reflect dynamic synthetic facility models.</span>
      </div>

      <div class="hospitals-grid" id="hospitals-grid-container">
        ${hospitals.map(h => renderHospitalCard(h)).join('')}
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// Location-Based Hospital Discovery (client-side, browser Geolocation API)
// --------------------------------------------------------------------------- //
function renderLocationDiscoverySection(state) {
  const location = state.location || { status: 'NOT_REQUESTED' };

  if (location.status === 'AVAILABLE' && location.coords) {
    const nearby = getHospitalsWithDistance(location.coords.lat, location.coords.lng);

    return `
      <div class="location-discovery-card is-active">
        <div class="location-discovery-header">
          <div>
            <h2 class="location-discovery-title">Hospitals Near You</h2>
            <p class="location-discovery-subtitle">
              <span class="location-detected-tag">Location detected ✓</span>
              Sorted by distance from your current location.
            </p>
          </div>
          <button type="button" id="use-my-location-btn" class="btn btn-secondary btn-sm">↺ Refresh Location</button>
        </div>

        <div class="nearby-hospitals-list">
          ${nearby.map((h, i) => renderNearbyHospitalRow(h, i === 0)).join('')}
        </div>
      </div>
    `;
  }

  if (location.status === 'REQUESTING') {
    return `
      <div class="location-discovery-card">
        <div class="location-discovery-header">
          <div>
            <h2 class="location-discovery-title">Find a hospital near you</h2>
            <p class="location-discovery-subtitle">Requesting your location&hellip; check your browser's permission prompt.</p>
          </div>
          <button type="button" class="btn btn-primary btn-sm" disabled>
            <span class="pulse-dot"></span> Locating&hellip;
          </button>
        </div>
      </div>
    `;
  }

  if (location.status === 'DENIED' || location.status === 'ERROR') {
    return `
      <div class="location-discovery-card">
        <div class="location-discovery-header">
          <div>
            <h2 class="location-discovery-title">Find a hospital near you</h2>
            <p class="location-discovery-subtitle location-status-message">
              ${location.errorMessage || 'Location is unavailable. You can still browse hospitals manually below.'}
            </p>
          </div>
          <button type="button" id="use-my-location-btn" class="btn btn-secondary btn-sm">📍 Try Again</button>
        </div>
      </div>
    `;
  }

  // NOT_REQUESTED — initial state
  return `
    <div class="location-discovery-card">
      <div class="location-discovery-header">
        <div>
          <h2 class="location-discovery-title">Find a hospital near you</h2>
          <p class="location-discovery-subtitle">Use your current location to find hospitals near you.</p>
        </div>
        <button type="button" id="use-my-location-btn" class="btn btn-primary btn-sm">📍 Use My Location</button>
      </div>
    </div>
  `;
}

function renderNearbyHospitalRow(hospital, isNearest) {
  return `
    <div class="nearby-hospital-row ${isNearest ? 'is-nearest' : ''}" data-hospital-id="${hospital.id}">
      <div class="nearby-hospital-info">
        <div class="nearby-hospital-name-row">
          <span class="nearby-hospital-name">${hospital.name}</span>
          ${isNearest ? '<span class="nearest-badge">NEAREST TO YOU</span>' : ''}
        </div>
        <div class="nearby-hospital-meta">
          <span class="nearby-hospital-distance">📍 ${formatDistance(hospital.distanceKm)}</span>
          <span class="crowd-pill crowd-${hospital.overallCrowd.toLowerCase()}">${hospital.overallCrowd}</span>
        </div>
      </div>
      <a href="#hospital-overview?id=${hospital.id}" class="btn btn-primary btn-sm">
        Select Hospital
        <svg class="icon-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
      </a>
    </div>
  `;
}

function renderHospitalCard(hospital) {
  const primaryDept = hospital.departments.find(d => d.id === 'gen-med') || hospital.departments[0];
  const isCityHospital = hospital.id === 'city-hospital';

  return `
    <div class="hospital-card ${isCityHospital ? 'is-featured' : ''}" data-hospital-id="${hospital.id}">
      <div class="hospital-card-header">
        <div class="facility-title-wrap">
          <div class="facility-badge-row">
            <span class="facility-type-tag">${hospital.type}</span>
            <span class="facility-district-tag">${hospital.district}</span>
            <span class="facility-status-tag status-open">
              <span class="dot-indicator"></span> Open
            </span>
          </div>
          <h3 class="facility-name">${hospital.name}</h3>
          <p class="facility-address">${hospital.address}</p>
        </div>
      </div>

      <div class="hospital-telemetry-grid">
        <div class="telemetry-cell">
          <div class="cell-label">${primaryDept.name} Queue</div>
          <div class="cell-value mono highlight-cyan">
            <strong>${primaryDept.waitingCount}</strong> <span class="unit">waiting</span>
          </div>
          <div class="cell-footnote">Physically on site</div>
        </div>

        <div class="telemetry-cell">
          <div class="cell-label">Estimated Wait</div>
          <div class="cell-value mono">${primaryDept.estimatedWait}</div>
          <div class="cell-footnote">
            <span class="trend-badge trend-${primaryDept.trend.toLowerCase()}">
              ${primaryDept.trend === 'Decreasing' ? '↓ Decreasing' : primaryDept.trend === 'Increasing' ? '↑ Increasing' : '→ Steady'}
            </span>
          </div>
        </div>

        <div class="telemetry-cell">
          <div class="cell-label">Active Crowd</div>
          <div class="cell-value">
            <span class="crowd-pill crowd-${hospital.overallCrowd.toLowerCase()}">${hospital.overallCrowd}</span>
          </div>
          <div class="cell-footnote">${hospital.departments.length} Depts Active</div>
        </div>
      </div>

      <div class="hospital-card-footer">
        <div class="total-checkedin-indicator">
          <span class="mono">${hospital.checkedInCount}</span> physical visitors total
        </div>
        <a href="#hospital-overview?id=${hospital.id}" class="btn btn-primary btn-sm">
          Select Hospital
          <svg class="icon-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </a>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// View: Hospital Overview
// --------------------------------------------------------------------------- //
function renderHospitalOverviewView(state) {
  const hospital = getHospital(state.activeHospitalId);

  return `
    <div class="page-container">
      <div class="page-header">
        <div class="page-breadcrumb">
          <a href="#landing">QUEUE</a> <span class="crumb-sep">/</span>
          <a href="#hospitals">Facilities</a> <span class="crumb-sep">/</span>
          <span>${hospital.name}</span>
        </div>
        <div class="facility-badge-row" style="margin-top: 8px;">
          <span class="facility-type-tag">${hospital.type}</span>
          <span class="facility-district-tag">${hospital.district}</span>
          <span class="facility-status-tag status-open"><span class="dot-indicator"></span> ${hospital.status}</span>
        </div>
        <h1 class="page-title">${hospital.name}</h1>
        <p class="facility-meta-line">
          <span>${hospital.address}</span> •
          <span>${hospital.hours}</span>
        </p>
      </div>

      <!-- Facility Operational Status Bar -->
      <div class="kpi-telemetry-bar">
        <div class="kpi-item">
          <span class="section-label">OVERALL CROWD</span>
          <div class="kpi-val-row">
            <span class="crowd-pill crowd-${hospital.overallCrowd.toLowerCase()}">${hospital.overallCrowd.toUpperCase()}</span>
            <span class="metric-trend-inline ${hospital.trend === 'Decreasing' ? 'text-success' : 'text-muted'}">
              ${hospital.trend === 'Decreasing' ? '↓ Decreasing' : '→ Steady'}
            </span>
          </div>
          <span class="kpi-subtext">Aggregated telemetry</span>
        </div>

        <div class="kpi-divider"></div>

        <div class="kpi-item">
          <span class="section-label">PATIENTS CHECKED IN</span>
          <div class="kpi-val mono">${hospital.checkedInCount}</div>
          <span class="kpi-subtext">Physically on premise</span>
        </div>

        <div class="kpi-divider"></div>

        <div class="kpi-item">
          <span class="section-label">ACTIVE DEPARTMENTS</span>
          <div class="kpi-val mono">${hospital.departments.length}</div>
          <span class="kpi-subtext">Clinical services operating</span>
        </div>

        <div class="kpi-divider"></div>

        <div class="kpi-item">
          <span class="section-label">AVERAGE WAIT</span>
          <div class="kpi-val mono" style="color: var(--primary);">${hospital.avgWait}</div>
          <span class="kpi-subtext">Current facility pace</span>
        </div>
      </div>

      <!-- Clinical Departments Grid -->
      <div class="overview-section">
        <div class="section-subhead-row">
          <div>
            <h2 class="subhead-title">Clinical Departments & Live Queue Load</h2>
            <p class="subhead-desc">Select a department to view or join its active queue.</p>
          </div>
          <div class="important-distinction-tag">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <span>Numbers represent physically checked-in patients only</span>
          </div>
        </div>

        <div class="departments-grid">
          ${hospital.departments.map(dept => renderDepartmentCard(hospital.id, dept)).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderDepartmentCard(hospitalId, dept) {
  return `
    <div class="department-card" data-dept-id="${dept.id}">
      <div class="department-card-top">
        <div>
          <span class="dept-prefix-badge mono">Prefix ${dept.prefix}</span>
          <h3 class="dept-name">${dept.name}</h3>
          <div class="dept-sub-info">
            <span>${dept.roomsActive} rooms active</span> •
            <span>${dept.doctorsOnDuty} doctors on duty</span>
          </div>
        </div>
        <span class="crowd-pill crowd-${dept.crowdLevel.toLowerCase()}">${dept.crowdLevel.toUpperCase()}</span>
      </div>

      <div class="dept-metrics-grid">
        <div class="dept-metric-box">
          <span class="section-label">Queue</span>
          <div class="dept-metric-value mono" style="color: var(--primary);">${dept.waitingCount}</div>
          <span class="dept-metric-note">waiting</span>
        </div>

        <div class="dept-metric-box">
          <span class="section-label">Est. Wait</span>
          <div class="dept-metric-value mono" style="font-size: 1.05rem;">${dept.estimatedWait}</div>
          <span class="dept-metric-note">${dept.trend}</span>
        </div>

        <div class="dept-metric-box">
          <span class="section-label">Serving</span>
          <div class="dept-metric-value mono">${dept.currentServing}</div>
          <span class="dept-metric-note">${dept.floor}</span>
        </div>
      </div>

      <div class="department-card-actions">
        <a href="#access-type?hospital=${hospitalId}&dept=${dept.id}" class="btn btn-primary btn-block">
          Join / Pre-register
        </a>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// View: Queue Access Type Choice
// --------------------------------------------------------------------------- //
function renderAccessTypeView(state) {
  const hospital = getHospital(state.activeHospitalId);
  const dept = getDepartment(state.activeHospitalId, state.activeDeptId);

  return `
    <div class="page-container max-w-content">
      <div class="page-header text-center">
        <div class="page-breadcrumb">
          <span>${hospital.name}</span> <span class="crumb-sep">/</span>
          <span>${dept.name}</span>
        </div>
        <h1 class="page-title">How would you like to access the queue?</h1>
        <p class="page-subtitle">Choose your entry path based on whether you are currently at the facility.</p>
      </div>

      <div class="access-choice-grid">
        <!-- Option A: Pre-register -->
        <div class="access-choice-card">
          <div class="card-tag">OPTION A</div>
          <div class="choice-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
          </div>
          <h2 class="choice-heading">Pre-register your visit</h2>
          <p class="choice-description">
            Planning to visit later? Register in advance and confirm your arrival when you reach the hospital.
          </p>

          <div class="choice-important-note">
            <span class="note-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            </span>
            <div class="note-text">
              <strong>Important note:</strong> Pre-registration does not place you in the physical queue.
            </div>
          </div>

          <div class="choice-card-footer">
            <a href="#register?flow=prereg" class="btn btn-secondary btn-lg btn-block">
              Pre-register
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </a>
          </div>
        </div>

        <!-- Option B: Physical Check-In -->
        <div class="access-choice-card is-checkin">
          <div class="card-tag highlight-tag">OPTION B — ON SITE</div>
          <div class="choice-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          </div>
          <h2 class="choice-heading">I'm at the hospital</h2>
          <p class="choice-description">
            Already at the hospital? Confirm your arrival and enter the current physical queue.
          </p>

          <div class="choice-important-note on-site-note">
            <span class="note-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </span>
            <div class="note-text">
              <strong>Instant Queue Placement:</strong> You will immediately receive your official token (e.g. G128).
            </div>
          </div>

          <div class="choice-card-footer">
            <a href="#physical-checkin" class="btn btn-primary btn-lg btn-block">
              Check in now
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </a>
          </div>
        </div>
      </div>

      <!-- Key Distinctions Table -->
      <div class="distinctions-table-container">
        <table class="distinctions-table">
          <thead>
            <tr>
              <th>KEY DISTINCTIONS</th>
              <th>PRE-REGISTRATION</th>
              <th>PHYSICAL CHECK-IN</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="dim-label">Your Location</td>
              <td>At home / En route</td>
              <td class="highlight-cyan font-bold">Inside hospital facility</td>
            </tr>
            <tr>
              <td class="dim-label">Reference Assigned</td>
              <td>Pre-registration code (<span class="mono">PRE-10482</span>)</td>
              <td class="highlight-cyan mono font-bold">Official Queue Token (G128)</td>
            </tr>
            <tr>
              <td class="dim-label">Impact on Waiting Room</td>
              <td><strong>None</strong> (placed in Expected Roster)</td>
              <td class="highlight-cyan font-bold">Increases physical queue by 1</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// View: 3-Step Patient Identification Form
// --------------------------------------------------------------------------- //
function renderRegisterView(state) {
  const hospital = getHospital(state.activeHospitalId);
  const dept = getDepartment(state.activeHospitalId, state.activeDeptId);
  const step = state.registrationStep || 1;
  const draft = state.registrationDraft;

  return `
    <div class="page-container max-w-content">
      <div class="page-header text-center">
        <div class="page-breadcrumb">
          <span>${hospital.name}</span> <span class="crumb-sep">/</span>
          <span>${dept.name}</span> <span class="crumb-sep">/</span>
          <span class="highlight-cyan">Pre-Registration</span>
        </div>
        <h1 class="page-title">Patient Identification & Routing</h1>
        <p class="page-subtitle">Provide your patient reference to secure your queue tracking session.</p>
      </div>

      <div class="registration-form-container">
        <div class="registration-form-card">
          <div class="form-progress-tracker">
            <div class="progress-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}" data-step="1">
              <span class="step-num">01</span>
              <span class="step-label">Patient Status</span>
            </div>
            <div class="step-line"></div>
            <div class="progress-step ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}" data-step="2">
              <span class="step-num">02</span>
              <span class="step-label">Identification</span>
            </div>
            <div class="step-line"></div>
            <div class="progress-step ${step === 3 ? 'active' : ''}" data-step="3">
              <span class="step-num">03</span>
              <span class="step-label">Visit Type</span>
            </div>
          </div>

          <div class="form-body-wrapper">
            ${step === 1 ? renderStep1(draft, hospital) : step === 2 ? renderStep2(draft) : renderStep3(draft, hospital, state)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderStep1(draft, hospital) {
  return `
    <div class="form-section active" id="form-step-1">
      <div class="section-intro">
        <span class="section-eyebrow">Verification Step 1 of 3</span>
        <h3 class="section-title">Are you already registered at this hospital?</h3>
        <p class="section-desc">If you have previously visited ${hospital.name}, your records are already in their system.</p>
      </div>

      <div class="option-selection-grid">
        <label class="choice-card ${draft.patientStatus === 'existing' ? 'selected' : ''}">
          <input type="radio" name="patientStatus" value="existing" ${draft.patientStatus === 'existing' ? 'checked' : ''} />
          <div class="choice-content">
            <div class="choice-title">Yes, I have a patient ID</div>
            <div class="choice-subtitle">Hospital Registration Number / MRN issued previously</div>
          </div>
          <div class="choice-radio-custom"></div>
        </label>

        <label class="choice-card ${draft.patientStatus === 'new' ? 'selected' : ''}">
          <input type="radio" name="patientStatus" value="new" ${draft.patientStatus === 'new' ? 'checked' : ''} />
          <div class="choice-content">
            <div class="choice-title">No, I'm a new patient</div>
            <div class="choice-subtitle">First time visiting this facility or no prior ID</div>
          </div>
          <div class="choice-radio-custom"></div>
        </label>

        <label class="choice-card ${draft.patientStatus === 'unsure' ? 'selected' : ''}">
          <input type="radio" name="patientStatus" value="unsure" ${draft.patientStatus === 'unsure' ? 'checked' : ''} />
          <div class="choice-content">
            <div class="choice-title">I'm not sure</div>
            <div class="choice-subtitle">We will look up your registration via mobile number</div>
          </div>
          <div class="choice-radio-custom"></div>
        </label>
      </div>

      <div class="form-actions-bar">
        <a href="#access-type" class="btn btn-secondary">Back</a>
        <button type="button" id="step-1-continue-btn" class="btn btn-primary btn-lg">
          Continue
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
    </div>
  `;
}

function renderStep2(draft) {
  return `
    <div class="form-section active" id="form-step-2">
      <div class="section-intro">
        <span class="section-eyebrow">Verification Step 2 of 3</span>
        <h3 class="section-title">Enter your patient details</h3>
        <p class="section-desc">Used strictly for queue session binding. Zero medical records or symptoms are requested.</p>
      </div>

      <form id="step-2-form">
        <div class="form-group">
          <label class="form-label">PATIENT IDENTIFIER / MRN</label>
          <input type="text" id="patient-id-input" class="form-input mono" value="${draft.patientId || 'MRN-84920'}" required />
          <span class="form-hint">Format: MRN-XXXXX as printed on your appointment card</span>
        </div>

        <div class="form-group">
          <label class="form-label">MOBILE PHONE NUMBER</label>
          <input type="tel" id="patient-phone-input" class="form-input mono" value="${draft.phone || '+1 (555) 019-2834'}" required />
          <span class="form-hint">Used for SMS queue turn notifications</span>
        </div>

        <div class="form-actions-bar">
          <button type="button" id="step-2-back-btn" class="btn btn-secondary">Back</button>
          <button type="submit" class="btn btn-primary btn-lg">Continue to Visit Type →</button>
        </div>
      </form>
    </div>
  `;
}

function renderStep3(draft, hospital, state) {
  const canContinue = slotIsReady(state);
  return `
    <div class="form-section active" id="form-step-3">
      <div class="section-intro">
        <span class="section-eyebrow">Verification Step 3 of 3</span>
        <h3 class="section-title">Select visit category & department</h3>
        <p class="section-desc">Triage priority is determined exclusively by certified triage staff on arrival.</p>
      </div>

      <form id="step-3-form">
        <div class="option-selection-grid">
          <label class="choice-card ${draft.visitType === 'appointment' ? 'selected' : ''}">
            <input type="radio" name="visitType" value="appointment" ${draft.visitType === 'appointment' ? 'checked' : ''} />
            <div class="choice-content">
              <div class="choice-title">Scheduled Appointment</div>
              <div class="choice-subtitle">I have a confirmed booking with an Appointment ID</div>
            </div>
            <div class="choice-radio-custom"></div>
          </label>

          <label class="choice-card ${draft.visitType === 'followup' ? 'selected' : ''}">
            <input type="radio" name="visitType" value="followup" ${draft.visitType === 'followup' ? 'checked' : ''} />
            <div class="choice-content">
              <div class="choice-title">Follow-up Consultation</div>
              <div class="choice-subtitle">Review within 14 days of previous examination</div>
            </div>
            <div class="choice-radio-custom"></div>
          </label>

          <label class="choice-card ${draft.visitType === 'walkin' ? 'selected' : ''}">
            <input type="radio" name="visitType" value="walkin" ${draft.visitType === 'walkin' ? 'checked' : ''} />
            <div class="choice-content">
              <div class="choice-title">General Outpatient Visit</div>
              <div class="choice-subtitle">Routine consultation without prior appointment</div>
            </div>
            <div class="choice-radio-custom"></div>
          </label>
        </div>

        <div class="form-group" style="margin-top: 20px;">
          <label class="form-label">CLINICAL DEPARTMENT</label>
          <select id="department-select" class="form-input">
            ${hospital.departments.map(d => `
              <option value="${d.id}" ${draft.departmentId === d.id ? 'selected' : ''}>${d.name} (${d.waitingCount} waiting)</option>
            `).join('')}
          </select>
        </div>

        ${renderSlotSection(state)}

        <div class="form-actions-bar">
          <button type="button" id="step-3-back-btn" class="btn btn-secondary">Back</button>
          <button type="submit" class="btn btn-primary btn-lg" ${canContinue ? '' : 'disabled'}>Review Pre-Registration →</button>
        </div>
      </form>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// Requested consultation time: pickers + "Check availability" result
// --------------------------------------------------------------------------- //
// Mirrors backend settings.max_advance_days; the server is the authority and rejects anything beyond it.
const MAX_ADVANCE_DAYS = 7;

const CONGESTION_LABELS = { low: 'Quiet', medium: 'Moderate', high: 'Busy', critical: 'Very busy' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** 15-minute slots, 08:00-19:45. The server validates against real opening hours and doctor shifts. */
function timeSlotOptions(selected) {
  const options = ['<option value="">Select a time</option>'];
  for (let minutes = 8 * 60; minutes < 20 * 60; minutes += 15) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    const label = new Date(`2000-01-01T${hh}:${mm}:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    options.push(`<option value="${hh}:${mm}" ${selected === `${hh}:${mm}` ? 'selected' : ''}>${label}</option>`);
  }
  return options.join('');
}

/** True only for an available result that answers the CURRENT department/date/time. */
function slotIsReady(state) {
  const plan = state.arrivalPlan;
  return Boolean(plan && plan.status === 'ready' && plan.available && plan.key === store.arrivalKey());
}

function renderSlotSection(state) {
  const minDate = localDateString();
  const maxDate = localDateString(new Date(Date.now() + MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000));

  return `
    <div class="slot-section">
      <label class="form-label">PREFERRED CONSULTATION TIME</label>
      <div class="slot-fields">
        <div class="form-group">
          <label class="slot-field-label" for="desired-date-input">Date</label>
          <input type="date" id="desired-date-input" class="form-input"
                 value="${esc(state.desiredDate)}" min="${minDate}" max="${maxDate}" />
        </div>
        <div class="form-group">
          <label class="slot-field-label" for="desired-time-select">Time</label>
          <select id="desired-time-select" class="form-input">${timeSlotOptions(state.desiredTime)}</select>
        </div>
      </div>
      <button type="button" id="check-availability-btn" class="btn btn-secondary">Check availability</button>
      ${renderArrivalPlanCard(state.arrivalPlan)}
    </div>
  `;
}

function renderArrivalPlanCard(plan) {
  if (!plan) {
    return `<p class="slot-hint">Choose a date and time, then check availability to see when to arrive.</p>`;
  }
  if (plan.status === 'loading') {
    return `<div class="arrival-plan-card is-loading" role="status">Checking availability…</div>`;
  }
  if (plan.status === 'error') {
    return `
      <div class="arrival-plan-card is-unavailable" role="alert">
        <div class="arrival-plan-head"><span class="arrival-plan-badge">Couldn't check</span></div>
        <p class="arrival-plan-message">${esc(plan.message)}</p>
      </div>`;
  }

  const tz = plan.timezone;
  if (!plan.available) {
    const earliest = plan.earliest_available_at
      ? `<button type="button" id="use-earliest-btn" class="btn btn-secondary btn-sm"
                 data-iso="${esc(plan.earliest_available_at)}" data-tz="${esc(tz)}">
           Use ${fmtClock(plan.earliest_available_at, tz)} instead
         </button>`
      : '';
    return `
      <div class="arrival-plan-card is-unavailable" role="alert">
        <div class="arrival-plan-head"><span class="arrival-plan-badge">Not available</span></div>
        <p class="arrival-plan-message">${esc(plan.message)}</p>
        ${earliest}
      </div>`;
  }

  const level = plan.congestion_level || 'medium';
  return `
    <div class="arrival-plan-card is-available" role="status">
      <div class="arrival-plan-head">
        <span class="arrival-plan-badge">Slot available</span>
        <span class="arrival-plan-congestion level-${esc(level)}">${CONGESTION_LABELS[level] || esc(level)}</span>
      </div>
      <div class="arrival-plan-window">
        <span class="arrival-plan-label">ARRIVE BETWEEN</span>
        <strong class="arrival-plan-time mono">${fmtWindow(plan.arrive_from, plan.arrive_until, tz)}</strong>
        <span class="arrival-plan-sub">${fmtDayLabel(plan.requested_consultation_at, tz)} · for your ${fmtClock(plan.requested_consultation_at, tz)} consultation</span>
      </div>
      <div class="arrival-plan-meta">
        <div><span>Expected wait after arrival</span><strong class="mono">~${plan.predicted_wait_minutes} min</strong></div>
        <div><span>Expected consultation</span><strong class="mono">~${fmtClock(plan.expected_consultation_at, tz)}</strong></div>
      </div>
      <p class="arrival-plan-note">
        ${plan.simulated
          ? 'Offline estimate — the hospital server could not be reached. Your window is confirmed when you book.'
          : `Estimate (${esc(plan.model_version)}). Your final window is confirmed when you book.`}
      </p>
    </div>`;
}

/** Review page rows: requested time + arrival window (falls back to the original static row). */
function renderReviewArrivalRows(state) {
  if (!slotIsReady(state)) {
    return `
          <div class="review-row">
            <span class="review-label">Expected Arrival Window</span>
            <div class="review-value">
              <strong class="mono highlight-white">Today, 10:30–11:00 AM (Recommended)</strong>
              <span class="review-sub">Arrive within this window for expedited check-in</span>
            </div>
          </div>`;
  }
  const plan = state.arrivalPlan;
  const tz = plan.timezone;
  return `
          <div class="review-row">
            <span class="review-label">Requested Consultation</span>
            <div class="review-value">
              <strong class="mono highlight-white">${fmtDayLabel(plan.requested_consultation_at, tz)}, ${fmtClock(plan.requested_consultation_at, tz)}</strong>
              <span class="review-sub">Expected wait after arrival ~${plan.predicted_wait_minutes} min</span>
            </div>
          </div>

          <div class="review-row highlight-row">
            <span class="review-label">Arrival Window</span>
            <div class="review-value">
              <strong class="mono highlight-white">${fmtDayLabel(plan.arrive_from, tz)}, ${fmtWindow(plan.arrive_from, plan.arrive_until, tz)}</strong>
              <span class="review-sub">Arrive within this window for expedited check-in</span>
            </div>
          </div>`;
}

/** Confirmation page: the time the patient asked for, under the arrival window. */
function renderRequestedSlotLine(state) {
  const requestedAt = state.token.requested_consultation_at;
  if (!requestedAt) return '';
  const tz = state.arrivalPlan && state.arrivalPlan.timezone;
  return `
          <div class="token-id-window">
            Requested Consultation: <span class="mono highlight-white">${fmtDayLabel(requestedAt, tz)}, ${fmtClock(requestedAt, tz)}</span>
          </div>`;
}

// --------------------------------------------------------------------------- //
// View: Pre-Registration Review
// --------------------------------------------------------------------------- //
function renderPreReviewView(state) {
  const hospital = getHospital(state.activeHospitalId);
  const dept = getDepartment(state.activeHospitalId, state.activeDeptId);
  const draft = state.registrationDraft;

  return `
    <div class="flow-container">
      <div class="flow-card">
        <div class="flow-card-header">
          <div class="flow-step-eyebrow">PRE-REGISTRATION REVIEW</div>
          <h2 class="flow-card-title">You're almost ready</h2>
          <p class="flow-card-subtitle">Verify your facility and target arrival window before confirming.</p>
        </div>

        <div class="review-details-box">
          <div class="review-row">
            <span class="review-label">Hospital</span>
            <div class="review-value">
              <strong>${hospital.name}</strong>
              <span class="review-sub">${hospital.district} • ${hospital.type}</span>
            </div>
          </div>

          <div class="review-row">
            <span class="review-label">Department</span>
            <div class="review-value">
              <strong>${dept.name}</strong>
              <span class="review-sub">Outpatient Floor 2 • Prefix ${dept.prefix}</span>
            </div>
          </div>

          <div class="review-row highlight-row">
            <span class="review-label">Current Physical Queue</span>
            <div class="review-value">
              <strong class="mono highlight-cyan">32 patients</strong>
              <span class="review-sub">Physically verified on site right now</span>
            </div>
          </div>

          <div class="review-row">
            <span class="review-label">Patient ID</span>
            <div class="review-value">
              <strong class="mono">${draft.patientId}</strong>
              <span class="review-sub">Mobile: ${draft.phone}</span>
            </div>
          </div>

${renderReviewArrivalRows(state)}
        </div>

        <div class="critical-warning-box">
          <div class="warning-icon-col">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </div>
          <div class="warning-body">
            <h4 class="warning-heading">IMPORTANT: You are not yet part of the physical queue.</h4>
            <p class="warning-text">
              Pre-registration registers your intent to visit. Your position in the physical queue will <strong>only</strong> be established when you physically reach ${hospital.name} and confirm check-in.
            </p>
          </div>
        </div>

        <div class="flow-actions-row">
          <a href="#register" class="btn btn-secondary">Back to Details</a>
          <button type="button" class="btn btn-primary btn-lg" id="confirm-prereg-btn">
            Confirm Pre-Registration
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// View: Pre-Registration Confirmed
// --------------------------------------------------------------------------- //
function renderPreConfirmedView(state) {
  const hospital = getHospital(state.activeHospitalId);
  const dept = getDepartment(state.activeHospitalId, state.activeDeptId);
  const patient = state.patient;

  return `
    <div class="flow-container">
      <div class="flow-card confirmation-card">
        <div class="confirmation-badge-row">
          <span class="status-badge state-preregistered size-lg">
            <span class="badge-dot"></span> PRE-REGISTERED
          </span>
          <span class="holding-pool-tag">Expected Arrivals Roster</span>
        </div>

        <div class="confirmation-hero-block">
          <div class="check-success-ring">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <h2 class="flow-card-title">Pre-Registration Confirmed</h2>
          <p class="flow-card-subtitle">Your visit intent has been recorded in the ${hospital.name} admissions registry.</p>
        </div>

        <div class="token-id-display-box">
          <div class="token-id-label">PRE-REGISTRATION REFERENCE ID</div>
          <div class="token-id-value mono" id="pre-reg-id">${patient.preRegCode}</div>
          <div class="token-id-window">
            Target Arrival: <span class="mono highlight-white">${patient.arrivalWindow}</span>
          </div>
${renderRequestedSlotLine(state)}
        </div>

        <!-- Distinct Separation Telemetry Card -->
        <div class="separation-telemetry-panel">
          <div class="panel-header">
            <span class="panel-title">Operational Telemetry Breakdown</span>
            <span class="panel-badge-live">LIVE SYSTEM VERIFIED</span>
          </div>
          <div class="panel-grid-2">
            <div class="panel-stat-item">
              <div class="stat-top">
                <span class="stat-title">Active Physical Queue</span>
                <span class="stat-indicator in-queue">ON SITE</span>
              </div>
              <div class="stat-count mono">${state.physicalWaitingCount}</div>
              <div class="stat-note">Patients currently waiting in clinic</div>
              <div class="stat-status-line highlight-slate">Your status: Not counted yet</div>
            </div>

            <div class="panel-stat-item is-highlighted">
              <div class="stat-top">
                <span class="stat-title">Pre-Registered Pool</span>
                <span class="stat-indicator pre-reg">REMOTE</span>
              </div>
              <div class="stat-count mono highlight-cyan">${state.preRegisteredPool.length}</div>
              <div class="stat-note">Expected arrivals in current window</div>
              <div class="stat-status-line highlight-cyan">Your status: Slot Reserved</div>
            </div>
          </div>
          <div class="panel-explanation">
            Notice: The physical queue depth remains at 32 because pre-registered patients do not take physical queue positions until arrival.
          </div>
        </div>

        <div class="confirmed-next-steps">
          <div class="steps-heading">Next Steps When You Arrive:</div>
          <ol class="arrival-steps-list">
            <li>Proceed to ${hospital.name}, ${dept.floor}.</li>
            <li>Connect to hospital guest Wi-Fi or visit the check-in kiosk.</li>
            <li>Tap "Confirm Physical Arrival" below to enter the live queue and receive your official token.</li>
          </ol>
        </div>

        <div class="flow-actions-column">
          <a href="#physical-checkin" class="btn btn-primary btn-lg btn-block" id="btn-arrive-hospital">
            I Have Arrived at Hospital (Physical Check-in)
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </a>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// View: Physical Check-In Arrival Verification
// --------------------------------------------------------------------------- //
function renderPhysicalCheckinView(state) {
  const hospital = getHospital(state.activeHospitalId);
  const dept = getDepartment(state.activeHospitalId, state.activeDeptId);

  return `
    <div class="flow-container">
      <div class="flow-card">
        <div class="flow-card-header">
          <div class="flow-step-eyebrow">FACILITY ARRIVAL VERIFICATION</div>
          <h2 class="flow-card-title">Confirm your arrival</h2>
          <p class="flow-card-subtitle">Verify your presence on site to enter the live physical queue.</p>
        </div>

        <div class="geofence-status-banner">
          <div class="geofence-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          </div>
          <div class="geofence-text">
            <strong>Facility Proximity Detected:</strong> Connected to ${hospital.name} Campus Network / Check-in Point.
          </div>
        </div>

        <div class="review-details-box">
          <div class="review-row">
            <span class="review-label">Hospital</span>
            <div class="review-value">
              <strong>${hospital.name}</strong>
              <span class="review-sub">${hospital.address}</span>
            </div>
          </div>

          <div class="review-row">
            <span class="review-label">Department</span>
            <div class="review-value">
              <strong>${dept.name}</strong>
              <span class="review-sub">Consultation Wings A–C</span>
            </div>
          </div>

          <div class="review-row highlight-row">
            <span class="review-label">Pre-Reg Reference</span>
            <div class="review-value">
              <strong class="mono highlight-cyan">${state.patient.preRegCode}</strong>
              <span class="review-sub">Converting remote booking to physical token</span>
            </div>
          </div>

          <div class="review-row">
            <span class="review-label">Current Serving Token</span>
            <div class="review-value">
              <strong class="mono highlight-white">${state.currentlyServing.token}</strong>
              <span class="review-sub">In consultation now</span>
            </div>
          </div>

          <div class="review-row">
            <span class="review-label">Estimated Wait Time</span>
            <div class="review-value">
              <strong class="mono">28–35 min</strong>
              <span class="review-sub">Assigned upon token generation</span>
            </div>
          </div>
        </div>

        <div class="arrival-action-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <span>By checking in, your token will be placed in the physical queue and displayed on waiting room digital monitors.</span>
        </div>

        <div class="flow-actions-row">
          <a href="#access-type" class="btn btn-secondary">Cancel</a>
          <button type="button" class="btn btn-primary btn-lg" id="do-checkin-btn">
            <span class="btn-dot pulse"></span>
            Check in now
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// View: Live Queue Tracking Screen
// --------------------------------------------------------------------------- //
function renderLiveQueueView(state) {
  const hospital = getHospital(state.activeHospitalId);
  const dept = getDepartment(state.activeHospitalId, state.activeDeptId);
  const token = state.token;
  const isCalled = state.queueState === SYSTEM_STATES.CALLED;
  const isApproaching = state.queueState === SYSTEM_STATES.APPROACHING;

  return `
    <div class="live-queue-page-wrapper">
      <div class="live-queue-header">
        <div class="header-left">
          <div class="dept-breadcrumbs">
            <span class="crumb-hospital">${hospital.name}</span>
            <span class="crumb-sep">/</span>
            <span class="crumb-dept">${dept.name}</span>
            <span class="crumb-sep">/</span>
            <span class="crumb-floor">Floor 2, Wing B</span>
          </div>
          <h1 class="live-dept-title">${dept.name}</h1>
          <p class="live-dept-subtitle">Department Patient Flow & Active Queue Telemetry</p>
        </div>

        <div class="header-right">
          <div class="live-status-indicator">
            <span class="radar-dot"></span>
            <span class="live-label">LIVE SYSTEM ACTIVE</span>
          </div>
          <div class="state-badge-container">
            <span class="status-badge state-${state.queueState.toLowerCase()} size-lg">
              <span class="badge-dot"></span> ${state.queueState.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      <!-- State Banners -->
      ${isCalled ? `
        <div class="high-priority-alert-banner alert-called">
          <div class="alert-icon-wrap">
            <svg class="bell-ring" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          </div>
          <div class="alert-content">
            <div class="alert-headline">YOUR TOKEN ${token.display_code} IS NOW CALLED</div>
            <div class="alert-message">
              Please proceed immediately to <strong>${state.currentlyServing.room} (${state.currentlyServing.doctor})</strong>. Hospital staff are awaiting your entry.
            </div>
          </div>
          <button id="confirm-arrival-room-btn" class="btn btn-primary btn-sm alert-action-btn">
            Confirm Arrival at Room 4
          </button>
        </div>
      ` : ''}

      ${isApproaching ? `
        <div class="high-priority-alert-banner alert-approaching">
          <div class="alert-icon-wrap">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <div class="alert-content">
            <div class="alert-headline">You're Approaching: Position #2</div>
            <div class="alert-message">
              Only 1 patient ahead of you. Please make your way toward the Consultation Lobby near Room 4.
            </div>
          </div>
        </div>
      ` : ''}

      <!-- 4 Giant KPI Cards -->
      <div class="live-kpi-grid">
        <div class="live-kpi-card is-token">
          <div class="kpi-card-header">
            <span class="section-label">YOUR TOKEN</span>
            <span class="kpi-icon-pill">🎫</span>
          </div>
          <div class="kpi-giant-value mono" style="color: var(--primary);">${token.display_code}</div>
          <div class="kpi-footer-note">Assigned to ${state.patient.name}</div>
        </div>

        <div class="live-kpi-card">
          <div class="kpi-card-header">
            <span class="section-label">YOUR POSITION</span>
            <span class="kpi-icon-pill">#</span>
          </div>
          <div class="kpi-giant-value mono">#${state.position}</div>
          <div class="kpi-footer-note">In active line sequence</div>
        </div>

        <div class="live-kpi-card">
          <div class="kpi-card-header">
            <span class="section-label">PATIENTS AHEAD</span>
            <span class="kpi-icon-pill">👥</span>
          </div>
          <div class="kpi-giant-value mono">${state.patientsAhead}</div>
          <div class="kpi-footer-note">${state.patientsAhead === 0 ? 'You are currently being called!' : 'Waiting ahead of your turn'}</div>
        </div>

        <div class="live-kpi-card">
          <div class="kpi-card-header">
            <span class="section-label">ESTIMATED WAIT</span>
            <span class="kpi-icon-pill">⏱</span>
          </div>
          <div class="kpi-giant-value mono" style="font-size: 2.2rem; color: var(--primary);">${state.estimatedWaitMinutes > 0 ? `${Math.max(1, state.estimatedWaitMinutes - 4)}–${state.estimatedWaitMinutes + 5} min` : '0 min'}</div>
          <div class="kpi-footer-note">Calculated dynamically by throughput</div>
        </div>
      </div>

      <!-- Now Serving Spotlight -->
      <div class="serving-spotlight-bar">
        <span class="spotlight-badge">NOW SERVING</span>
        <span class="spotlight-token mono">${state.currentlyServing.token}</span>
        <div class="spotlight-room">
          <span class="room-dot"></span>
          <span>${state.currentlyServing.room} (${state.currentlyServing.doctor})</span>
        </div>
        <div class="spotlight-refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <span>Updated just now</span>
        </div>
      </div>

      <!-- Sequential Queue Track -->
      <div class="queue-timeline-container">
        <div class="timeline-header-row">
          <div>
            <h3 class="timeline-title">Sequential Queue Flow</h3>
            <p class="timeline-subtitle">Live tokens processing sequentially through ${dept.name}</p>
          </div>
          <div class="timeline-legend">
            <span class="legend-item"><span class="legend-dot serving"></span> Serving</span>
            <span class="legend-item"><span class="legend-dot next"></span> Next Up</span>
            <span class="legend-item"><span class="legend-dot you"></span> You (${token.display_code})</span>
            <span class="legend-item"><span class="legend-dot in-line"></span> In Queue</span>
          </div>
        </div>

        <div class="timeline-track-scroll">
          <div class="timeline-track">
            ${state.flowSequence.map((node, idx) => renderTimelineNode(node, idx)).join('')}
          </div>
        </div>

        <div class="timeline-progress-bar-wrap">
          <div class="progress-info-row">
            <span class="progress-label">Your Queue Trajectory</span>
            <span class="progress-pct mono">${isCalled ? '100% Completed' : isApproaching ? '75% Completed' : '10% Completed'}</span>
          </div>
          <div class="progress-track-bar">
            <div class="progress-fill-bar" style="width: ${isCalled ? '100%' : isApproaching ? '75%' : '10%'}"></div>
          </div>
        </div>
      </div>

      <!-- Footer Warning & Leave Queue -->
      <div class="live-queue-bottom-bar">
        <div class="disclaimer-note">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <span>Waiting time is an estimate and may change based on doctor availability, consultation duration, and priority cases.</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="leave-queue-open-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          Leave queue
        </button>
      </div>
    </div>
  `;
}

function renderTimelineNode(node, index) {
  const isServing = node.status === 'SERVING';
  const isNext = node.status === 'NEXT';
  const isUser = node.isYou;

  let nodeClass = '';
  if (isServing) nodeClass = 'serving';
  else if (isNext) nodeClass = 'next';
  if (isUser) nodeClass += ' is-self';

  let badge = '';
  if (isServing) badge = '<span class="token-label-badge">SERVING</span>';
  else if (isNext) badge = '<span class="token-label-badge">NEXT</span>';
  else if (isUser) badge = '<span class="token-label-badge">YOU</span>';
  else badge = '<span class="token-label-badge" style="background: #e2e8f0; color: #475569;">WAITING</span>';

  return `
    <div class="queue-token-node ${nodeClass}">
      <div class="token-node-bubble">
        <span class="token-code mono">${node.token}</span>
        ${badge}
      </div>
      <span class="token-order-tag">
        ${isServing ? 'In Room 4' : isUser ? `Position #${store.getState().position}` : `Slot ${index + 1}`}
      </span>
      <span class="token-connector"></span>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// View: Public Crowd Radar
// --------------------------------------------------------------------------- //
function renderCrowdTelemetryView(state) {
  const allDepts = HOSPITALS.flatMap(h => h.departments.map(d => ({ ...d, hospitalName: h.name, hospitalId: h.id })));

  return `
    <div class="page-container">
      <div class="page-header">
        <div class="page-breadcrumb">
          <a href="#landing">QUEUE</a> <span class="crumb-sep">/</span> <span>Hospital Crowd Telemetry</span>
        </div>
        <h1 class="page-title">Hospital Crowd Intelligence Radar</h1>
        <p class="page-subtitle">Public cross-facility waiting telemetry. Evaluated continuously to aid informed facility selection.</p>
      </div>

      <div class="operational-notice-box notice-info" style="margin-bottom: 24px;">
        <div class="notice-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        </div>
        <div class="notice-text">
          <strong>Zero PHI Guarantee:</strong> This public radar aggregates anonymized line volumes and throughput velocity. No personal or clinical information is collected or displayed.
        </div>
      </div>

      <div class="crowd-table-card">
        <table class="crowd-data-table">
          <thead>
            <tr>
              <th>FACILITY & DEPARTMENT</th>
              <th>CROWD LEVEL</th>
              <th>PHYSICAL QUEUE</th>
              <th>ESTIMATED WAIT</th>
              <th>VELOCITY TREND</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            ${allDepts.map(d => `
              <tr>
                <td>
                  <div class="facility-cell-name">${d.hospitalName}</div>
                  <div class="dept-cell-sub">${d.name} (${d.floor})</div>
                </td>
                <td>
                  <span class="crowd-pill crowd-${d.crowdLevel.toLowerCase()}">${d.crowdLevel.toUpperCase()}</span>
                </td>
                <td class="mono font-bold">${d.waitingCount}</td>
                <td class="mono highlight-cyan font-bold">${d.estimatedWait}</td>
                <td>
                  <span class="trend-badge trend-${d.trend.toLowerCase()}">
                    ${d.trend === 'Decreasing' ? '↓ Decreasing' : d.trend === 'Increasing' ? '↑ Increasing' : '→ Steady'}
                  </span>
                </td>
                <td>
                  <a href="#access-type?hospital=${d.hospitalId}&dept=${d.id}" class="btn btn-secondary btn-sm">Join</a>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// Secondary Views
// --------------------------------------------------------------------------- //
function renderHowItWorksView(state) {
  return `
    <div class="page-container max-w-content">
      <div class="page-header"><a href="#landing">QUEUE</a> <span class="crumb-sep">/</span> <span>How It Works</span></div>
      <h1 class="page-title" style="margin-bottom: 16px;">How QUEUE Works</h1>
      <p class="page-subtitle" style="margin-bottom: 32px;">Transparent, multi-facility queue orchestration engineered for patients and clinical providers.</p>
      <div class="registration-form-card">
        <div style="display: flex; flex-direction: column; gap: 24px;">
          <div>
            <h3 class="font-bold" style="font-size: 1.1rem; margin-bottom: 6px;">1. Inspect Facility Crowd Telemetry</h3>
            <p class="text-muted">Before leaving home, check waiting lines across regional hospitals to avoid congested departments.</p>
          </div>
          <div>
            <h3 class="font-bold" style="font-size: 1.1rem; margin-bottom: 6px;">2. Choose Remote Pre-Registration or On-Site Check-In</h3>
            <p class="text-muted">Pre-register to log your expected arrival window without cluttering the physical waiting room, or check in immediately upon arrival.</p>
          </div>
          <div>
            <h3 class="font-bold" style="font-size: 1.1rem; margin-bottom: 6px;">3. Track Live Progress & Receive Chime Alert</h3>
            <p class="text-muted">Monitor your exact position, patients ahead, and receive clear visual and audio chime alerts the moment your token is called.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderForHospitalsView(state) {
  return `
    <div class="page-container max-w-content">
      <div class="page-header"><a href="#landing">QUEUE</a> <span class="crumb-sep">/</span> <span>For Hospitals</span></div>
      <h1 class="page-title" style="margin-bottom: 16px;">Enterprise Hospital Integrations</h1>
      <p class="page-subtitle" style="margin-bottom: 24px;">QUEUE connects seamlessly with existing Hospital Information Systems (HIS) and EHR platforms.</p>
      <div class="registration-form-card">
        <h3 class="font-bold" style="font-size: 1.1rem; margin-bottom: 12px;">FastAPI Backend Architecture</h3>
        <p class="text-muted" style="margin-bottom: 16px;">The system exposes high-performance asynchronous REST endpoints for admissions kiosks, dynamic QR scanning, and doctor desk call terminals.</p>
        <div style="background: var(--bg-secondary); padding: 14px; border-radius: var(--radius-sm); font-family: monospace; font-size: 0.9rem;">
          POST /checkin/scan &bull; POST /walkin/scan &bull; POST /queue/{dept_id}/call-next
        </div>
      </div>
    </div>
  `;
}

function renderAboutView(state) {
  return `
    <div class="page-container max-w-content">
      <div class="page-header"><a href="#landing">QUEUE</a> <span class="crumb-sep">/</span> <span>About</span></div>
      <h1 class="page-title" style="margin-bottom: 16px;">About QUEUE</h1>
      <p class="page-subtitle" style="margin-bottom: 24px;">A universal healthcare operations platform providing data-driven crowd transparency.</p>
      <div class="registration-form-card">
        <p class="text-muted" style="line-height: 1.6;">Designed with zero PHI exposure, QUEUE eliminates unnecessary physical waiting room congestion while empowering patients with real-time operational telemetry.</p>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------- //
// 4. Modal Layer
// --------------------------------------------------------------------------- //
function renderModal(state) {
  const mount = document.getElementById('modal-mount');
  if (!mount) return;

  if (state.activeModal === 'leave-queue') {
    mount.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3 class="modal-title" style="color: var(--danger);">Leave Queue?</h3>
            <button id="modal-close-x" class="modal-close-btn">&times;</button>
          </div>
          <div class="modal-body">
            <p style="font-size: 1rem; color: var(--text-primary); margin-bottom: 8px;">
              Are you sure you want to surrender your token <strong>${state.token ? state.token.display_code : 'G128'}</strong>?
            </p>
            <p class="modal-subtext">
              You are currently at position <strong>#${state.position}</strong>. If you leave now, you will lose your spot and must register again.
            </p>
          </div>
          <div class="modal-footer">
            <button id="modal-cancel-btn" class="btn btn-secondary">Keep My Spot</button>
            <button id="modal-confirm-leave-btn" class="btn btn-danger">Yes, Leave Queue</button>
          </div>
        </div>
      </div>
    `;
  } else {
    mount.innerHTML = '';
  }
}

// --------------------------------------------------------------------------- //
// 5. Toast Notifications
// --------------------------------------------------------------------------- //
function renderToasts(state) {
  const mount = document.getElementById('toast-mount');
  if (!mount) return;

  if (!state.toasts || state.toasts.length === 0) {
    mount.innerHTML = '';
    return;
  }

  mount.innerHTML = state.toasts.map(t => `
    <div class="toast-message toast-${t.type || 'info'}">
      <span class="toast-dot"></span>
      <span>${t.message}</span>
    </div>
  `).join('');
}

// --------------------------------------------------------------------------- //
// 6. Queue Operations Simulator Dock
// --------------------------------------------------------------------------- //
function renderSimulatorDock(state) {
  const mount = document.getElementById('sim-bar-mount');
  if (!mount) return;

  const isOpen = state.simDockOpen;

  mount.innerHTML = `
    <div class="simulation-dock">
      <button type="button" class="sim-toggle-handle" id="sim-dock-toggle-btn">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--warning); font-size: 1rem;">⚡</span>
          <span class="sim-title">QUEUE OPERATIONS SIMULATOR</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="current-state-pill">${state.queueState.replace(/_/g, ' ')}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${isOpen ? '▼ HIDE' : '▲ OPEN'}</span>
        </div>
      </button>

      <div class="sim-drawer-content ${isOpen ? 'open' : ''}">
        <div class="sim-controls-grid">
          <div class="sim-section is-highlight">
            <span class="sim-section-label">DEMO WALKTHROUGH</span>
            <button id="sim-guided-demo-btn" class="btn btn-primary btn-sm btn-block">
              ▶ Run 1-Click Complete Journey
            </button>
            <span class="sim-hint">Auto-executes exact test sequence requested</span>
          </div>

          <div class="sim-section">
            <span class="sim-section-label">LIVE QUEUE STEPPER</span>
            <div class="sim-btn-group">
              <button id="sim-step-forward-btn" class="btn btn-primary btn-sm">+1 Token Advance</button>
              <button id="sim-arrive-btn" class="btn btn-secondary btn-sm">Arrive at Hospital</button>
            </div>
            <span class="sim-hint">Advances G121... & decrements wait</span>
          </div>

          <div class="sim-section">
            <span class="sim-section-label">JUMP TO STATE</span>
            <div class="sim-pills-row">
              <button class="sim-state-btn state-pill ${state.queueState === 'PRE_REGISTERED' ? 'active' : ''}" data-jump-state="PRE_REGISTERED">Pre-Reg</button>
              <button class="sim-state-btn state-pill ${state.queueState === 'PHYSICALLY_CHECKED_IN' ? 'active' : ''}" data-jump-state="PHYSICALLY_CHECKED_IN">Check-in</button>
              <button class="sim-state-btn state-pill ${state.queueState === 'WAITING' ? 'active' : ''}" data-jump-state="WAITING">Waiting</button>
              <button class="sim-state-btn state-pill ${state.queueState === 'APPROACHING' ? 'active' : ''}" data-jump-state="APPROACHING">Approaching</button>
              <button class="sim-state-btn state-pill ${state.queueState === 'CALLED' ? 'active' : ''}" data-jump-state="CALLED">Called</button>
              <button class="sim-state-btn state-pill ${state.queueState === 'IN_CONSULTATION' ? 'active' : ''}" data-jump-state="IN_CONSULTATION">Consulting</button>
              <button class="sim-state-btn state-pill ${state.queueState === 'COMPLETED' ? 'active' : ''}" data-jump-state="COMPLETED">Completed</button>
              <button class="sim-state-btn state-pill ${state.queueState === 'NO_SHOW' ? 'active' : ''}" data-jump-state="NO_SHOW">No-Show</button>
              <button class="sim-state-btn state-pill ${state.queueState === 'LEFT_QUEUE' ? 'active' : ''}" data-jump-state="LEFT_QUEUE">Left</button>
            </div>
          </div>

          <div class="sim-section">
            <span class="sim-section-label">UTILITIES</span>
            <div class="sim-btn-group">
              <button id="sim-audio-toggle-btn" class="btn btn-secondary btn-sm">
                ${state.audioChimeEnabled ? '🔊 Audio: ON' : '🔇 Audio: OFF'}
              </button>
              <button id="sim-reset-btn" class="btn btn-secondary btn-sm">↺ Reset</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
