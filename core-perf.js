/* CORE performance governor: adaptive resolution + effect shedding, frame-skip when hidden/covered, idle cleanup.
   Add ?perf=1 to the URL to show a live FPS/quality overlay. */
(function () {
  'use strict';
  var W = window, doc = document;
  var dpr = Math.max(1, W.devicePixelRatio || 1);
  var cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
  var qs = new URLSearchParams(location.search);

  // quality ladder (index = tier); duplicates removed so we never "step" between identical looks
  var raw = [{ pr: 0.8, bloom: false }, { pr: 1, bloom: true }, { pr: Math.min(dpr, 1.5), bloom: true }, { pr: Math.min(dpr, 2), bloom: true }];
  var TIERS = [];
  raw.forEach(function (t) { var l = TIERS[TIERS.length - 1]; if (!l || l.pr !== t.pr || l.bloom !== t.bloom) TIERS.push(t); });
  var MAX = TIERS.length - 1;

  var saved = NaN;
  try { saved = parseInt(localStorage.getItem('core_perf_tier'), 10); } catch (e) {}
  var tier = (cores >= 8 && mem >= 6) ? MAX : Math.min(MAX, 2);
  if (isFinite(saved) && saved >= 0) tier = Math.min(saved, MAX);
  if (qs.has('tier')) tier = Math.max(0, Math.min(MAX, parseInt(qs.get('tier'), 10) || 0));
  var locked = qs.has('tier');
  var cap = 0, every = 1, nSkip = 0, chk = 0;

  var PERF = W.__PERF = {
    get tier() { return tier; },
    bgDpr: 1,                                   // background canvases (stars, particles) are soft; 1x is plenty
    pr: function () { return cap ? Math.min(TIERS[tier].pr, cap) : TIERS[tier].pr; },
    hudDpr: Math.min(dpr, 1.5),
    aa: dpr < 1.5,                              // MSAA only where pixels are big enough to need it
    apply: function (c) {                       // c = optional pixel-ratio cap (AR mode passes 1)
      if (c !== undefined) cap = c || 0;
      var r = W.__CORE_RENDERER;
      W.__noBloom = !TIERS[tier].bloom;
      if (!r) return;
      var p = PERF.pr();
      if (Math.abs(r.getPixelRatio() - p) > 0.01) { r.setPixelRatio(p); r.setSize(W.innerWidth, W.innerHeight); }
    },
    skip: function () {                         // called at the top of the 3D loop
      if (doc.hidden) return true;
      if (++chk >= 15) { chk = 0; every = calcEvery(); PERF.every = every; }
      if (every <= 1) return false;
      return (++nSkip % every) !== 0;
    },
    every: 1
  };
  W.__noBloom = !TIERS[tier].bloom;

  function calcEvery() {
    var b = doc.body; if (!b) return 1;
    var p = doc.getElementById('panel');
    if (p && p.classList.contains('open')) return 3;
    var ts = doc.getElementById('toolsSheet');
    if (ts && ts.classList.contains('open')) return 3;
    if (b.classList.contains('chatMode')) return 2;
    return 1;
  }

  // ---- extra CSS: stop paying for things nobody can see ----
  var st = doc.createElement('style');
  st.textContent =
    'body:not(.seriousBgOn) #seriousBg{visibility:hidden;transition:opacity .9s ease,visibility 0s linear .9s}' +
    'body:not(.seriousBgOn) #seriousBg,body:not(.seriousBgOn) #seriousBg *,body:not(.seriousBgOn) #seriousBg::after{animation-play-state:paused!important}' +
    '#listeningWave:not(.on) span{animation-play-state:paused!important}' +
    '#canvas-wrap canvas{contain:strict}' +
    '#perfHud{position:fixed;left:6px;bottom:6px;z-index:99999;font:10px ui-monospace,monospace;color:#7dffd6;background:rgba(0,0,0,.55);padding:3px 6px;border-radius:6px;pointer-events:none;white-space:pre}';
  (doc.head || doc.documentElement).appendChild(st);

  // ---- governor ----
  var last = 0, buf = [], warmUntil = 0, healthy = 0, vs = 16.7, blocked = {}, hud = null, fps = 0;
  function evaluate(now) {
    var s = buf.slice().sort(function (a, b) { return a - b; });
    var med = s[s.length >> 1], p95 = s[Math.floor(s.length * 0.95)];
    var avg = s.reduce(function (a, b) { return a + b; }, 0) / s.length;
    fps = 1000 / avg;
    if (every > 1 || now < warmUntil || locked) return;   // only judge when the 3D scene is fully visible
    if (med < vs) vs = Math.max(7.5, Math.min(17, med));  // learn the display refresh interval
    if (avg > vs * 1.45 || p95 > vs * 2.4) {
      healthy = 0;
      if (tier > 0) {
        blocked[tier] = now + 120000;                     // don't climb back into this tier for 2 min
        tier--; PERF.apply(); persist();
      }
    } else if (med <= vs * 1.2 && p95 <= vs * 1.7) {
      if (++healthy >= 6 && tier < MAX && now > (blocked[tier + 1] || 0)) { tier++; healthy = 0; PERF.apply(); persist(); }
    } else healthy = 0;
  }
  function persist() { try { localStorage.setItem('core_perf_tier', String(tier)); } catch (e) {} }

  var winStart = 0, wasHidden = false;
  function loop(t) {
    requestAnimationFrame(loop);
    if (doc.hidden) { last = 0; buf.length = 0; winStart = 0; wasHidden = true; return; }
    if (!winStart) winStart = t;
    if (last) { var d = t - last; if (wasHidden) { wasHidden = false; buf.length = 0; winStart = t; } else buf.push(Math.min(d, 1500)); }
    wasHidden = false;
    last = t;
    // judge after 75 frames, or after 1.6 s on slow devices (don't wait a minute to notice 5 fps)
    if (buf.length >= 75 || (buf.length >= 4 && t - winStart >= 1600)) { evaluate(performance.now()); buf.length = 0; winStart = t; updateHud(); }
  }
  function updateHud() {
    if (!hud) return;
    var r = W.__CORE_RENDERER, i = r && r.info && r.info.render;
    hud.textContent = Math.round(fps) + ' fps  tier ' + tier + '/' + MAX + '  pr ' + PERF.pr().toFixed(2) + (W.__noBloom ? '  no-bloom' : '') +
      (i ? '\n' + i.calls + ' calls  ' + Math.round(i.triangles / 1000) + 'k tris' : '') + (every > 1 ? '  (1/' + every + ' rate)' : '');
  }

  function start() {
    warmUntil = performance.now() + 3500;
    if (qs.has('perf')) { hud = doc.createElement('div'); hud.id = 'perfHud'; doc.body.appendChild(hud); }
    PERF.apply();
    requestAnimationFrame(loop);
    // the boot splash keeps spinning (and blurring a full-screen layer) after it fades out: remove it
    var boot = doc.getElementById('bootOverlay');
    if (boot) {
      var mo = new MutationObserver(function () {
        if (boot.classList.contains('done')) { mo.disconnect(); setTimeout(function () { boot.style.display = 'none'; }, 1400); }
      });
      mo.observe(boot, { attributes: true, attributeFilter: ['class'] });
    }
    // run the heavy third-party model-viewer only after the first seconds of smooth animation
    if (!W.__mvQueued) { W.__mvQueued = true; setTimeout(function () { try { import('https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js').catch(function () {}); } catch (e) {} }, 9000); }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
