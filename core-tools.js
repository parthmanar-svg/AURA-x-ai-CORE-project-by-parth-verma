/* CORE Tools: Tasks, Timer (+Focus/Pomodoro, Alarm), Stopwatch, Notes.
   Shares data with the voice commands (core_tasks / core_notes / core_alarms), so "add task ..." and the UI stay in sync. */
(function () {
  'use strict';
  var doc = document, W = window, X = W.CORE_X;
  var $ = function (i) { return doc.getElementById(i); };
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { var d = doc.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function say(t) { if (W.CORE_SAY) try { W.CORE_SAY(t); } catch (e) {} }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function today() { return new Date().toISOString().slice(0, 10); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hms(ms) {
    var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(x);
  }
  function whenStr(at) {
    var d = new Date(at), n = new Date(), sameDay = d.toDateString() === n.toDateString();
    return (sameDay ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ') + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // ---- alarms (provided by the core script) ----
  var AL = W.CORE_ALARMS || {
    add: function () { return null; }, list: function () { return jget('core_alarms', []); }, cancel: function () {}
  };

  // ---- state ----
  var tab = 'tasks', filter = 'open', editing = null, remindOn = false;
  var T = Object.assign({ mode: 'timer', total: 300000, left: 300000, end: 0, running: false, phase: 'focus', done: 0, day: '', aid: null }, jget('core_ui_timer', {}));
  if (T.day !== today()) { T.day = today(); T.done = 0; }
  var S = Object.assign({ running: false, start: 0, acc: 0, laps: [] }, jget('core_ui_sw', {}));
  function saveT() { jset('core_ui_timer', T); }
  function saveS() { jset('core_ui_sw', S); }

  // ---- tasks ----
  function tasks() { var k = jget('core_tasks', []); var ch = false; k.forEach(function (x) { if (!x.id) { x.id = Date.now() + Math.random(); ch = true; } }); if (ch) jset('core_tasks', k); return k; }
  function openCount() { return tasks().filter(function (t) { return !t.done; }).length; }
  function addTask(text, due) {
    text = (text || '').trim(); if (!text) return false;
    var k = tasks(); var t = { id: Date.now() + Math.random(), t: text, done: false };
    if (due && due > Date.now()) { t.due = due; AL.add(due, 'Task: ' + text); }
    k.push(t); jset('core_tasks', k); return true;
  }

  // ---- timer logic ----
  function tLeft() { return T.running ? Math.max(0, T.end - Date.now()) : T.left; }
  function tLabel() {
    if (T.mode === 'pomo') return T.phase === 'focus' ? 'Focus session complete. Time for a break.' : 'Break is over. Back to focus.';
    return 'Timer done (' + hms(T.total) + ')';
  }
  function tStart() {
    if (T.running) return;
    if (T.left <= 0) T.left = T.total;
    T.end = Date.now() + T.left; T.running = true; T.aid = AL.add(T.end, tLabel()); saveT();
  }
  function tPause() {
    if (!T.running) return;
    T.left = Math.max(1000, T.end - Date.now()); T.running = false;
    if (T.aid) AL.cancel(T.aid); T.aid = null; saveT();
  }
  function tReset() { if (T.aid) AL.cancel(T.aid); T.aid = null; T.running = false; T.left = T.total; saveT(); }
  function tSet(ms) { if (T.aid) AL.cancel(T.aid); T.aid = null; T.running = false; T.total = ms; T.left = ms; saveT(); }
  function setMode(m) {
    if (T.mode === m) return;
    if (T.aid) AL.cancel(T.aid); T.aid = null; T.running = false; T.mode = m;
    if (m === 'pomo') { T.phase = 'focus'; T.total = T.left = 25 * 60000; } else { T.total = T.left = 5 * 60000; }
    saveT();
  }
  function tComplete() {
    T.running = false; T.aid = null;
    if (T.mode === 'pomo') {
      if (T.phase === 'focus') { T.done++; T.phase = 'break'; T.total = (T.done % 4 === 0 ? 15 : 5) * 60000; }
      else { T.phase = 'focus'; T.total = 25 * 60000; }
      T.left = T.total; tStart();
    } else { T.left = T.total; saveT(); }
    saveT(); refreshMini(); if (isOpen() && tab === 'timer') renderBody();
  }

  // ---- UI shell ----
  var sheet, back, body, tabs;
  var CSS =
    '#toolsBtn{pointer-events:auto;position:relative;width:36px;height:36px;margin-left:auto;margin-right:8px;border:1px solid var(--accent-dim);border-radius:30%;background:rgba(10,14,16,.55);color:var(--accent);display:flex;align-items:center;justify-content:center;flex:none}' +
    '#toolsBtn svg{width:18px;height:18px}#toolsBtn .bdg{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--accent);color:#04100c;font:700 10px/16px system-ui;text-align:center}' +
    '#toolsMini{display:none;pointer-events:auto;margin-left:auto;margin-right:8px;padding:6px 10px;border:1px solid var(--accent-dim);border-radius:14px;background:rgba(10,14,16,.6);color:var(--accent);font:600 12px ui-monospace,monospace;flex:none}' +
    '#toolsMini.on{display:block}#toolsMini.on+#toolsBtn{margin-left:0}' +
    '#toolsBack{position:fixed;inset:0;z-index:69;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .25s}#toolsBack.open{opacity:1;pointer-events:auto}' +
    '#toolsSheet{position:fixed;left:0;right:0;bottom:0;z-index:70;height:80vh;max-height:700px;display:flex;flex-direction:column;background:rgba(8,12,16,.97);border:1px solid var(--accent-dim);border-bottom:0;border-radius:22px 22px 0 0;color:var(--ink);transform:translateY(105%);transition:transform .3s cubic-bezier(.2,.8,.2,1);will-change:transform;padding-bottom:env(safe-area-inset-bottom)}' +
    '#toolsSheet.open{transform:none}' +
    '#toolsSheet .tsHead{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 6px}#toolsSheet .tsHead h3{font-size:13px;letter-spacing:3px;color:var(--accent);margin:0}' +
    '#toolsSheet .tsX{background:none;border:1px solid var(--accent-dim);color:var(--accent);width:34px;height:34px;border-radius:50%;font-size:16px}' +
    '#toolsSheet .tsTabs{display:flex;gap:6px;padding:6px 12px}#toolsSheet .tsTabs button{flex:1;min-height:40px;border:1px solid var(--panel-border);background:transparent;color:var(--ink-dim);border-radius:12px;font-size:12px;font-weight:600;letter-spacing:.5px}' +
    '#toolsSheet .tsTabs button.on{color:var(--accent);border-color:var(--accent);background:rgba(76,212,169,.08)}' +
    '#toolsSheet .tsBody{flex:1;overflow:auto;padding:8px 14px 18px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}' +
    '#toolsSheet input,#toolsSheet textarea{width:100%;background:#0e1416;border:1px solid var(--panel-border);color:var(--ink);padding:11px;border-radius:10px;font-size:16px;font-family:inherit}' +
    '#toolsSheet textarea{min-height:70px;resize:none}' +
    '#toolsSheet .row{display:flex;gap:8px;align-items:center;margin:8px 0}' +
    '#toolsSheet .btn{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--accent-dim);background:transparent;color:var(--accent);font-size:14px;font-weight:700;flex:none}' +
    '#toolsSheet .btn.pri{background:var(--accent);color:#04100c;border-color:var(--accent)}#toolsSheet .btn.sm{min-height:34px;padding:0 10px;font-size:12px}' +
    '#toolsSheet .btn.dng{color:#ff7a7a;border-color:rgba(255,122,122,.4)}' +
    '#toolsSheet .chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}#toolsSheet .chip{min-height:38px;padding:0 14px;border-radius:19px;border:1px solid var(--panel-border);background:transparent;color:var(--ink);font-size:13px}' +
    '#toolsSheet .chip.on{border-color:var(--accent);color:var(--accent)}' +
    '#toolsSheet .item{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--panel-border)}' +
    '#toolsSheet .item .tx{flex:1;min-width:0;font-size:15px;line-height:1.35;word-break:break-word}#toolsSheet .item.done .tx{opacity:.45;text-decoration:line-through}' +
    '#toolsSheet .ck{width:26px;height:26px;border-radius:8px;border:2px solid var(--accent-dim);background:transparent;color:#04100c;font-size:15px;flex:none;padding:0}#toolsSheet .item.done .ck{background:var(--accent);border-color:var(--accent)}' +
    '#toolsSheet .sub{font-size:11px;color:var(--ink-dim);margin-top:2px}#toolsSheet .ic{background:none;border:0;color:var(--ink-dim);font-size:17px;width:36px;height:36px;flex:none}' +
    '#toolsSheet .ring{position:relative;width:210px;height:210px;margin:6px auto}#toolsSheet .ring svg{width:100%;height:100%;transform:rotate(-90deg)}' +
    '#toolsSheet .ring .t{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font:300 44px ui-monospace,monospace;color:var(--ink)}' +
    '#toolsSheet .ring .t small{font:600 11px system-ui;letter-spacing:3px;color:var(--accent);margin-top:4px}' +
    '#toolsSheet .seg{display:flex;gap:6px}#toolsSheet .seg button{flex:1}' +
    '#toolsSheet .empty{padding:26px 8px;text-align:center;color:var(--ink-dim);font-size:13px}' +
    '#toolsSheet h4{font-size:11px;letter-spacing:2px;color:var(--accent);margin:18px 0 4px}' +
    '#toolsSheet .big{font:300 54px ui-monospace,monospace;text-align:center;margin:14px 0 6px}';

  function build() {
    if ($('toolsBtn')) return;
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    var top = $('topbar'), gear = $('settingsBtn');
    var mini = doc.createElement('button'); mini.id = 'toolsMini'; mini.type = 'button'; mini.setAttribute('aria-label', 'Open timer');
    var b = doc.createElement('button'); b.id = 'toolsBtn'; b.type = 'button'; b.setAttribute('aria-label', 'Tasks and timers');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9l1.6 1.6L12 8M8 15l1.6 1.6L12 14M14.5 9.5H17M14.5 15.5H17"/></svg><span class="bdg" id="toolsBdg" style="display:none"></span>';
    if (top && gear) { top.insertBefore(mini, gear); top.insertBefore(b, gear); } else (doc.getElementById('hud') || doc.body).appendChild(b);
    back = doc.createElement('div'); back.id = 'toolsBack';
    sheet = doc.createElement('div'); sheet.id = 'toolsSheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Tools');
    sheet.innerHTML = '<div class="tsHead"><h3>TOOLS</h3><button class="tsX" id="tsClose" aria-label="Close">\u2715</button></div>' +
      '<div class="tsTabs" id="tsTabs"><button data-tab="tasks">Tasks</button><button data-tab="timer">Timer</button><button data-tab="sw">Stopwatch</button><button data-tab="notes">Notes</button></div>' +
      '<div class="tsBody" id="tsBody"></div>';
    doc.body.appendChild(back); doc.body.appendChild(sheet);
    body = $('tsBody'); tabs = $('tsTabs');
    b.addEventListener('click', function () { open(); });
    mini.addEventListener('click', function () { open('timer'); });
    back.addEventListener('click', function () { close(); });
    $('tsClose').addEventListener('click', function () { close(); });
    tabs.addEventListener('click', function (e) { var t = e.target.getAttribute && e.target.getAttribute('data-tab'); if (t) { tab = t; editing = null; renderTabs(); renderBody(); } });
    body.addEventListener('click', onClick);
    body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'tkIn') { e.preventDefault(); doAddTask(); } if (e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('data-edit')) { e.target.blur(); } });
    body.addEventListener('focusout', function (e) { var id = e.target.getAttribute && e.target.getAttribute('data-edit'); if (id) saveEdit(id, e.target.value); });
    window.addEventListener('popstate', function () { if (isOpen()) close(true); });
    refreshBadge(); refreshMini();
  }

  function isOpen() { return !!(sheet && sheet.classList.contains('open')); }
  function open(t) {
    build(); if (t) tab = t;
    renderTabs(); renderBody();
    sheet.classList.add('open'); back.classList.add('open');
    try { history.pushState({ tools: 1 }, ''); } catch (e) {}
  }
  function close(fromPop) {
    if (!sheet) return;
    sheet.classList.remove('open'); back.classList.remove('open'); editing = null;
    if (!fromPop) { try { if (history.state && history.state.tools) history.back(); } catch (e) {} }
    refreshBadge(); refreshMini();
  }
  function renderTabs() { [].forEach.call(tabs.children, function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); }); }
  function renderBody() {
    var keepScroll = body.scrollTop;
    var h = tab === 'tasks' ? vTasks() : tab === 'timer' ? vTimer() : tab === 'sw' ? vSW() : vNotes();
    // don't clobber a field the user is typing in
    var focusId = doc.activeElement && doc.activeElement.id, val = focusId && body.contains(doc.activeElement) ? doc.activeElement.value : null;
    body.innerHTML = h;
    if (val != null) { var f = $(focusId); if (f) { f.value = val; f.focus(); } }
    body.scrollTop = keepScroll;
  }

  // ---- views ----
  function vTasks() {
    var k = tasks(), nOpen = k.filter(function (x) { return !x.done; }).length, nDone = k.length - nOpen;
    var list = k.filter(function (x) { return filter === 'all' || (filter === 'open' ? !x.done : x.done); });
    var h = '<div class="row"><input id="tkIn" placeholder="Add a task\u2026" autocomplete="off"><button class="btn sm" data-act="remind" aria-label="Set reminder" style="min-height:44px">' + (remindOn ? '\u23F0 On' : '\u23F0') + '</button><button class="btn pri" data-act="addTask">Add</button></div>';
    if (remindOn) h += '<div class="row"><input id="tkWhen" type="datetime-local"></div>';
    h += '<div class="chips"><button class="chip' + (filter === 'open' ? ' on' : '') + '" data-act="flt" data-v="open">Open ' + nOpen + '</button><button class="chip' + (filter === 'done' ? ' on' : '') + '" data-act="flt" data-v="done">Done ' + nDone + '</button><button class="chip' + (filter === 'all' ? ' on' : '') + '" data-act="flt" data-v="all">All</button></div>';
    if (!list.length) h += '<div class="empty">' + (filter === 'open' ? 'Nothing open. Add a task above, or just say "add task \u2026".' : 'Nothing here yet.') + '</div>';
    list.forEach(function (x) {
      h += '<div class="item' + (x.done ? ' done' : '') + '"><button class="ck" data-act="tog" data-id="' + x.id + '" aria-label="Toggle done">' + (x.done ? '\u2713' : '') + '</button><div class="tx">' +
        (editing === String(x.id) ? '<input data-edit="' + x.id + '" value="' + esc(x.t).replace(/"/g, '&quot;') + '">' : '<span data-act="edit" data-id="' + x.id + '">' + esc(x.t) + '</span>') +
        (x.due ? '<div class="sub">\u23F0 ' + whenStr(x.due) + '</div>' : '') + '</div><button class="ic" data-act="del" data-id="' + x.id + '" aria-label="Delete">\u2715</button></div>';
    });
    if (nDone) h += '<div class="row" style="justify-content:center;margin-top:14px"><button class="btn sm dng" data-act="clearDone">Clear completed</button></div>';
    return h;
  }

  function vTimer() {
    var left = tLeft(), frac = T.total ? Math.max(0, Math.min(1, left / T.total)) : 0, C = 2 * Math.PI * 92;
    var h = '<div class="seg"><button class="chip' + (T.mode === 'timer' ? ' on' : '') + '" data-act="mode" data-v="timer">Timer</button><button class="chip' + (T.mode === 'pomo' ? ' on' : '') + '" data-act="mode" data-v="pomo">Focus (Pomodoro)</button></div>';
    h += '<div class="ring"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="92" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="8"/><circle id="tmArc" cx="100" cy="100" r="92" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - frac)).toFixed(1) + '"/></svg><div class="t"><span id="tmTxt">' + hms(left) + '</span><small id="tmLbl">' + (T.mode === 'pomo' ? (T.phase === 'focus' ? 'FOCUS' : 'BREAK') : (T.running ? 'RUNNING' : 'READY')) + '</small></div></div>';
    h += '<div class="row" style="justify-content:center"><button class="btn pri" style="min-width:120px" data-act="tmGo">' + (T.running ? 'Pause' : 'Start') + '</button><button class="btn" data-act="tmReset">Reset</button></div>';
    if (T.mode === 'timer') {
      h += '<div class="chips" style="justify-content:center">' + [1, 5, 10, 15, 25, 30, 60].map(function (m) { return '<button class="chip' + (T.total === m * 60000 ? ' on' : '') + '" data-act="preset" data-v="' + m + '">' + (m === 60 ? '1 h' : m + ' min') + '</button>'; }).join('') + '</div>';
      h += '<div class="row"><input id="cuM" type="number" inputmode="numeric" min="0" placeholder="min"><input id="cuS" type="number" inputmode="numeric" min="0" max="59" placeholder="sec"><button class="btn" data-act="custom">Set</button></div>';
    } else {
      h += '<div class="sub" style="text-align:center">Focus 25 min \u2192 break 5 min (15 after every 4th). Sessions today: <b>' + T.done + '</b></div>';
    }
    h += '<h4>ALARM</h4><div class="row"><input id="alT" type="time"><input id="alL" placeholder="Label (optional)"><button class="btn" data-act="alarm">Set</button></div>';
    var up = AL.list().slice().sort(function (a, b) { return a.at - b.at; });
    h += '<h4>UPCOMING</h4>';
    if (!up.length) h += '<div class="empty" style="padding:10px">No alarms or timers set. Say "timer for 10 minutes" or set one above.</div>';
    up.forEach(function (a) { h += '<div class="item"><div class="tx">' + esc(a.label) + '<div class="sub">' + whenStr(a.at) + ' \u00b7 in <span data-eta="' + a.at + '">' + hms(a.at - Date.now()) + '</span></div></div><button class="ic" data-act="alDel" data-id="' + a.id + '" aria-label="Cancel">\u2715</button></div>'; });
    return h;
  }

  function swMs() { return S.acc + (S.running ? Date.now() - S.start : 0); }
  function swFmt(ms) { var c = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000); return m + ':' + pad(s) + '.' + pad(c); }
  function vSW() {
    var h = '<div class="big" id="swTxt">' + swFmt(swMs()) + '</div><div class="row" style="justify-content:center"><button class="btn pri" style="min-width:110px" data-act="swGo">' + (S.running ? 'Stop' : (S.acc ? 'Resume' : 'Start')) + '</button><button class="btn" data-act="swLap"' + (S.running ? '' : ' disabled style="opacity:.4"') + '>Lap</button><button class="btn" data-act="swReset">Reset</button></div>';
    if (!S.laps.length) h += '<div class="empty">Laps will show up here.</div>';
    var prev = 0;
    var rows = S.laps.map(function (t, i) { var r = { n: i + 1, d: t - prev, t: t }; prev = t; return r; }).reverse();
    rows.forEach(function (r) { h += '<div class="item"><div class="tx">Lap ' + r.n + '</div><div style="font:14px ui-monospace,monospace">+' + swFmt(r.d) + '</div><div class="sub" style="width:78px;text-align:right;font-family:ui-monospace,monospace">' + swFmt(r.t) + '</div></div>'; });
    return h;
  }

  function vNotes() {
    var N = jget('core_notes', []);
    var h = '<textarea id="ntIn" placeholder="Write a note\u2026"></textarea><div class="row" style="justify-content:flex-end"><button class="btn pri" data-act="addNote">Save note</button></div>';
    if (!N.length) h += '<div class="empty">No notes yet. Say "note \u2026" to add one by voice.</div>';
    N.map(function (x, i) { return { x: x, i: i }; }).reverse().forEach(function (o) {
      h += '<div class="item"><div class="tx">' + esc(o.x.t).replace(/\n/g, '<br>') + '<div class="sub">' + new Date(o.x.ts || Date.now()).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</div></div><button class="ic" data-act="delNote" data-i="' + o.i + '" aria-label="Delete note">\u2715</button></div>';
    });
    if (N.length) h += '<div class="row" style="justify-content:center;margin-top:14px"><button class="btn sm dng" data-act="clearNotes">Clear all</button></div>';
    return h;
  }

  // ---- actions ----
  function doAddTask() {
    var inp = $('tkIn'), w = $('tkWhen'); if (!inp) return;
    var due = w && w.value ? +new Date(w.value) : 0;
    if (addTask(inp.value, due)) { inp.value = ''; remindOn = false; renderBody(); refreshBadge(); var n = $('tkIn'); if (n) n.focus(); }
  }
  function saveEdit(id, v) {
    var k = tasks(), t = k.filter(function (x) { return String(x.id) === String(id); })[0];
    if (t && (v || '').trim()) { t.t = v.trim(); jset('core_tasks', k); }
    editing = null; renderBody();
  }
  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null; if (!el) return;
    var a = el.getAttribute('data-act'), id = el.getAttribute('data-id'), v = el.getAttribute('data-v'), k;
    switch (a) {
      case 'addTask': doAddTask(); return;
      case 'remind': remindOn = !remindOn; var cur = $('tkIn') ? $('tkIn').value : ''; renderBody(); if ($('tkIn')) $('tkIn').value = cur; return;
      case 'flt': filter = v; renderBody(); return;
      case 'tog': k = tasks(); k.forEach(function (x) { if (String(x.id) === id) x.done = !x.done; }); jset('core_tasks', k); buzz(10); renderBody(); refreshBadge(); return;
      case 'del': k = tasks().filter(function (x) { return String(x.id) !== id; }); jset('core_tasks', k); renderBody(); refreshBadge(); return;
      case 'edit': editing = id; renderBody(); var ed = body.querySelector('[data-edit]'); if (ed) { ed.focus(); ed.select(); } return;
      case 'clearDone': jset('core_tasks', tasks().filter(function (x) { return !x.done; })); renderBody(); refreshBadge(); return;
      case 'mode': setMode(v); refreshMini(); renderBody(); return;
      case 'tmGo': if (T.running) tPause(); else tStart(); buzz(12); refreshMini(); renderBody(); return;
      case 'tmReset': tReset(); refreshMini(); renderBody(); return;
      case 'preset': tSet(+v * 60000); refreshMini(); renderBody(); return;
      case 'custom': var m = parseInt(($('cuM') || {}).value, 10) || 0, s = parseInt(($('cuS') || {}).value, 10) || 0, ms = (m * 60 + s) * 1000; if (ms >= 1000) { tSet(ms); refreshMini(); renderBody(); } return;
      case 'alarm':
        var tv = ($('alT') || {}).value; if (!tv) return;
        var p = tv.split(':'), d = new Date(); d.setHours(+p[0], +p[1], 0, 0); if (d <= Date.now()) d.setDate(d.getDate() + 1);
        AL.add(+d, (($('alL') || {}).value || '').trim() || 'Alarm'); say('Alarm set for ' + whenStr(+d) + '.'); renderBody(); return;
      case 'alDel': AL.cancel(isNaN(+id) ? id : +id); if (T.aid && String(T.aid) === id) { T.aid = null; T.running = false; T.left = T.total; saveT(); } refreshMini(); renderBody(); return;
      case 'swGo': if (S.running) { S.acc += Date.now() - S.start; S.running = false; } else { S.start = Date.now(); S.running = true; } saveS(); buzz(12); renderBody(); return;
      case 'swLap': if (S.running) { S.laps.push(swMs()); saveS(); buzz(8); renderBody(); } return;
      case 'swReset': S = { running: false, start: 0, acc: 0, laps: [] }; saveS(); renderBody(); return;
      case 'addNote': var ta = $('ntIn'); if (ta && ta.value.trim()) { var N = jget('core_notes', []); N.push({ t: ta.value.trim(), ts: Date.now() }); jset('core_notes', N); renderBody(); } return;
      case 'delNote': var N2 = jget('core_notes', []); N2.splice(+el.getAttribute('data-i'), 1); jset('core_notes', N2); renderBody(); return;
      case 'clearNotes': jset('core_notes', []); renderBody(); return;
    }
  }

  // ---- header badge + mini timer ----
  function refreshBadge() {
    var b = $('toolsBdg'); if (!b) return; var n = openCount();
    b.style.display = n ? 'block' : 'none'; b.textContent = n > 99 ? '99+' : String(n);
  }
  function refreshMini() {
    var m = $('toolsMini'); if (!m) return;
    var show = (T.running || (S.running)) && !isOpen();
    m.classList.toggle('on', !!show);
    if (show) m.textContent = T.running ? '\u23F1 ' + hms(tLeft()) : '\u25B6 ' + swFmt(swMs()).slice(0, -3);
  }

  // ---- live updates (cheap, only touches text) ----
  var lastTxt = '';
  setInterval(function () {
    if (T.running && Date.now() >= T.end) tComplete();
    if (!sheet) return;
    refreshMini();
    if (!isOpen()) return;
    if (tab === 'timer') {
      var left = tLeft(), t = $('tmTxt'), arc = $('tmArc');
      if (t) { var s = hms(left); if (s !== lastTxt) { t.textContent = s; lastTxt = s; } }
      if (arc && T.total) { var C = 2 * Math.PI * 92; arc.setAttribute('stroke-dashoffset', (C * (1 - Math.max(0, Math.min(1, left / T.total)))).toFixed(1)); }
      [].forEach.call(body.querySelectorAll('[data-eta]'), function (e) { e.textContent = hms(+e.getAttribute('data-eta') - Date.now()); });
    } else if (tab === 'sw' && S.running) { var q = $('swTxt'); if (q) q.textContent = swFmt(swMs()); }
  }, 100);

  // ---- voice / typed commands ----
  var oi = X && X.intercept;
  if (X) X.intercept = async function (t) {
    var l = (t || '').trim().toLowerCase(), m;
    // "show my tasks" / "show notes" keep their old behaviour (list in chat); "open ..." or "... panel" opens the screen
    if ((m = l.match(/^open\s+(?:my\s+)?(tasks?|to-?dos?|timers?|stopwatch|notes?|tools)(?:\s+(?:panel|screen|list))?$/)) ||
        (m = l.match(/^show\s+(?:my\s+)?(tasks?|to-?dos?|timers?|stopwatch|notes?|tools)\s+(?:panel|screen)$/)) ||
        (m = l.match(/^show\s+(?:my\s+)?(timers?|stopwatch|tools)$/))) {
      var w = m[1]; open(/task|to-?do/.test(w) ? 'tasks' : /timer/.test(w) ? 'timer' : /stopwatch/.test(w) ? 'sw' : /note/.test(w) ? 'notes' : tab);
      return 'Opening ' + (w === 'tools' ? 'your tools' : w) + '.';
    }
    if (/^(?:start|begin)\s+(?:a\s+)?(?:pomodoro|focus(?:\s+(?:timer|session))?)$/.test(l)) { build(); setMode('pomo'); tStart(); refreshMini(); if (isOpen()) renderBody(); return 'Focus session started: 25 minutes.'; }
    if (/^(?:start|begin)\s+(?:the\s+)?stopwatch$/.test(l)) { if (!S.running) { S.start = Date.now(); S.running = true; saveS(); } build(); refreshMini(); return 'Stopwatch running.'; }
    if (/^(?:stop|pause)\s+(?:the\s+)?stopwatch$/.test(l)) { if (S.running) { S.acc += Date.now() - S.start; S.running = false; saveS(); } return 'Stopwatch stopped at ' + swFmt(swMs()) + '.'; }
    if (/^(?:reset|clear)\s+(?:the\s+)?stopwatch$/.test(l)) { S = { running: false, start: 0, acc: 0, laps: [] }; saveS(); return 'Stopwatch reset.'; }
    if (/^(?:cancel|stop|clear)\s+(?:all\s+|my\s+)?(?:timers?|alarms?)$/.test(l)) {
      var n = AL.list().slice(); n.forEach(function (a) { AL.cancel(a.id); }); T.running = false; T.aid = null; T.left = T.total; saveT(); refreshMini();
      return n.length ? 'Cancelled ' + n.length + (n.length === 1 ? ' timer/alarm.' : ' timers/alarms.') : 'Nothing was running.';
    }
    var r = oi ? await oi(t) : null;
    if (r) { refreshBadge(); if (isOpen()) { try { renderBody(); } catch (e) {} } }
    return r;
  };

  // ---- Daily Briefing (the screen you see on opening): tick tasks off and add new ones ----
  var bqCss = doc.createElement('style');
  bqCss.textContent = '#xBrief .bqRow{display:flex;align-items:center;gap:10px;padding:5px 0}#xBrief .bqRow span{flex:1;min-width:0;word-break:break-word}' +
    '#xBrief .bqk{width:26px;height:26px;padding:0!important;border-radius:8px!important;flex:none}' +
    '#xBrief .bqAdd{display:flex;gap:8px;margin:10px 0 4px}#xBrief .bqAdd input{flex:1;min-width:0;background:#0e1416;border:1px solid var(--panel-border);color:var(--ink);padding:9px 10px;border-radius:10px;font-size:16px;font-family:inherit}' +
    '#xBrief .bqAdd button{min-height:40px;padding:0 14px!important;font-weight:700}';
  (doc.head || doc.documentElement).appendChild(bqCss);
  function briefHtml() {
    var k = tasks().filter(function (t) { return !t.done; });
    var al = AL.list().filter(function (a) { return a.at - Date.now() < 864e5; }).sort(function (a, b) { return a.at - b.at; });
    var h = '<p style="margin-top:10px"><b>Tasks</b></p>';
    if (!k.length) h += '<div style="color:var(--ink-dim)">Nothing open.</div>';
    k.forEach(function (t) { h += '<div class="bqRow"><button class="bqk" data-bq="tog" data-id="' + t.id + '" aria-label="Mark done"></button><span>' + esc(t.t) + '</span></div>'; });
    h += '<div class="bqAdd"><input id="bqIn" placeholder="Add a task\u2026" autocomplete="off" enterkeyhint="done"><button id="bqGo" type="button">Add</button></div>';
    if (al.length) h += '<p style="margin-top:8px"><b>Today</b></p>' + al.map(function (a) { return '<div>\u2022 ' + esc(a.label) + ' \u2013 ' + new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</div>'; }).join('');
    return h;
  }
  function decorateBrief() {
    var c = $('xBrief'), bt = $('xBT');
    if (!c || !bt || c.getAttribute('data-q')) return;
    c.setAttribute('data-q', '1');
    var paint = function () { var keep = $('bqIn') ? $('bqIn').value : ''; bt.innerHTML = briefHtml(); if (keep && $('bqIn')) $('bqIn').value = keep; refreshBadge(); if (isOpen() && tab === 'tasks') renderBody(); };
    paint();
    var add = function () { var i = $('bqIn'); if (i && addTask(i.value)) { i.value = ''; paint(); var n = $('bqIn'); if (n) n.focus(); } };
    c.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-bq],#bqGo') : null; if (!el) return;
      if (el.id === 'bqGo') { add(); return; }
      var id = el.getAttribute('data-id'), k = tasks(); k.forEach(function (x) { if (String(x.id) === id) x.done = true; }); jset('core_tasks', k); buzz(10); paint();
    });
    c.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'bqIn') { e.preventDefault(); add(); } });
  }
  new MutationObserver(function () { var c = $('xBrief'); if (c && !c.getAttribute('data-q')) decorateBrief(); }).observe(doc.body || doc.documentElement, { childList: true });

  function start() { build(); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
  W.CORE_TOOLS = { open: open, close: close };
})();
