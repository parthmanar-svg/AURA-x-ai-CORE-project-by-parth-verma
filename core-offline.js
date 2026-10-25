/* CORE offline models: a model library (Settings > Models) + offline routing for chat/code.
   Android app only (needs window.CORE_NATIVE). Add models per category; GGUF runs today (llama.cpp), other formats are
   stored and labelled with the real route to run them. Unrestricted mode = no app-side limits or system-prompt filtering. */
(function () {
  'use strict';
  var NAT = window.CORE_NATIVE, X = window.CORE_X;
  if (!X) return;
  var P = X.prefs, doc = document;
  var $ = function (i) { return doc.getElementById(i); };
  function save() { try { localStorage.setItem('core_prefs', JSON.stringify(P)); } catch (e) {} }
  function say(t) { if (window.CORE_SAY) try { window.CORE_SAY(t); } catch (e) {} }
  function parse(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
  function esc(s) { var d = doc.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function attr(s) { return esc(s).replace(/"/g, '&quot;'); }

  // ---- what we know about models ----
  var CATS = [
    { id: 'chat',   name: 'Chat',            hint: 'General assistant',                     fmt: 'GGUF' },
    { id: 'code',   name: 'Coding',          hint: 'Code generation and debugging',         fmt: 'GGUF' },
    { id: 'image',  name: 'Text to image',   hint: 'Stable Diffusion, SDXS, Turbo',         fmt: 'SAFETENSORS, CKPT, GGUF' },
    { id: 'stt',    name: 'Speech to text',  hint: 'Whisper and similar',                   fmt: 'ONNX, BIN, TFLITE' },
    { id: 'tts',    name: 'Text to speech',  hint: 'Piper and similar voices',              fmt: 'ONNX (+ .json)' },
    { id: 'vision', name: 'Vision',          hint: 'Detection, faces, image understanding', fmt: 'TFLITE, ONNX, GGUF' },
    { id: 'embed',  name: 'Embeddings',      hint: 'Search and memory',                     fmt: 'GGUF, ONNX' },
    { id: 'other',  name: 'Other',           hint: 'Anything else',                         fmt: 'any' }
  ];
  var FMT = {
    gguf: 'GGUF', ckpt: 'CKPT', ggml: 'GGML', pb: 'SAVEDMODEL', tf: 'SAVEDMODEL', keras: 'KERAS', h5: 'KERAS/H5', pkl: 'PICKLE', mlmodel: 'COREML', engine: 'TENSORRT', xml: 'OPENVINO', gptq: 'GPTQ', awq: 'AWQ', onnx: 'ONNX', ort: 'ORT', tflite: 'TFLITE', task: 'TASK', litertlm: 'LITERT', bin: 'BIN',
    safetensors: 'SAFETENSORS', pt: 'PT', pth: 'PTH', json: 'JSON', txt: 'TXT', model: 'MODEL', vocab: 'VOCAB', merges: 'MERGES'
  };
  var CODE_RE = /\b(code|coding|script|function|program|python|javascript|typescript|java|kotlin|c\+\+|c#|html|css|sql|bash|shell|regex|debug|bug|compile|compiler|class|algorithm|refactor|snippet|api|json|lua|rust|golang)\b/i;

  var models = [], engines = {}, info = {}, copyState = null, copyErr = '';
  var hist = [], pending = {}, seq = 0, loadWait = null;

  // selections per category: { chat: path, code: path, ... }; migrate the old two-field prefs
  P.offModels = P.offModels || {};
  if (P.offChat && !P.offModels.chat) P.offModels.chat = P.offChat;
  if (P.offCode && !P.offModels.code) P.offModels.code = P.offCode;

  var loadedCtx = 0;
  var FREE_SYS = 'You are CORE, a private assistant running fully offline on the user\'s own phone. Answer directly and completely, in the length the question needs.';
  function cfg(k, d) { var v = P[k]; return (v === undefined || v === null || v === '') ? d : v; }
  function sysPrompt(code) {
    var custom = String(cfg('offSys', '')).trim();
    if (custom) return custom;
    if (cfg('offFree', true)) return code ? FREE_SYS + ' For code, reply with working code in fenced blocks.' : FREE_SYS;
    return code
      ? 'You are CORE, an offline coding assistant. Give working code in fenced blocks and explain briefly.'
      : 'You are CORE, a concise assistant running fully offline on the user\'s phone. Answer in a few short sentences. If unsure, say so.';
  }
  // how each format gets onto the phone: run natively, convert (tools/convert-model.yml), or impossible on Android
  var ROUTE = {
    safetensors: 'convert to GGUF', pt: 'convert to GGUF', pth: 'convert to GGUF', ggml: 'convert to GGUF', gptq: 'convert to GGUF', awq: 'convert to GGUF',
    pb: 'convert to TFLite', tf: 'convert to TFLite', keras: 'convert to TFLite', h5: 'convert to TFLite',
    pkl: 'convert to ONNX (never run on-device)',
    mlmodel: 'Apple-only: convert the source model', engine: 'NVIDIA-only: convert the source model', xml: 'Intel-only: convert the source model'
  };
  function convertHint(f) { return !!ROUTE[f]; }
  var imgState = { busy: false, prog: '', src: '', err: '' };
  function imgOk(m) { return m.cat === 'image' && !m.support && ['safetensors', 'ckpt', 'gguf'].indexOf(m.fmt) >= 0; }
  function runnable(m) { return imgOk(m) ? !!info.imageEngine : runnable0(m); }
  function runnable0(m) { return !!(engines.gguf && m.fmt === 'gguf' && !m.support && (m.cat === 'chat' || m.cat === 'code' || m.cat === 'unsorted')); }
  function byPath(p) { for (var i = 0; i < models.length; i++) if (models[i].path === p) return models[i]; return null; }
  function mbStr(mb) { return mb >= 1024 ? (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB' : mb + ' MB'; }
  function refresh() {
    if (!NAT) return;
    info = parse(NAT.status(), {}); engines = info.engines || {};
    models = parse(NAT.listModels(), []);
    // drop selections whose file is gone
    Object.keys(P.offModels).forEach(function (k) { if (P.offModels[k] && !byPath(P.offModels[k])) delete P.offModels[k]; });
  }

  // ---- native events ----
  window.CORE_NATIVE_EVENT = function (raw) {
    var e = typeof raw === 'string' ? parse(raw, {}) : raw;
    if (!e || !e.type) return;
    switch (e.type) {
      case 'copy': copyState = e; copyErr = ''; paintProgress(); return;
      case 'added':
        refresh();
        var m = byPath(e.path);
        if (m && !m.support && !P.offModels[e.cat] && e.cat !== 'other') { P.offModels[e.cat] = e.path; save(); }
        paint(); return;
      case 'copyDone':
        copyState = null; refresh(); paint();
        if (e.added) say(e.added + (e.added === 1 ? ' model' : ' models') + ' added.');
        return;
      case 'imgprog': imgState.prog = e.text || ''; var ip = $('iProg'); if (ip) ip.textContent = imgState.prog; return;
      case 'image': imgState.busy = false; imgState.err = ''; imgState.src = e.text || ''; paint(); return;
      case 'copyError': copyErr = e.text || 'Could not add the file.'; copyState = null; paint(); return;
    }
    if (e.id && String(e.id).indexOf('img') === 0) {
      if (e.type === 'error') { imgState.busy = false; imgState.err = e.text || 'Image failed.'; paint(); }
      return;
    }
    if (e.type === 'loaded' || (e.type === 'error' && !e.id)) {
      if (loadWait) { var w = loadWait; loadWait = null; e.type === 'loaded' ? w.ok(e.text) : w.fail(new Error(e.text || 'load failed')); }
      return;
    }
    var p = pending[e.id]; if (!p) return;
    if (e.type === 'token') { p.partial += e.text; }
    else if (e.type === 'done') { delete pending[e.id]; p.ok(e.text || p.partial); }
    else if (e.type === 'error') { delete pending[e.id]; p.fail(new Error(e.text || 'generation failed')); }
  };

  // ---- offline answering (GGUF via llama.cpp) ----
  function ensureLoaded(path) {
    var st = parse(NAT.status(), {}), ctx = parseInt(cfg('offCtx', 4096), 10) || 4096;
    if (st.loaded === path && loadedCtx === ctx) return Promise.resolve();
    if (st.loaded === path) NAT.unload(); // context size changed: reload
    return new Promise(function (ok, fail) {
      loadWait = { ok: ok, fail: fail };
      say('Loading the offline model\u2026 this can take a minute.');
      loadedCtx = ctx;
      NAT.load(path, ctx);
    });
  }
  function generate(path, msgs, maxTok, temp) {
    return ensureLoaded(path).then(function () {
      return new Promise(function (ok, fail) {
        var id = 'g' + (++seq);
        pending[id] = { ok: ok, fail: fail, partial: '' };
        NAT.chat(id, JSON.stringify(msgs), maxTok, temp);
      });
    });
  }
  function engineReady() { return !!(NAT && parse(NAT.status(), {}).available); }
  function wanted() { return P.offlineMode || (P.offlineAuto !== false && !navigator.onLine); }
  function usable(path) { var m = path && byPath(path); return m && runnable(m) ? path : ''; }

  function answer(text) {
    if (!models.length) refresh();
    var code = CODE_RE.test(text), pc = usable(P.offModels.code), pt = usable(P.offModels.chat);
    var path = code ? (pc || pt) : (pt || pc);
    if (!path) return Promise.resolve(null);
    var sys = sysPrompt(code), free = cfg('offFree', true);
    var keep = Math.max(2, parseInt(cfg('offHist', 16), 10) || 16);
    var maxTok = parseInt(cfg('offMaxTok', free ? 1024 : (code ? 700 : 300)), 10) || 1024;
    var temp = parseFloat(cfg('offTemp', code ? 0.3 : 0.7)); if (isNaN(temp)) temp = 0.7;
    hist.push({ role: 'user', content: text }); hist = hist.slice(-keep);
    return generate(path, [{ role: 'system', content: sys }].concat(hist), maxTok, temp).then(function (a) {
      a = (a || '').trim();
      if (a) { hist.push({ role: 'assistant', content: a }); return '(offline) ' + a; }
      hist.pop(); return null;
    }).catch(function (err) { hist.pop(); return 'Offline model error: ' + err.message; });
  }

  var oi = X.intercept;
  X.intercept = async function (t) {
    var r = await oi(t);
    if (r) return r;
    if (engineReady() && wanted()) return await answer(t);
    return r;
  };
  var ol = X.llm;
  X.llm = function (text, fb) {
    if (engineReady() && wanted()) return answer(text).then(function (a) { return a || fb; });
    return ol ? ol(text, fb) : Promise.resolve(fb);
  };

  // ---- UI: Settings > Models ----
  var CSS =
    '#xModels .mRow{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:10px 0}' +
    '#xModels .mRow span{font-size:13.5px}' +
    '#xModels .mCard{border:1px solid var(--panel-border);border-radius:12px;padding:10px 12px;margin:10px 0;font-size:12px;color:var(--ink-dim);line-height:1.5}' +
    '#xModels .mCard b{color:var(--ink)}' +
    '#xModels .mHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:20px}' +
    '#xModels .mHead h4{margin:0;font-size:12px;letter-spacing:2px;color:var(--accent);text-transform:uppercase}' +
    '#xModels .mHint{font-size:11.5px;color:var(--ink-dim);margin:2px 0 6px}' +
    '#xModels .mAdd{min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--accent-dim);background:transparent;color:var(--accent);font-size:12.5px;font-weight:700}' +
    '#xModels .mAdd[disabled]{opacity:.4}' +
    '#xModels .mItem{display:flex;align-items:center;gap:10px;padding:9px 6px;border:1px solid var(--panel-border);border-radius:12px;margin:6px 0;cursor:pointer}' +
    '#xModels .mItem.on{border-color:var(--accent);background:rgba(76,212,169,.07)}' +
    '#xModels .mDot{width:18px;height:18px;border-radius:50%;border:2px solid var(--accent-dim);flex:none}#xModels .mItem.on .mDot{background:var(--accent);border-color:var(--accent);box-shadow:0 0 8px var(--accent)}' +
    '#xModels .mMain{flex:1;min-width:0}#xModels .mName{font-size:13.5px;color:var(--ink);word-break:break-all;line-height:1.3}' +
    '#xModels .mMeta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px;font-size:11px;color:var(--ink-dim)}' +
    '#xModels .bdg{padding:2px 7px;border-radius:8px;font-size:10px;font-weight:700;letter-spacing:.5px;border:1px solid var(--panel-border)}' +
    '#xModels .bdg.gguf{color:#4cd4a9;border-color:rgba(76,212,169,.5)}#xModels .bdg.onnx{color:#7db4ff;border-color:rgba(125,180,255,.5)}#xModels .bdg.tflite,#xModels .bdg.task,#xModels .bdg.litertlm{color:#ffb86b;border-color:rgba(255,184,107,.5)}' +
    '#xModels .bdg.ok{color:#4cd4a9;border-color:rgba(76,212,169,.5)}#xModels .bdg.stored{color:var(--ink-dim)}' +
    '#xModels .mDel{background:none;border:0;color:var(--ink-dim);font-size:17px;width:34px;height:34px;flex:none}' +
    '#xModels .mUse{min-height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--accent-dim);background:transparent;color:var(--accent);font-size:11px;font-weight:700;flex:none}' +
    '#xModels .mEmpty{padding:10px 4px;font-size:12px;color:var(--ink-dim)}' +
    '#xModels .mBar{height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;margin:8px 0 4px}#xModels .mBar i{display:block;height:100%;width:0;background:var(--accent);transition:width .25s}' +
    '#xModels .mErr{color:#ff7a7a}' +
    '#xModels table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:6px}#xModels td{padding:5px 4px;border-top:1px solid var(--panel-border);vertical-align:top}#xModels td:first-child{white-space:nowrap;color:var(--ink);font-weight:700}' +
    '#xModels details summary{font-size:12px;color:var(--accent);padding:8px 0;list-style:none}' +
    '#xModels,#xModels *{touch-action:manipulation}#xModels{overscroll-behavior:contain}' +
    'body.coreLite *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' +
    'body.coreLite #panel,body.coreLite #imgOverlay,body.coreLite #sndOverlay,body.coreLite #modelOverlay,body.coreLite #vidOverlay,body.coreLite #codeOverlay{background:rgba(3,5,7,.96)!important}' +
    'body.coreLite #chatPanel{background:rgba(3,5,7,.94)!important}';

  function build() {
    var tabs = $('panelTabs'), box = $('panelBox');
    if (!tabs || !box || $('xModels')) return;
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    var tb = doc.createElement('button'); tb.className = 'panelTab'; tb.type = 'button'; tb.dataset.tab = 'models'; tb.textContent = 'Models';
    tb.onclick = function () { window.CORE_OPEN_PANEL_TAB('models'); refresh(); paint(); };
    tabs.appendChild(tb);
    var ct = doc.createElement('div'); ct.className = 'panelTabContent'; ct.dataset.tabContent = 'models'; ct.id = 'xModels';
    box.insertBefore(ct, box.querySelector(':scope > .panelSignature'));
    ct.addEventListener('click', onClick);
    refresh(); paint();
  }

  function paintProgress() {
    var host = $('mProg'); if (!host) { paint(); return; }
    host.innerHTML = progHtml();
  }
  function progHtml() {
    var h = '';
    if (copyState) {
      var pct = copyState.total > 0 ? Math.min(100, Math.round(copyState.done * 100 / copyState.total)) : 0;
      h += '<div class="mCard"><b>Adding ' + esc(copyState.name) + '</b>' + (copyState.n > 1 ? ' (' + copyState.idx + '/' + copyState.n + ')' : '') +
        '<div class="mBar"><i style="width:' + pct + '%"></i></div>' + mbStr(Math.round(copyState.done / 1048576)) + (copyState.total > 0 ? ' of ' + mbStr(Math.round(copyState.total / 1048576)) + ' \u00b7 ' + pct + '%' : '') +
        ' <button class="mAdd" data-act="cancelCopy" style="float:right;min-height:28px">Cancel</button></div>';
    }
    if (copyErr) h += '<div class="mCard mErr">' + esc(copyErr) + '</div>';
    return h;
  }

  function rowHtml(m) {
    var sel = P.offModels[m.cat] === m.path, run = runnable(m), f = m.fmt;
    var status = m.support ? '<span class="bdg stored">support file</span>' : run ? '<span class="bdg ok">ready</span>' : imgOk(m) ? '<span class="bdg stored">stored \u00b7 needs libsd.so image engine</span>' : convertHint(f) ? '<span class="bdg stored">stored \u00b7 convert to GGUF to run</span>' : '<span class="bdg stored">stored \u00b7 needs ' + (FMT[f] || f.toUpperCase()) + ' engine</span>';
    if (run && info.ramMB && m.mb > info.ramMB * 0.7) status += '<span class="bdg stored" style="color:#ffb86b">may be too big for this phone\'s RAM</span>';
    var h = '<div class="mItem' + (sel ? ' on' : '') + '" data-act="' + (m.support || m.cat === 'unsorted' ? 'noop' : 'sel') + '" data-path="' + attr(m.path) + '" data-cat="' + attr(m.cat) + '">' +
      (m.support || m.cat === 'unsorted' ? '' : '<div class="mDot"></div>') +
      '<div class="mMain"><div class="mName">' + esc(m.name) + '</div><div class="mMeta"><span class="bdg ' + f + '">' + esc(FMT[f] || f.toUpperCase()) + '</span><span>' + mbStr(m.mb) + '</span>' + status + '</div></div>';
    if (m.cat === 'unsorted') {
      h += '<button class="mUse" data-act="useAs" data-v="chat" data-path="' + attr(m.path) + '">Chat</button><button class="mUse" data-act="useAs" data-v="code" data-path="' + attr(m.path) + '">Code</button>';
    }
    if (m.app) h += '<button class="mDel" data-act="del" data-path="' + attr(m.path) + '" aria-label="Delete">\u2715</button>';
    return h + '</div>';
  }

  function applyLite() { if (doc.body) doc.body.classList.toggle('coreLite', !!cfg('offLite', true)); }
  if (doc.body) applyLite(); else doc.addEventListener('DOMContentLoaded', applyLite);

  function paint() {
    var ct = $('xModels'); if (!ct) return;
    if (!NAT) { ct.innerHTML = '<div class="mCard">Offline models can only be added inside the CORE Android app.</div>'; return; }
    var keep = ct.parentNode ? ct.parentNode.scrollTop : 0;
    var openD = Array.prototype.map.call(ct.querySelectorAll('details'), function (d) { return d.open; });
    var h = '<div class="xRow"><span>Offline mode</span><input type="checkbox" id="mOn"' + (P.offlineMode ? ' checked' : '') + '></div>' +
      '<div class="xRow"><span>Auto-switch when offline</span><input type="checkbox" id="mAuto"' + (P.offlineAuto !== false ? ' checked' : '') + '></div>' +
      '<div class="xRow"><span>Lite UI (no blur, smoother)</span><input type="checkbox" id="mLite"' + (cfg('offLite', true) ? ' checked' : '') + '></div>';
    h += '<div class="mCard">' + (engines.gguf ? '<b>GGUF engine ready.</b> Chat and Coding models run on this phone.' + (info.ramMB ? ' Phone RAM: <b>' + mbStr(info.ramMB) + '</b>.' : '') : '<b>GGUF engine missing</b> \u2014 add libcore_llm.so to the app (see README). Models can still be stored.') +
      '<br>Free storage: <b>' + mbStr(info.freeMB || 0) + '</b></div>';
    h += '<div class="mCard"><div class="xRow" style="padding:0"><span><b>Unrestricted mode</b></span><input type="checkbox" id="mFree"' + (cfg('offFree', true) ? ' checked' : '') + '></div>' +
      'No app-side limits: neutral system prompt, long answers, bigger memory. Refusals that are built into a model\'s weights stay until you load an uncensored or abliterated GGUF.' +
      '<details><summary>Advanced</summary>' +
      '<div class="mHint">System prompt (empty = default)</div><textarea id="mSys" rows="3" style="width:100%;box-sizing:border-box;background:transparent;color:var(--ink);border:1px solid var(--panel-border);border-radius:10px;padding:8px;font-size:12px">' + esc(cfg('offSys', '')) + '</textarea>' +
      '<div class="mRow"><span>Max answer length</span><input type="number" id="mTok" min="64" max="8192" step="64" value="' + attr(cfg('offMaxTok', cfg('offFree', true) ? 1024 : 300)) + '" style="width:90px"></div>' +
      '<div class="mRow"><span>Creativity (temperature)</span><input type="number" id="mTmp" min="0" max="2" step="0.1" value="' + attr(cfg('offTemp', 0.7)) + '" style="width:90px"></div>' +
      '<div class="mRow"><span>Context size</span><select id="mCtx" style="width:100px">' + [2048, 4096, 8192].map(function (n) { return '<option' + (parseInt(cfg('offCtx', 4096), 10) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
      '<div class="mRow"><span>Messages remembered</span><input type="number" id="mHist" min="2" max="64" value="' + attr(cfg('offHist', 16)) + '" style="width:90px"></div>' +
      '</details></div>';
    (function () {
      var il = models.filter(function (m) { return m.cat === 'image' && !m.support; });
      var sel = P.offImgModel && byPath(P.offImgModel) ? P.offImgModel : (il[0] ? il[0].path : '');
      var can = il.length && info.imageEngine;
      h += '<div class="mCard"><b>Create image</b><div class="mHint">' + (info.imageEngine ? 'Image engine ready.' : 'Image engine not installed (build libsd.so with tools/build-sd.yml).') + (il.length ? '' : ' Add a model under Text to image (SDXS-512 is the lightest).') + '</div>' +
        '<select id="iModel" style="width:100%">' + il.map(function (m) { return '<option value="' + attr(m.path) + '"' + (m.path === sel ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select>' +
        '<textarea id="iPrompt" rows="2" placeholder="Describe the image" style="width:100%;box-sizing:border-box;background:transparent;color:var(--ink);border:1px solid var(--panel-border);border-radius:10px;padding:8px;font-size:13px;margin-top:6px">' + esc(cfg('offImgPrompt', '')) + '</textarea>' +
        '<textarea id="iNeg" rows="1" placeholder="Negative prompt (optional)" style="width:100%;box-sizing:border-box;background:transparent;color:var(--ink);border:1px solid var(--panel-border);border-radius:10px;padding:8px;font-size:12px;margin-top:6px">' + esc(cfg('offImgNeg', '')) + '</textarea>' +
        '<div class="mRow"><span>Size</span><select id="iSize" style="width:100px">' + [256, 384, 512, 768].map(function (n) { return '<option' + (parseInt(cfg('offImgSize', 512), 10) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
        '<div class="mRow"><span>Steps</span><input type="number" id="iSteps" min="1" max="60" value="' + attr(cfg('offImgSteps', 4)) + '" style="width:90px"></div>' +
        '<div class="mRow"><span>Guidance (cfg)</span><input type="number" id="iCfg" min="0" max="20" step="0.5" value="' + attr(cfg('offImgCfg', 1)) + '" style="width:90px"></div>' +
        '<div class="mHint">SDXS / Turbo / LCM models: 1\u20134 steps, cfg 1. Normal Stable Diffusion: 20 steps, cfg 7.</div>' +
        '<button class="panelActionBtn" id="iGo" type="button"' + ((can && !imgState.busy) ? '' : ' disabled') + '>' + (imgState.busy ? 'Generating\u2026' : 'Generate') + '</button>' +
        (imgState.busy ? ' <button class="panelActionBtn" id="iStop" type="button">Stop</button><div class="mHint" id="iProg">' + esc(imgState.prog) + '</div>' : '') +
        (imgState.err ? '<div class="mHint" style="color:#ff8a8a">' + esc(imgState.err) + '</div>' : '') +
        (imgState.src ? '<img src="' + imgState.src + '" style="width:100%;border-radius:12px;margin-top:8px">' : '') + '</div>';
    })();
    h += '<div id="mProg">' + progHtml() + '</div>';
    CATS.forEach(function (c) {
      var list = models.filter(function (m) { return m.cat === c.id; });
      var n = list.filter(function (m) { return !m.support; }).length;
      h += '<div class="mHead"><h4>' + c.name + (n ? ' \u00b7 ' + n : '') + '</h4><button class="mAdd" data-act="add" data-cat="' + c.id + '"' + (copyState ? ' disabled' : '') + '>+ Add</button></div><div class="mHint">' + c.hint + ' \u00b7 ' + c.fmt + '</div>';
      if (!list.length) h += '<div class="mEmpty">No models yet.</div>';
      list.forEach(function (m) { h += rowHtml(m); });
    });
    var un = models.filter(function (m) { return m.cat === 'unsorted'; });
    if (un.length) {
      h += '<div class="mHead"><h4>Unsorted \u00b7 ' + un.length + '</h4></div><div class="mHint">Found in ' + esc(info.sharedDir || '/sdcard/CORE/models') + '. Pick what each one is for.</div>';
      un.forEach(function (m) { h += rowHtml(m); });
    }
    h += '<button class="panelActionBtn" data-act="scan" type="button" style="margin-top:16px">Rescan folders</button>';
    h += '<div class="mHint" style="margin-top:8px">Or copy files over USB into <b>' + esc(info.sharedDir || '/sdcard/CORE/models') + '/&lt;category&gt;/</b> (for example <b>chat</b>, <b>code</b>, <b>stt</b>), then tap Rescan.</div>';
    h += '<details><summary>Supported formats</summary><table>' +
      '<tr><td>GGUF</td><td>Chat, Coding \u2014 <span style="color:#4cd4a9">runs now</span> (llama.cpp). A GGUF renamed to .bin is detected too.</td></tr>' +
      '<tr><td>SAFETENSORS / PT / PTH / GPTQ / AWQ</td><td>Convert to GGUF with tools/convert-model.yml, then add the GGUF.</td></tr>' +
      '<tr><td>Text to image (.safetensors / .ckpt / .gguf)</td><td>Runs with the libsd.so image engine (stable-diffusion.cpp). Lightest: SDXS-512.</td></tr>' +
      '<tr><td>GGML (old .bin)</td><td>Legacy. Get or convert to GGUF.</td></tr>' +
      '<tr><td>SAVEDMODEL / KERAS / H5</td><td>Convert to TFLite or ONNX with the same workflow.</td></tr>' +
      '<tr><td>PICKLE (.pkl)</td><td>Never loaded on the phone (pickle can run code). Converted to ONNX in the cloud.</td></tr>' +
      '<tr><td>ONNX / ORT / TFLITE / TASK / LITERT</td><td>Stored. Their runtimes are not bundled yet.</td></tr>' +
      '<tr><td>COREML / TENSORRT / OPENVINO</td><td>Cannot run on Android (Apple / NVIDIA / Intel only). Convert the original model.</td></tr>' +
      '<tr><td>JSON / TXT</td><td>Tokenizers, configs and voice files that travel with a model</td></tr></table></details>';
    ct.innerHTML = h;
    var on = $('mOn'), au = $('mAuto');
    on.onchange = function () { P.offlineMode = this.checked; save(); say(P.offlineMode ? 'Offline mode on.' : 'Offline mode off.'); };
    au.onchange = function () { P.offlineAuto = this.checked; save(); };
    $('mLite').onchange = function () { P.offLite = this.checked; save(); applyLite(); };
    if ($('iGo')) {
      $('iModel') && ($('iModel').onchange = function () { P.offImgModel = this.value; save(); });
      $('iPrompt').onchange = function () { P.offImgPrompt = this.value; save(); };
      $('iNeg').onchange = function () { P.offImgNeg = this.value; save(); };
      $('iSize').onchange = function () { P.offImgSize = parseInt(this.value, 10) || 512; save(); };
      $('iSteps').onchange = function () { P.offImgSteps = Math.max(1, Math.min(60, parseInt(this.value, 10) || 4)); save(); };
      $('iCfg').onchange = function () { var v = parseFloat(this.value); P.offImgCfg = isNaN(v) ? 1 : Math.max(0, Math.min(20, v)); save(); };
      $('iGo').onclick = function () {
        var model = $('iModel') ? $('iModel').value : '', prompt = $('iPrompt').value.trim();
        if (!model) { say('Add an image model first.'); return; }
        if (!prompt) { say('Type a prompt first.'); return; }
        P.offImgPrompt = prompt; P.offImgNeg = $('iNeg').value; P.offImgModel = model; save();
        var sz = parseInt(cfg('offImgSize', 512), 10) || 512;
        imgState = { busy: true, prog: 'Starting\u2026', src: '', err: '' };
        paint();
        NAT.generateImage('img' + (++seq), model, prompt, $('iNeg') ? $('iNeg').value : '', sz, sz,
          parseInt(cfg('offImgSteps', 4), 10) || 4, parseFloat(cfg('offImgCfg', 1)) || 1, -1);
      };
      if ($('iStop')) $('iStop').onclick = function () { NAT.cancelImage(); };
    }
    $('mFree').onchange = function () { P.offFree = this.checked; save(); paint(); say(P.offFree ? 'Unrestricted mode on.' : 'Unrestricted mode off.'); };
    $('mSys').onchange = function () { P.offSys = this.value; save(); };
    $('mTok').onchange = function () { P.offMaxTok = Math.max(64, Math.min(8192, parseInt(this.value, 10) || 1024)); save(); };
    $('mTmp').onchange = function () { var v = parseFloat(this.value); P.offTemp = isNaN(v) ? 0.7 : Math.max(0, Math.min(2, v)); save(); };
    $('mCtx').onchange = function () { P.offCtx = parseInt(this.value, 10) || 4096; save(); };
    $('mHist').onchange = function () { P.offHist = Math.max(2, Math.min(64, parseInt(this.value, 10) || 16)); save(); };
    Array.prototype.forEach.call(ct.querySelectorAll('details'), function (d, i) { if (openD[i]) d.open = true; });
    if (ct.parentNode) ct.parentNode.scrollTop = keep;
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null; if (!el || !NAT) return;
    var a = el.getAttribute('data-act'), path = el.getAttribute('data-path'), cat = el.getAttribute('data-cat');
    if (a === 'add') { copyErr = ''; NAT.ensureStoragePermission(); NAT.pickModel(cat); return; }
    if (a === 'cancelCopy') { NAT.cancelCopy(); return; }
    if (a === 'scan') { NAT.ensureStoragePermission(); refresh(); paint(); return; }
    if (a === 'sel') { P.offModels[cat] = P.offModels[cat] === path ? '' : path; if (!P.offModels[cat]) delete P.offModels[cat]; save(); paint(); return; }
    if (a === 'useAs') { e.stopPropagation(); P.offModels[el.getAttribute('data-v')] = path; save(); paint(); return; }
    if (a === 'del') {
      e.stopPropagation();
      var m = byPath(path); if (!m || !window.confirm('Delete ' + m.name + ' from this phone?')) return;
      var r = NAT.deleteModel(path);
      if (r !== 'ok') copyErr = r; else Object.keys(P.offModels).forEach(function (k) { if (P.offModels[k] === path) delete P.offModels[k]; });
      save(); refresh(); paint();
    }
  }

  window.CORE_MODELS = { refresh: function () { refresh(); paint(); } };
  build();
  var tries = 0, iv = setInterval(function () { build(); if ($('xModels') || ++tries > 40) clearInterval(iv); }, 250);
})();
