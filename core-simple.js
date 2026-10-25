/* CORE simple chat: a clean, plain chat screen (no 3D, no HUD) that runs the offline GGUF model on this phone.
   Default screen on Android. "Full mode" in the side menu opens the original interface. */
(function () {
  'use strict';
  var NAT = window.CORE_NATIVE, X = window.CORE_X, doc = document, W = window;
  if (!NAT || !X) return;
  var P = X.prefs;

  // MD-START
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inline(t) {
    t = esc(t);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    return t;
  }
  function block(t) {
    var h = '', list = null;
    function closeList() { if (list) { h += '</' + list + '>'; list = null; } }
    t.split('\n').forEach(function (l) {
      var m;
      if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { closeList(); h += '<ul>'; list = 'ul'; } h += '<li>' + inline(m[1]) + '</li>'; }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); h += '<ol>'; list = 'ol'; } h += '<li>' + inline(m[1]) + '</li>'; }
      else if ((m = l.match(/^#{1,4}\s+(.*)/))) { closeList(); h += '<h4>' + inline(m[1]) + '</h4>'; }
      else if (!l.trim()) { closeList(); }
      else { closeList(); h += '<p>' + inline(l) + '</p>'; }
    });
    closeList();
    return h;
  }
  function md(src) {
    var parts = String(src || '').split('```'), out = '';
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var code = parts[i], nl = code.indexOf('\n'), lang = '';
        if (nl >= 0) { lang = code.slice(0, nl).trim(); code = code.slice(nl + 1); }
        out += '<div class="scCode"><div class="scCodeHd"><span>' + esc(lang || 'code') + '</span><button data-copy="1">Copy</button></div><pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre></div>';
      } else out += block(parts[i]);
    }
    return out;
  }
  // MD-END

  function parseJ(s, d) { try { var v = JSON.parse(s); return (v === null || v === undefined) ? d : v; } catch (e) { return d; } }
  function saveP() { try { localStorage.setItem('core_prefs', JSON.stringify(P)); } catch (e) {} }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var KEY = 'core_simple_chats';
  var chats = parseJ(safeGet(KEY), []), cur = null, models = [], sel = '', loadedCtx = 0;
  var gen = null;            // { id, text, body, stopped }
  var loadWait = null, lastErr = '';
  W.addEventListener('error', function (ev) { lastErr = String(ev.message || 'error') + ' (' + String(ev.filename || '').split('/').pop() + ':' + (ev.lineno || 0) + ')'; setDiag(); });
  W.addEventListener('unhandledrejection', function (ev) { lastErr = String((ev.reason && ev.reason.message) || ev.reason || 'error'); setDiag(); });
  function diagText() {
    var st = {};
    try { st = parseJ(NAT.status(), {}); } catch (e) { return 'Bridge error: ' + e.message; }
    return (st.available ? 'Chat engine: ready' : 'Chat engine: NOT installed' + (st.error ? ' (' + st.error + ')' : '')) +
      ' \u00b7 Mode: ' + (online() ? 'Online (' + provName() + ')' : 'Offline') + ' \u00b7 Models found: ' + models.length + (sel ? '' : ' \u00b7 none selected') + (lastErr ? ' \u00b7 Error: ' + lastErr : '');
  }
  function setDiag() { var d = doc.getElementById('scDiag'); if (d) d.textContent = diagText(); }
  function online() { return P.simSource === 'online'; }
  function provName() { var o = cfg('simOnline', 'auto'); return o === 'cloud' ? 'CORE Cloud' : o === 'hf' ? 'Hugging Face' : o === 'poll' ? 'Pollinations' : 'Auto'; }
  var FREE_SYS = 'You are CORE, a private assistant running fully offline on the user\'s own phone. Answer directly and completely, in the length the question needs.';

  if (!Array.isArray(chats)) chats = [];
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(chats.slice(0, 40))); } catch (e) {}
  }
  function newChat() {
    cur = { id: 'c' + Date.now(), title: 'New chat', msgs: [], t: Date.now() };
    chats.unshift(cur);
    return cur;
  }
  function cfg(k, d) { var v = P[k]; return (v === undefined || v === null || v === '') ? d : v; }

  // ---------------------------------------------------------------- UI
  var css = doc.createElement('style');
  css.textContent =
    '#sc{--bg:#141517;--panel:#1c1e21;--line:#2b2e33;--ink:#ececec;--dim:#9aa0a8;--accent:#5b9dff;--user:#26292e;position:fixed;left:0;right:0;top:0;height:100%;z-index:100;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent;touch-action:manipulation}' +
    '@media (prefers-color-scheme:light){#sc{--bg:#fafaf9;--panel:#fff;--line:#e4e4e1;--ink:#1d1f22;--dim:#6b7078;--accent:#2f6fe0;--user:#eeeeeb}}' +
    '#sc,#sc *{pointer-events:auto}#sc textarea,#sc .scBody,#sc .scBub{-webkit-user-select:text;user-select:text}#scDiag{margin-top:18px;font-size:11.5px;color:var(--dim);word-break:break-word;line-height:1.5}#sc .scGhost{border:1px solid var(--line);border-radius:12px;padding:10px 18px;font-weight:600}#sc.scHidden{display:none}#sc *{box-sizing:border-box}#sc button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}' +
    '#scTop{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 8px) 10px 8px;border-bottom:1px solid var(--line);flex:none}' +
    '#scTop .ib{width:42px;height:42px;border-radius:12px;font-size:20px;color:var(--dim)}#scTop .ib:active{background:var(--panel)}' +
    '#sc #scMode{border:1px solid var(--line);border-radius:999px;padding:7px 12px;font-size:12.5px;font-weight:600;color:var(--dim);white-space:nowrap;flex:none}#sc #scMode:active{background:var(--panel)}#sc #scModelBtn{display:flex;align-items:center;gap:6px;max-width:42%;padding:8px 12px;border-radius:12px;font-weight:600;font-size:14px}#sc #scModelBtn:active{background:var(--panel)}' +
    '#scModelName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#scModelBtn i{font-style:normal;color:var(--dim);font-size:11px}' +
    '#scMsgs{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:18px 16px 12px}' +
    '.scWrap{max-width:720px;margin:0 auto}' +
    '.scMsg{margin:0 0 22px}.scMsg.u{display:flex;justify-content:flex-end}' +
    '.scBub{max-width:86%;background:var(--user);padding:10px 14px;border-radius:18px;white-space:pre-wrap;word-break:break-word}' +
    '.scBody p{margin:0 0 .75em}.scBody p:last-child{margin-bottom:0}.scBody ul,.scBody ol{margin:0 0 .75em;padding-left:1.4em}.scBody h4{margin:.9em 0 .4em;font-size:15px}' +
    '.scBody code{background:var(--panel);border:1px solid var(--line);padding:1px 5px;border-radius:6px;font:13px ui-monospace,Menlo,Consolas,monospace}' +
    '.scCode{margin:.5em 0 .9em;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}' +
    '.scCodeHd{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;font-size:12px;color:var(--dim);border-bottom:1px solid var(--line)}' +
    '#sc .scCodeHd button{color:var(--accent);font-size:12px;padding:4px 6px}' +
    '.scCode pre{margin:0;padding:12px;overflow-x:auto}.scCode code{background:none;border:0;padding:0;font-size:12.5px;white-space:pre}' +
    '.scAct{display:flex;gap:4px;margin-top:6px}#sc .scAct button{font-size:12px;color:var(--dim);padding:6px 10px;border-radius:10px}#sc .scAct button:active{background:var(--panel)}' +
    '.scErr{color:#ff8a80}.scDots{display:inline-flex;gap:4px;padding:6px 0}.scDots i{width:6px;height:6px;border-radius:50%;background:var(--dim);animation:scb 1.2s infinite}.scDots i:nth-child(2){animation-delay:.15s}.scDots i:nth-child(3){animation-delay:.3s}' +
    '@keyframes scb{0%,80%,100%{opacity:.25}40%{opacity:1}}' +
    '.scEmpty{text-align:center;padding:12vh 12px 0}.scEmpty h2{margin:0 0 6px;font-size:24px;font-weight:600}.scEmpty p{margin:0 0 18px;color:var(--dim);font-size:14px}' +
    '.scChips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:16px}#sc .scChips button{border:1px solid var(--line);border-radius:999px;padding:9px 14px;font-size:13.5px;background:var(--panel)}' +
    '.scPrimary{background:var(--accent)!important;color:#fff!important;border-radius:12px;padding:10px 18px;font-weight:600}' +
    '#scBar{flex:none;padding:8px 12px calc(env(safe-area-inset-bottom,0px) + 10px)}' +
    '#scBox{max-width:720px;margin:0 auto;display:flex;align-items:flex-end;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:6px 6px 6px 16px}' +
    '#scIn{flex:1;resize:none;border:0;outline:0;background:transparent;color:var(--ink);font:inherit;max-height:140px;padding:8px 0;min-height:24px}' +
    '#sc #scSend{width:40px;height:40px;border-radius:50%;background:var(--accent);color:#fff;font-size:18px;flex:none;display:flex;align-items:center;justify-content:center}#sc #scSend[disabled]{opacity:.35}' +
    '#scNote{max-width:720px;margin:6px auto 0;text-align:center;font-size:11px;color:var(--dim)}' +
    '#scDim{position:fixed;inset:0;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .2s;z-index:2}#scDim.on{opacity:1;pointer-events:auto}' +
    '#scSide{position:fixed;top:0;bottom:0;left:0;width:min(82vw,320px);background:var(--bg);border-right:1px solid var(--line);transform:translateX(-102%);transition:transform .22s;z-index:3;display:flex;flex-direction:column;padding:calc(env(safe-area-inset-top,0px) + 12px) 12px calc(env(safe-area-inset-bottom,0px) + 12px)}#scSide.on{transform:none}' +
    '#scSide .nb{border:1px solid var(--line);border-radius:12px;padding:11px 14px;text-align:left;font-weight:600;margin-bottom:10px}' +
    '#scList{flex:1;overflow-y:auto}.scRow{display:flex;align-items:center;border-radius:10px}.scRow.on{background:var(--panel)}#sc .scRow>button:first-child{flex:1;text-align:left;padding:10px 10px;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#sc .scRow .x{color:var(--dim);width:36px;height:36px}' +
    '#scSide .ft{border-top:1px solid var(--line);padding-top:8px}#scSide .ft button{display:block;width:100%;text-align:left;padding:11px 10px;color:var(--dim);font-size:14px;border-radius:10px}#scSide .ft button:active{background:var(--panel)}' +
    '#scSheet{position:fixed;left:0;right:0;bottom:0;max-height:70%;overflow-y:auto;background:var(--panel);border-top:1px solid var(--line);border-radius:20px 20px 0 0;transform:translateY(105%);transition:transform .22s;z-index:3;padding:14px 14px calc(env(safe-area-inset-bottom,0px) + 14px)}#scSheet.on{transform:none}' +
    '#scSheet h3{margin:2px 4px 10px;font-size:13px;color:var(--dim);font-weight:600;letter-spacing:.3px}' +
    '#sc .scOpt{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;padding:12px;border-radius:12px;font-size:14px}#sc .scOpt.on{background:var(--bg);outline:1px solid var(--accent)}#sc .scOpt small{color:var(--dim)}' +
    '#scChip{position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);left:10px;z-index:30;border:1px solid rgba(255,255,255,.25);background:rgba(10,14,16,.85);color:#fff;border-radius:999px;padding:7px 13px;font:600 12px system-ui,sans-serif;display:none}';
  doc.head.appendChild(css);

  var sc = doc.createElement('div');
  sc.id = 'sc';
  sc.innerHTML =
    '<div id="scDim"></div>' +
    '<aside id="scSide"><button class="nb" id="scNew">+ New chat</button><div id="scList"></div>' +
    '<div class="ft"><button id="scSettings">Models &amp; settings</button><button id="scFull">Open full mode</button></div></aside>' +
    '<header id="scTop"><button class="ib" id="scMenu" aria-label="Chats">\u2630</button>' +
    '<button id="scModelBtn"><span id="scModelName">Choose model</span><i>\u25BE</i></button>' +
    '<button id="scMode" aria-label="Switch to normal mode">Normal \u21C4</button><button class="ib" id="scNew2" aria-label="New chat">\u270E</button></header>' +
    '<main id="scMsgs"><div class="scWrap" id="scThread"></div></main>' +
    '<footer id="scBar"><div id="scBox"><textarea id="scIn" rows="1" placeholder="Message CORE"></textarea>' +
    '<button id="scSend" aria-label="Send" disabled>\u2191</button></div>' +
    '<div id="scNote">Runs on your phone, offline. Answers can be wrong.</div></footer>' +
    '<div id="scSheet"></div>';
  var chip = doc.createElement('button');
  chip.id = 'scChip'; chip.textContent = 'Simple chat';

  function $(id) { return doc.getElementById(id); }

  // ---------------------------------------------------------------- models
  function refreshModels() {
    var all = parseJ(NAT.listModels(), []);
    models = all.filter(function (m) { return !m.support && (m.cat === 'chat' || m.cat === 'code') && m.fmt === 'gguf'; });
    var paths = models.map(function (m) { return m.path; });
    if (!(sel && paths.indexOf(sel) >= 0)) {
      sel = (P.simModel && paths.indexOf(P.simModel) >= 0) ? P.simModel :
        (P.offModels && P.offModels.chat && paths.indexOf(P.offModels.chat) >= 0) ? P.offModels.chat : (paths[0] || '');
    }
    var cm = models.filter(function (m) { return m.path === sel; })[0];
    $('scModelName').textContent = online() ? 'Online \u00b7 ' + provName() : (cm ? cm.name.replace(/\.gguf$/i, '') : 'Add a model');
    $('scNote').textContent = online() ? 'Online: your messages are sent to a cloud AI. Answers can be wrong.' : 'Runs on your phone, offline. Answers can be wrong.';
    if (cur) renderThread();
  }
  function openSheet() {
    var h = '<h3>MODEL</h3>';
    models.forEach(function (m) {
      h += '<button class="scOpt' + (m.path === sel && !online() ? ' on' : '') + '" data-path="' + esc(m.path).replace(/"/g, '&quot;') + '"><span>' + esc(m.name.replace(/\.gguf$/i, '')) + '</span><small>' + (m.mb ? (m.mb >= 1024 ? (m.mb / 1024).toFixed(1) + ' GB' : Math.round(m.mb) + ' MB') : '') + '</small></button>';
    });
    if (!models.length) h += '<div style="padding:8px 6px;color:var(--dim);font-size:14px">No model yet. Add a .gguf file to start chatting.</div>';
    h += '<button class="scOpt" id="scAddModel"><span>+ Add a model (.gguf)</span></button>';
    h += '<h3 style="margin-top:14px">ONLINE (sends your messages to the internet)</h3>';
    (W.CORE_PHONE && W.CORE_PHONE.cloudReady() ? [['cloud', 'CORE Cloud', 'your own server \u00b7 streaming']] : []).concat([['auto', 'Auto (free)', 'Puter, then Hugging Face, then Pollinations'], ['hf', 'Hugging Face', 'Llama 3.1 8B \u00b7 needs your token'], ['poll', 'Pollinations', 'no account']]).forEach(function (o) {
      h += '<button class="scOpt' + (online() && cfg('simOnline', 'auto') === o[0] ? ' on' : '') + '" data-online="' + o[0] + '"><span>' + o[1] + '</span><small>' + o[2] + '</small></button>';
    });
    h += '<div id="scDiag" style="padding:8px 6px">' + esc(diagText()) + '</div>';
    $('scSheet').innerHTML = h;
    $('scSheet').classList.add('on'); $('scDim').classList.add('on');
  }
  function closeAll() { ['scSheet', 'scSide', 'scDim'].forEach(function (i) { $(i).classList.remove('on'); }); }

  // ---------------------------------------------------------------- rendering
  function nearBottom(m) { return m.scrollHeight - m.scrollTop - m.clientHeight < 140; }
  function renderThread() {
    var t = $('scThread'), m = $('scMsgs'), stick = nearBottom(m) || !t.childNodes.length;
    if (!cur || !cur.msgs.length) {
      var ready = !!sel || online();
      t.innerHTML = '<div class="scEmpty"><h2>How can I help you today?</h2><p>' +
        (online() ? 'Online mode. Your messages are sent to a cloud AI.' : ready ? 'Private and offline. Everything stays on this phone.' : 'Add a model to chat offline, or use an online AI.') + '</p>' +
        (ready ? '<div class="scChips"><button>Explain something simply</button><button>Help me write code</button><button>Draft a message</button><button>Brainstorm ideas</button></div>' :
          '<button class="scPrimary" id="scAddEmpty">Add a model (.gguf)</button><div style="height:10px"></div><button class="scGhost" id="scGoOnline">Use online instead</button>') + '<div id="scDiag">' + esc(diagText()) + '</div></div>';
      return;
    }
    var h = '';
    cur.msgs.forEach(function (x, i) {
      if (x.role === 'user') h += '<div class="scMsg u"><div class="scBub">' + esc(x.content) + '</div></div>';
      else {
        var last = i === cur.msgs.length - 1, live = gen && last;
        h += '<div class="scMsg a"><div class="scBody' + (x.err ? ' scErr' : '') + '" data-i="' + i + '">' +
          (live && !x.content ? '<span class="scDots"><i></i><i></i><i></i></span>' : (x.err ? esc(x.content) : md(x.content))) + '</div>' +
          (live ? '' : '<div class="scAct"><button data-a="copy" data-i="' + i + '">Copy</button>' + (last ? '<button data-a="retry">Retry</button>' : '') + '</div>') + '</div>';
      }
    });
    t.innerHTML = h;
    if (stick) m.scrollTop = m.scrollHeight;
  }
  function renderList() {
    var h = '';
    chats.forEach(function (c) {
      h += '<div class="scRow' + (cur && c.id === cur.id ? ' on' : '') + '"><button data-c="' + c.id + '">' + esc(c.title) + '</button><button class="x" data-d="' + c.id + '" aria-label="Delete">\u2715</button></div>';
    });
    $('scList').innerHTML = h || '<div style="color:var(--dim);font-size:13px;padding:8px">No chats yet.</div>';
  }
  var raf = 0;
  function paintStream() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      if (!gen) return;
      var m = $('scMsgs'), stick = nearBottom(m), el = $('scThread').querySelector('.scMsg:last-child .scBody');
      if (el) el.innerHTML = gen.text ? md(gen.text) : '<span class="scDots"><i></i><i></i><i></i></span>';
      if (stick) m.scrollTop = m.scrollHeight;
    });
  }
  function setBusy(b) {
    var s = $('scSend');
    s.textContent = b ? '\u25A0' : '\u2191';
    s.setAttribute('aria-label', b ? 'Stop' : 'Send');
    s.disabled = !b && !$('scIn').value.trim();
  }

  // ---------------------------------------------------------------- engine
  function ensureModel() {
    if (!sel) return Promise.reject(new Error('NO_MODEL'));
    var st = parseJ(NAT.status(), {});
    if (!st.available) return Promise.reject(new Error('The offline engine (libcore_llm.so) is not installed in this build.'));
    var ctx = parseInt(cfg('offCtx', 4096), 10) || 4096;
    if (st.loaded === sel && loadedCtx === ctx) return Promise.resolve();
    if (st.loaded === sel) NAT.unload();
    return new Promise(function (ok, fail) { loadWait = { ok: ok, fail: fail }; loadedCtx = ctx; NAT.load(sel, ctx); });
  }
  // ---------------------------------------------------------------- online providers
  var HF_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';
  function push(token, t) {
    if (gen !== token || token.stopped || !t) return;
    token.text += t;
    var a = cur.msgs[cur.msgs.length - 1]; if (a) a.content = token.text;
    paintStream();
  }
  function onlineMsgs(chat) {
    var keep = Math.max(2, parseInt(cfg('offHist', 16), 10) || 16);
    var hist = chat.msgs.slice(0, -1).slice(-keep).map(function (x) { return { role: x.role, content: x.content }; });
    var sys = String(cfg('offSys', '')).trim() || 'You are CORE, a helpful assistant. Answer clearly and directly, in the length the question needs.';
    return [{ role: 'system', content: sys }].concat(hist);
  }
  function maxTokens() { return parseInt(cfg('offMaxTok', 1024), 10) || 1024; }
  var PROV = {
    cloud: function (token, msgs) { return W.CORE_PHONE.streamChat(token, msgs, push, maxTokens()); },
    puter: async function (token, msgs) {
      if (!W.puter || !W.puter.ai) throw new Error('Puter is not available');
      var r = await W.puter.ai.chat(msgs, { stream: true, max_tokens: maxTokens() });
      if (r && typeof r[Symbol.asyncIterator] === 'function') {
        for await (var part of r) { if (token.stopped) break; push(token, part && (part.text || (part.message && part.message.content))); }
      } else {
        var c = r && r.message && r.message.content;
        push(token, typeof r === 'string' ? r : (typeof c === 'string' ? c : (c && c[0] && c[0].text)));
      }
    },
    hf: async function (token, msgs) {
      var tk = safeGet('core_hf_token') || '';
      if (!tk) throw new Error('Add your Hugging Face token in normal mode: Settings > Brain');
      var ctl = new AbortController(); token.abort = function () { ctl.abort(); };
      var res = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
        body: JSON.stringify({ model: HF_MODEL, messages: msgs, max_tokens: maxTokens(), stream: true })
      });
      if (!res.ok) throw new Error('Hugging Face error ' + res.status);
      var rd = res.body.getReader(), dec = new TextDecoder(), buf = '';
      for (;;) {
        var r = await rd.read(); if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split('\n'); buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var ln = lines[i].trim(); if (ln.indexOf('data:') !== 0) continue;
          var d = ln.slice(5).trim(); if (d === '[DONE]') return;
          var j = parseJ(d, null), t = j && j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (t) push(token, t);
        }
      }
    },
    poll: async function (token, msgs) {
      var ctl = new AbortController(); token.abort = function () { ctl.abort(); };
      try {
        var res = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'openai', messages: msgs })
        });
        if (res.ok) {
          var j = await res.json(), t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (t) { push(token, t); return; }
        }
      } catch (e) { if (token.stopped) return; }
      // fallback: plain GET with the system prompt and the latest user line (same as the main app)
      var sys = msgs.filter(function (m) { return m.role === 'system'; })[0];
      var lastU = msgs.filter(function (m) { return m.role === 'user'; }).pop();
      var prompt = (sys ? sys.content + '\n\n' : '') + 'User: ' + (lastU ? lastU.content : '');
      var r2 = await fetch('https://text.pollinations.ai/' + encodeURIComponent(prompt), { signal: ctl.signal });
      if (!r2.ok) throw new Error('Pollinations error ' + r2.status);
      push(token, (await r2.text()).trim());
    }
  };
  async function runOnline(token, chat) {
    token.online = true;
    if (navigator.onLine === false) { finish(token, 'You are offline. Connect to the internet, or pick an on-phone model in the model menu.', true); return; }
    var msgs = onlineMsgs(chat), pref = cfg('simOnline', 'auto'), tries;
    if (pref === 'cloud') tries = ['cloud']; else if (pref === 'hf') tries = ['hf']; else if (pref === 'poll') tries = ['poll'];
    else {
      tries = [];
      if (W.CORE_PHONE && W.CORE_PHONE.cloudReady()) tries.push('cloud');
      try { if (W.puter && W.puter.auth && W.puter.auth.isSignedIn && W.puter.auth.isSignedIn()) tries.push('puter'); } catch (e) {}
      if (safeGet('core_hf_token')) tries.push('hf');
      tries.push('poll');
    }
    var lastErr = '';
    for (var i = 0; i < tries.length; i++) {
      if (token.stopped) return;
      try {
        await PROV[tries[i]](token, msgs);
        if (token.stopped) return;
        if (token.text) { finish(token, W.CORE_PHONE ? W.CORE_PHONE.afterReply(token.text, phoneUI) : token.text, false); return; }
        lastErr = 'Empty reply';
      } catch (e) {
        if (token.stopped) return;
        lastErr = (e && e.message) || String(e);
        if (token.text) { finish(token, token.text, false); return; }
      }
    }
    finish(token, 'Online chat failed: ' + lastErr, true);
  }

  // helpers for core-phone.js: add an assistant note (optionally with the user's line) without calling a model
  var phoneUI = {
    say: function (t, userLine) {
      if (!cur) newChat();
      if (chats.indexOf(cur) < 0) chats.unshift(cur);
      if (userLine) cur.msgs.push({ role: 'user', content: userLine });
      var m = { role: 'assistant', content: t };
      cur.msgs.push(m); cur.t = Date.now();
      var inp = $('scIn'); if (inp) { inp.value = ''; autosize(); }
      persist(); renderThread(); renderList();
      return m;
    },
    refresh: function () { persist(); renderThread(); }
  };
  function send(text) {
    text = String(text || '').trim();
    if (!text || gen) return;
    if (W.CORE_PHONE && W.CORE_PHONE.handle(text, phoneUI)) return;
    if (!cur) newChat();
    var chat = cur;
    if (chats.indexOf(chat) < 0) chats.unshift(chat);
    chat.msgs.push({ role: 'user', content: text });
    if (chat.title === 'New chat') chat.title = text.length > 38 ? text.slice(0, 38) + '\u2026' : text;
    chat.msgs.push({ role: 'assistant', content: '' });
    chat.t = Date.now();
    var token = { id: 'sc' + Date.now(), text: '', stopped: false };
    gen = token;
    $('scIn').value = ''; autosize(); setBusy(true); renderThread(); renderList();
    if (online()) { runOnline(token, chat); return; }
    ensureModel().then(function () {
      if (token.stopped) { finish(token, '', false); return; }
      var keep = Math.max(2, parseInt(cfg('offHist', 16), 10) || 16);
      var hist = chat.msgs.slice(0, -1).slice(-keep).map(function (x) { return { role: x.role, content: x.content }; });
      var sys = String(cfg('offSys', '')).trim() || FREE_SYS;
      var maxTok = parseInt(cfg('offMaxTok', 1024), 10) || 1024;
      var temp = parseFloat(cfg('offTemp', 0.7)); if (isNaN(temp)) temp = 0.7;
      NAT.chat(token.id, JSON.stringify([{ role: 'system', content: sys }].concat(hist)), maxTok, temp);
    }).catch(function (err) {
      finish(token, err.message === 'NO_MODEL' ? 'Add a model first (tap the model name at the top).' : err.message, true);
    });
  }
  function finish(token, text, isErr) {
    if (gen !== token) return;
    gen = null;
    var chat = cur, a = chat && chat.msgs[chat.msgs.length - 1];
    if (a && a.role === 'assistant') {
      if (isErr) { a.content = text; a.err = true; }
      else { a.content = (text || token.text || '').trim(); if (!a.content) chat.msgs.pop(); }
    }
    persist(); setBusy(false); renderThread();
  }
  function handleEv(e) {
    if (!e || !e.type) return;
    if (e.id && String(e.id).indexOf('sc') === 0) {
      if (!gen || gen.id !== e.id) return;
      if (e.type === 'token') { gen.text += e.text || ''; var a = cur.msgs[cur.msgs.length - 1]; if (a) a.content = gen.text; paintStream(); }
      else if (e.type === 'done') finish(gen, e.text, false);
      else if (e.type === 'error') finish(gen, gen.stopped ? gen.text : (e.text || 'Generation failed.'), !gen.stopped);
      return;
    }
    if (e.type === 'loaded' && loadWait) { var w = loadWait; loadWait = null; w.ok(); }
    else if (e.type === 'error' && !e.id && loadWait) { var f = loadWait; loadWait = null; f.fail(new Error(e.text || 'Could not load the model.')); }
    else if (e.type === 'added' || e.type === 'copyDone') refreshModels();
  }
  var prevEv = W.CORE_NATIVE_EVENT;
  W.CORE_NATIVE_EVENT = function (raw) {
    var e = typeof raw === 'string' ? parseJ(raw, {}) : raw;
    try { handleEv(e); } catch (x) {}
    if (prevEv) return prevEv(raw);
  };

  // ---------------------------------------------------------------- behaviour
  function autosize() { var i = $('scIn'); i.style.height = 'auto'; i.style.height = Math.min(140, i.scrollHeight) + 'px'; }
  function fit() { var v = W.visualViewport; sc.style.height = (v ? v.height : W.innerHeight) + 'px'; sc.style.top = (v ? v.offsetTop : 0) + 'px'; }
  var origSkip = null;
  function pause3D(on) {
    var n = 0, t = setInterval(function () {
      var pf = W.__PERF;
      if (pf && typeof pf.skip === 'function') {
        if (!origSkip) origSkip = pf.skip;
        pf.skip = on ? function () { return true; } : origSkip;
        clearInterval(t);
      } else if (++n > 40) clearInterval(t);
    }, 250);
  }
  function setMode(simple) {
    sc.classList.toggle('scHidden', !simple);
    chip.style.display = simple ? 'none' : 'block';
    if (simple || origSkip) pause3D(simple);
    if (simple) { refreshModels(); renderThread(); renderList(); }
  }

  function init() {
    try { initInner(); } catch (err) {
      try { if (!chip.parentNode) doc.body.appendChild(chip); sc.classList.add('scHidden'); pause3D(false); chip.textContent = 'Simple chat failed: ' + err.message; chip.style.display = 'block'; } catch (e) {}
    }
  }
  function initInner() {
    doc.body.appendChild(sc); doc.body.appendChild(chip);
    cur = { id: 'c' + Date.now(), title: 'New chat', msgs: [], t: Date.now() };   // fresh chat, saved on first message
    fit();
    if (W.visualViewport) { W.visualViewport.addEventListener('resize', fit); W.visualViewport.addEventListener('scroll', fit); }
    W.addEventListener('resize', fit);

    $('scIn').addEventListener('input', function () { autosize(); if (!gen) $('scSend').disabled = !this.value.trim(); });
    $('scSend').addEventListener('click', function () {
      if (gen) {
        gen.stopped = true;
        if (gen.online) { try { if (gen.abort) gen.abort(); } catch (e) {} finish(gen, gen.text, false); }
        else { try { NAT.cancel(); } catch (e) {} }
        return;
      }
      send($('scIn').value);
    });
    $('scMenu').addEventListener('click', function () { renderList(); $('scSide').classList.add('on'); $('scDim').classList.add('on'); });
    $('scDim').addEventListener('click', closeAll);
    $('scModelBtn').addEventListener('click', openSheet);
    function fresh() {
      if (gen) return;
      cur = { id: 'c' + Date.now(), title: 'New chat', msgs: [], t: Date.now() };
      renderThread(); renderList(); closeAll();
    }
    $('scNew').addEventListener('click', fresh); $('scNew2').addEventListener('click', fresh);
    $('scMode').addEventListener('click', function () { closeAll(); setMode(false); });
    $('scFull').addEventListener('click', function () { closeAll(); setMode(false); });
    $('scSettings').addEventListener('click', function () {
      closeAll(); setMode(false);
      setTimeout(function () { var b = $('settingsBtn'); if (b) b.click(); }, 150);
    });
    chip.addEventListener('click', function () { setMode(true); });

    $('scSheet').addEventListener('click', function (ev) {
      var o = ev.target.closest('.scOpt'); if (!o) return;
      if (o.id === 'scAddModel') { closeAll(); try { NAT.pickModel('chat'); } catch (e) {} return; }
      var on = o.getAttribute('data-online');
      if (on) { P.simSource = 'online'; P.simOnline = on; saveP(); refreshModels(); closeAll(); renderThread(); return; }
      P.simSource = 'local';
      sel = o.getAttribute('data-path'); P.simModel = sel; saveP(); refreshModels(); closeAll();
    });
    $('scList').addEventListener('click', function (ev) {
      var d = ev.target.closest('[data-d]'), c = ev.target.closest('[data-c]');
      if (d) {
        var id = d.getAttribute('data-d');
        chats = chats.filter(function (x) { return x.id !== id; }); persist();
        if (cur && cur.id === id) cur = { id: 'c' + Date.now(), title: 'New chat', msgs: [], t: Date.now() };
        renderList(); renderThread();
      } else if (c && !gen) {
        var cid = c.getAttribute('data-c');
        cur = chats.filter(function (x) { return x.id === cid; })[0] || cur;
        renderThread(); closeAll();
      }
    });
    $('scThread').addEventListener('click', function (ev) {
      var cp = ev.target.closest('[data-copy]'), a = ev.target.closest('[data-a]'), chipB = ev.target.closest('.scChips button'), add = ev.target.closest('#scAddEmpty');
      if (ev.target.closest('#scGoOnline')) { P.simSource = 'online'; saveP(); refreshModels(); renderThread(); return; }
      if (add) { try { NAT.pickModel('chat'); } catch (e) {} return; }
      if (chipB) { send(chipB.textContent); return; }
      if (cp) { copy(cp.closest('.scCode').querySelector('code').textContent, cp); return; }
      if (a && a.getAttribute('data-a') === 'copy') { copy(cur.msgs[parseInt(a.getAttribute('data-i'), 10)].content, a); return; }
      if (a && a.getAttribute('data-a') === 'retry' && !gen) {
        var m = cur.msgs; m.pop();
        var u = m.pop(); if (u && u.role === 'user') send(u.content);
      }
    });
    refreshModels(); renderThread(); renderList(); setBusy(false);
    setMode(W.CORE_SIMPLE_START === true);   // the app always starts in normal mode; the Simple chat button opens this screen
  }
  function copy(text, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = o; }, 1200); };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
    function fallback() {
      var t = doc.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; doc.body.appendChild(t);
      t.select(); try { doc.execCommand('copy'); done(); } catch (e) {} doc.body.removeChild(t);
    }
  }

  if (doc.body) init(); else doc.addEventListener('DOMContentLoaded', init);
  W.CORE_SIMPLE = { show: function () { setMode(true); }, hide: function () { setMode(false); } };
})();
