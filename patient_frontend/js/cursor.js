/* =========================================================================
   QUEUE - cursor follower, cursor line and card spotlight
   Include once, before </body>:   <script src="cursor.js" defer></script>

   What it does
   - Follower: a small dot on the pointer plus a ring that trails behind it.
     The ring grows over clickable things, shrinks while pressed, and turns
     red over disabled controls. Over text fields the native text cursor is
     used instead.
   - Cursor line: a fading line that traces the pointer path ("trail"), or
     thin guide lines across the page ("crosshair").
   - Spotlight: cards get a soft glow that follows the pointer.

   Only runs for a mouse or trackpad. Skipped on touch screens, when the
   visitor prefers reduced motion, and in forced-colors mode.
   ========================================================================= */
(function () {
  'use strict';

  var CONFIG = {
    lineMode: 'trail',      // 'trail' | 'crosshair' | 'off'
    ringLag: 0.18,          // 0.05 = floaty, 0.4 = snappy
    trailLifetimeMs: 420,   // how long the line takes to fade
    trailMinStepPx: 2       // ignore tiny jitters
  };

  // Keep in sync with the spotlight selector list in components.css
  var SPOTLIGHT = [
    '.card', '.panel', '.dashboard-card', '.hospital-card', '.queue-card',
    '.feature-card', '.how-card', '.live-kpi-card', '.department-card',
    '.access-choice-card', '.intelligence-card', '.insight-card',
    '.live-telemetry-preview-card', '.historical-chart-card', '.kpi-telemetry-bar'
  ].join(',');

  var INTERACTIVE = [
    'a[href]', 'button', '[role="button"]', '.btn', 'label', 'summary', 'select',
    '.choice-card', '.visit-type-card', '.filter-pill', '.sim-state-btn',
    '.metric-toggle-btn', '.chart-point-group', 'input[type="radio"]',
    'input[type="checkbox"]', 'input[type="button"]', 'input[type="submit"]'
  ].join(',');

  var TEXT_FIELD = 'input:not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([type="range"]), textarea, [contenteditable="true"]';
  var DISABLED = ':disabled, [aria-disabled="true"], .is-disabled';

  var root = document.documentElement;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var forced = window.matchMedia('(forced-colors: active)');

  if (!fine.matches || forced.matches) return;

  var animate = !reduced.matches;   // follower + line are motion; spotlight is not
  var dot, ring, canvas, ctx, crossX, crossY;
  var tx = -100, ty = -100;         // pointer target
  var rx = -100, ry = -100;         // ring position (eased)
  var seen = false, rafId = 0, pending = null;
  var points = [];
  var dpr = 1, lineRgb = '29, 78, 216';

  function init() {
    if (animate) {
      dot = make('div', 'cursor-dot');
      ring = make('div', 'cursor-ring');
      if (CONFIG.lineMode === 'trail') {
        canvas = make('canvas', 'cursor-trail');
        ctx = canvas.getContext('2d');
        sizeCanvas();
        window.addEventListener('resize', sizeCanvas, { passive: true });
      } else if (CONFIG.lineMode === 'crosshair') {
        crossX = make('div', 'cursor-cross cursor-cross-x');
        crossY = make('div', 'cursor-cross cursor-cross-y');
      }
      var rgb = getComputedStyle(root).getPropertyValue('--cursor-rgb').trim();
      if (rgb) lineRgb = rgb;
      root.classList.add('has-custom-cursor');
      document.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && ring) ring.classList.add('is-down');
      });
      document.addEventListener('pointerup', function () {
        if (ring) ring.classList.remove('is-down');
      });
      root.addEventListener('mouseleave', hide);
      window.addEventListener('blur', hide);
    }
    document.addEventListener('pointermove', onMove, { passive: true });
  }

  function make(tag, cls) {
    var el = document.createElement(tag);
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  }

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hide() {
    if (!ring) return;
    dot.classList.remove('is-visible');
    ring.classList.remove('is-visible', 'is-down');
    if (crossX) { crossX.classList.remove('is-visible'); crossY.classList.remove('is-visible'); }
  }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    tx = e.clientX;
    ty = e.clientY;
    pending = e.target;

    if (animate) {
      if (!seen) {
        seen = true;
        rx = tx; ry = ty;
      }
      dot.classList.add('is-visible');
      ring.classList.add('is-visible');
      if (crossX) { crossX.classList.add('is-visible'); crossY.classList.add('is-visible'); }

      if (ctx) {
        var last = points[points.length - 1];
        if (!last || Math.abs(last.x - tx) + Math.abs(last.y - ty) >= CONFIG.trailMinStepPx) {
          points.push({ x: tx, y: ty, t: performance.now() });
        }
      }
    }
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function setRingState(target) {
    if (!ring || !target || !target.closest) return;
    var text = !!target.closest(TEXT_FIELD);
    var disabled = !text && !!target.closest(DISABLED);
    var active = !text && !disabled && !!target.closest(INTERACTIVE);
    ring.classList.toggle('is-text', text);
    dot.classList.toggle('is-text', text);
    ring.classList.toggle('is-active', active);
    ring.classList.toggle('is-disabled', disabled);
    dot.classList.toggle('is-active', active);
  }

  function updateSpotlight(target) {
    if (!target || !target.closest) return;
    var card = target.closest(SPOTLIGHT);
    if (!card) return;
    var r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (tx - r.left) + 'px');
    card.style.setProperty('--my', (ty - r.top) + 'px');
  }

  function frame(now) {
    rafId = 0;
    var busy = false;

    if (pending) {
      setRingState(pending);
      updateSpotlight(pending);
      pending = null;
    }

    if (animate) {
      dot.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';

      var dx = tx - rx, dy = ty - ry;
      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        rx += dx * CONFIG.ringLag;
        ry += dy * CONFIG.ringLag;
        busy = true;
      } else {
        rx = tx; ry = ty;
      }
      ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';

      if (crossX) {
        crossX.style.transform = 'translate3d(' + tx + 'px,0,0)';
        crossY.style.transform = 'translate3d(0,' + ty + 'px,0)';
      }

      if (ctx) busy = drawTrail(now) || busy;
    }

    if (busy) rafId = requestAnimationFrame(frame);
  }

  function drawTrail(now) {
    var life = CONFIG.trailLifetimeMs;
    while (points.length && now - points[0].t > life) points.shift();
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (points.length < 2) return points.length > 0;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      var k = 1 - (now - b.t) / life;          // 1 = fresh, 0 = gone
      if (k <= 0) continue;
      ctx.strokeStyle = 'rgba(' + lineRgb + ',' + (k * 0.5).toFixed(3) + ')';
      ctx.lineWidth = 0.75 + k * 2.25;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    return true;
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();