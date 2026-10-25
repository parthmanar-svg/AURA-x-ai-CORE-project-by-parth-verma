/* CORE phone control + CORE Cloud client (first-party; talks to PhoneBridge and your cloud worker).
   Chat commands:  /cloud <https-url> <token>   /phone   /phone off   /link on|off
   Instant commands (no model, no network):  home, back, open youtube, scroll down, volume up, call 555..., search ... */
(function () {
  'use strict';
  var W = window, NAT = W.CORE_PHONE_NATIVE, waits = {}, seq = 0;

  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function status() { try { return JSON.parse(NAT.status()); } catch (e) { return { service: false, enabled: false }; } }
  function cloudReady() { return !!(ls('core_cloud_url') && ls('core_cloud_token')); }

  // ---------------------------------------------------------------- run a plan on the phone
  W.CORE_PHONE_RESULT = function (id, json) {
    var f = waits[id]; if (!f) return; delete waits[id];
    var v; try { v = JSON.parse(json); } catch (e) { v = { ok: false, error: 'bad result' }; }
    f(v);
  };
  function run(actions) {
    return new Promise(function (res) {
      if (!NAT) { res({ ok: false, error: 'Phone control needs the Android app.' }); return; }
      var id = 'p' + (++seq) + '_' + Date.now();
      waits[id] = res;
      setTimeout(function () { if (waits[id]) { delete waits[id]; res({ ok: false, error: 'timed out waiting for approval' }); } }, 90000);
      try { NAT.run(id, JSON.stringify(actions)); } catch (e) { delete waits[id]; res({ ok: false, error: String((e && e.message) || e) }); }
    });
  }
  function summarize(r) {
    if (!r) return 'No result.';
    var steps = r.steps || [], out = [];
    steps.forEach(function (s) { if (s.ok && s.text) out.push('On screen:\n' + s.text); });
    if (r.ok) return out.length ? out.join('\n') : 'Done.';
    var bad = steps.filter(function (s) { return !s.ok; })[0];
    return 'Couldn\u2019t finish: ' + (r.error || (bad && (bad.error || (bad.do + ' failed'))) || 'unknown error');
  }

  // ---------------------------------------------------------------- instant local commands
  var RESERVED = /^(timer|tasks?|notes?|stopwatch|briefing|settings|full mode)\b/;
  function fast(t) {
    var s = t.toLowerCase().replace(/[.!?]+$/, '').replace(/^(please |hey core,? |core,? )/, '').trim(), m;
    if (/^(go )?home$/.test(s)) return [{ do: 'home' }];
    if (/^(go )?back$/.test(s)) return [{ do: 'back' }];
    if (/^(recent apps|recents|app switcher)$/.test(s)) return [{ do: 'recents' }];
    if (/^(show |open )?notifications$/.test(s)) return [{ do: 'notifications' }];
    if (/^quick settings$/.test(s)) return [{ do: 'quick' }];
    if ((m = s.match(/^scroll (up|down)$/))) return [{ do: 'scroll', dir: m[1] }];
    if ((m = s.match(/^volume (up|down)$/))) return [{ do: 'volume', dir: m[1] }];
    if ((m = s.match(/^(?:open|launch|start) (.{1,40})$/)) && !RESERVED.test(m[1])) return [{ do: 'open', app: m[1] }];
    if ((m = s.match(/^call ([+\d][\d\s()-]{2,20})$/))) return [{ do: 'dial', number: m[1] }];
    if ((m = s.match(/^(?:google|search for|search) (.{1,120})$/))) return [{ do: 'url', url: 'https://www.google.com/search?q=' + encodeURIComponent(m[1]) }];
    return null;
  }

  // ---------------------------------------------------------------- CORE Cloud chat (streaming)
  var PHONE_SYS = '\n\nYou can control the user\u2019s Android phone. When (and only when) the user asks you to do something on the phone, end your reply with one fenced block labelled phone containing a JSON array of actions, for example:\n```phone\n[{"do":"open","app":"YouTube"}]\n```\nActions: home, back, recents, notifications, quick, scroll{dir:up|down}, volume{dir:up|down}, open{app}, tap{x,y}, swipe{x1,y1,x2,y2}, click{text}, type{text}, read, dial{number}, sms{number,text}, url{url}, alarm{hour,min,label}, wait{ms}, media{key:play|pause|next|prev}, torch{on:true|false}, screenshot, lock, power, settings{page:wifi|bluetooth|airplane|display|sound|battery|location|apps}, longpress{x,y}, intent{action,data,package,type,extras}. Keep plans short. The user approves sensitive steps on their screen. You only send the plan, so never claim it already happened.';
  async function streamChat(token, msgs, push, maxTok) {
    var ctl = new AbortController(); token.abort = function () { ctl.abort(); };
    var m = msgs.slice();
    if (status().enabled && m[0] && m[0].role === 'system') m[0] = { role: 'system', content: m[0].content + PHONE_SYS };
    var res = await fetch(ls('core_cloud_url') + '/v1/chat', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ls('core_cloud_token') },
      body: JSON.stringify({ messages: m, max_tokens: maxTok })
    });
    if (!res.ok) throw new Error('CORE Cloud error ' + res.status);
    var rd = res.body.getReader(), dec = new TextDecoder(), buf = '';
    for (;;) {
      var r = await rd.read(); if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      var lines = buf.split('\n'); buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].trim(); if (ln.indexOf('data:') !== 0) continue;
        var d = ln.slice(5).trim(); if (d === '[DONE]') return;
        var j; try { j = JSON.parse(d); } catch (e) { continue; }
        var t = j && j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (t) push(token, t);
      }
    }
  }
  // strip the ```phone block from a finished reply and run it
  function afterReply(text, ui) {
    var m = /```phone\s*([\s\S]*?)```/.exec(text || '');
    if (!m) return text;
    var clean = text.replace(m[0], '').trim(), acts;
    try { acts = JSON.parse(m[1]); } catch (e) { return clean + '\n\n(The phone plan was malformed, so nothing was done.)'; }
    if (!Array.isArray(acts) || !acts.length) return clean;
    if (!status().enabled) return clean + '\n\n(Phone control is off. Send /phone to turn it on.)';
    run(acts).then(function (r) { ui.say(summarize(r)); });
    return clean || 'On it.';
  }

  // ---------------------------------------------------------------- remote link (cloud -> phone)
  var ws = null, want = ls('core_link') === '1', backoff = 2000, pingT = 0;
  function linkUrl() {
    var u = ls('core_cloud_url'), t = ls('core_cloud_token');
    return (u && t) ? u.replace(/^http/, 'ws') + '/ws/device?t=' + encodeURIComponent(t) : '';
  }
  function linkOpen() {
    if (!want || ws) return;
    var u = linkUrl(); if (!u) return;
    var sock;
    try { sock = ws = new WebSocket(u); } catch (e) { ws = null; return; }
    function dead() {
      if (ws !== sock) return;
      ws = null; clearInterval(pingT);
      if (want) { backoff = Math.min(backoff * 2, 30000); setTimeout(linkOpen, backoff); }
    }
    sock.onopen = function () { backoff = 2000; clearInterval(pingT); pingT = setInterval(function () { try { sock.send('ping'); } catch (e) {} }, 25000); };
    sock.onmessage = function (ev) {
      if (ev.data === 'pong') return;
      var j; try { j = JSON.parse(ev.data); } catch (e) { return; }
      if (!j || !j.id || !Array.isArray(j.actions)) return;
      run(j.actions).then(function (r) { try { sock.send(JSON.stringify({ id: j.id, result: r })); } catch (e) {} });
    };
    sock.onclose = dead; sock.onerror = dead;
  }
  function linkSet(on) {
    want = !!on; lsSet('core_link', on ? '1' : '');
    if (!on && ws) { var w = ws; ws = null; clearInterval(pingT); try { w.close(); } catch (e) {} }
    if (on) linkOpen();
  }
  if (want) setTimeout(function () { if (status().enabled) linkOpen(); }, 1500);

  try { if (NAT && NAT.saveCloud && cloudReady()) NAT.saveCloud(ls('core_cloud_url'), ls('core_cloud_token')); } catch (e) {}

  // ---------------------------------------------------------------- chat hook
  function handle(text, ui) {
    var m;
    if ((m = text.match(/^\/cloud(?:\s+(\S+)\s+(\S+))?\s*$/i))) {
      if (!m[1]) { ui.say(cloudReady() ? 'Cloud is set up: ' + ls('core_cloud_url') + '. Pick \u201cCORE Cloud\u201d in the model menu.' : 'Usage: /cloud https://your-worker.workers.dev YOUR_DEVICE_TOKEN'); return true; }
      if (!/^https:\/\/[^\s/]+$/i.test(m[1].replace(/\/+$/, ''))) { ui.say('The cloud address must start with https:// (no path).'); return true; }
      lsSet('core_cloud_url', m[1].replace(/\/+$/, '')); lsSet('core_cloud_token', m[2]);
      try { if (NAT && NAT.saveCloud) NAT.saveCloud(ls('core_cloud_url'), ls('core_cloud_token')); } catch (e) {}
      var msg = ui.say('Saved. Checking the server\u2026');
      fetch(ls('core_cloud_url') + '/health').then(function (r) { return r.json(); }).then(function (j) {
        msg.content = j && j.ok ? 'Cloud saved and reachable. Choose \u201cCORE Cloud\u201d in the model menu.' : 'Saved, but the server answered oddly.';
        ui.refresh();
      }).catch(function () { msg.content = 'Saved, but I couldn\u2019t reach that address.'; ui.refresh(); });
      return true;
    }
    if ((m = text.match(/^\/phone\s+auto\s+(on|off)\s*$/i))) {
      if (!NAT) { ui.say('Phone control needs the Android app.'); return true; }
      if (m[1].toLowerCase() === 'on') { NAT.requestAuto(); ui.say('Approve the prompt on screen once. After that, plans run without asking.'); }
      else { NAT.autoOff(); ui.say('Auto mode off. Taps, typing and reading will ask first again.'); }
      return true;
    }
    if ((m = text.match(/^\/wake(?:\s+(on|off|word\s+.+))?\s*$/i))) {
      if (!NAT || !NAT.wakeStart) { ui.say('Wake word needs the Android app.'); return true; }
      var sub = (m[1] || '').trim(), w = {};
      try { w = JSON.parse(NAT.wakeStatus()); } catch (e) {}
      if (/^on$/i.test(sub)) {
        NAT.wakeStart();
        ui.say('Starting the wake-word listener. If it asks for microphone or notification access, allow it and send /wake on again.' + (w.assistant ? '' : ' Set CORE as your assistant first (/assistant), or it can\u2019t open over other apps.'));
      } else if (/^off$/i.test(sub)) { NAT.wakeStop(); ui.say('Wake word is off.'); }
      else if (/^word\s+/i.test(sub)) { NAT.setWakePhrases(sub.replace(/^word\s+/i, '')); ui.say('Saved. Send /wake off then /wake on to use the new phrases.'); }
      else ui.say('Wake word is ' + (w.running ? 'listening' : 'off') + '. Phrases: ' + (w.phrases || 'hey core') + '. /wake on, /wake off, /wake word <phrase, phrase>.');
      return true;
    }
    if (/^\/assistant\s*$/i.test(text)) {
      if (!NAT || !NAT.openAssistantSettings) { ui.say('The assistant needs the Android app.'); return true; }
      NAT.openAssistantSettings();
      ui.say('Pick CORE as the Digital assistant app, then hold Home (or the power button, depending on your phone) and speak.');
      return true;
    }
    if (/^\/phone(\s+off)?\s*$/i.test(text)) {
      if (!NAT) { ui.say('Phone control needs the Android app.'); return true; }
      if (/off/i.test(text)) { NAT.disable(); linkSet(false); ui.say('Phone control is off.'); return true; }
      var st = status();
      if (!st.service) { NAT.openAccessibilitySettings(); ui.say('Switch on \u201cCORE phone control\u201d in Accessibility settings, come back, and send /phone again.'); }
      else if (!st.enabled) { NAT.requestEnable(); ui.say('Approve the prompt on screen to turn phone control on.'); }
      else ui.say('Phone control is on. Try: home, open YouTube, scroll down, volume up. With CORE Cloud selected you can also just ask in plain words. /phone off to disable.');
      return true;
    }
    if ((m = text.match(/^\/link\s+(on|off)\s*$/i))) {
      if (m[1].toLowerCase() === 'on') {
        if (!cloudReady()) { ui.say('Set up the cloud first with /cloud.'); return true; }
        if (!status().enabled) { ui.say('Turn phone control on first with /phone.'); return true; }
        linkSet(true); ui.say('Remote link on. Commands sent to your cloud /v1/cmd now reach this phone while CORE is open.');
      } else { linkSet(false); ui.say('Remote link off.'); }
      return true;
    }
    var acts = (NAT && status().enabled) ? fast(text) : null;
    if (!acts) return false;
    var pending = ui.say('Working on it\u2026', text);
    run(acts).then(function (r) { pending.content = summarize(r); ui.refresh(); });
    return true;
  }

  W.CORE_PHONE = { handle: handle, afterReply: afterReply, streamChat: streamChat, cloudReady: cloudReady, run: run, status: status };
})();
