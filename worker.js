// CORE Cloud - Cloudflare Worker (free tier is enough).
//   POST /v1/chat   streams a chat reply from an OpenAI-compatible upstream   (Bearer DEVICE_TOKEN)
//   GET  /ws/device the phone connects here to receive remote commands        (?t=DEVICE_TOKEN)
//   POST /v1/cmd    you send {"actions":[...]} to the phone and get the result (Bearer CONTROL_TOKEN)
//   GET  /health
// Secrets: DEVICE_TOKEN, CONTROL_TOKEN, UPSTREAM_KEY.  Vars: UPSTREAM_URL, MODEL (see wrangler.toml).

const ALLOW_ORIGIN = 'https://appassets.androidplatform.net';
const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
const enc = new TextEncoder();

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}
function safeEq(a, b) {
  a = enc.encode(String(a || '')); b = enc.encode(String(b || ''));
  var d = a.length ^ b.length, n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) d |= (a[i] || 0) ^ (b[i] || 0);
  return d === 0;
}
function bearer(req) {
  var h = req.headers.get('Authorization') || '';
  return h.indexOf('Bearer ') === 0 ? h.slice(7) : '';
}
function hub(env) { return env.HUB.get(env.HUB.idFromName('phone')); }

async function chat(req, env) {
  if (!env.DEVICE_TOKEN || !safeEq(bearer(req), env.DEVICE_TOKEN)) return json({ error: 'unauthorized' }, 401);
  if (!env.UPSTREAM_KEY) return json({ error: 'UPSTREAM_KEY is not set' }, 500);
  var body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  var msgs = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  if (!msgs.length) return json({ error: 'no messages' }, 400);
  msgs = msgs.map(function (m) {
    return { role: (m.role === 'assistant' || m.role === 'system') ? m.role : 'user', content: String(m.content == null ? '' : m.content).slice(0, 20000) };
  });
  var up = await fetch(env.UPSTREAM_URL || 'https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.UPSTREAM_KEY },
    body: JSON.stringify({
      model: env.MODEL || 'llama-3.3-70b-versatile',
      messages: msgs,
      max_tokens: Math.min(parseInt(body.max_tokens, 10) || 1024, 2048),
      stream: true
    })
  });
  if (!up.ok) return json({ error: 'upstream ' + up.status }, 502);
  // pass the stream straight through: first token reaches the phone as soon as the model emits it
  return new Response(up.body, { headers: Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }, CORS) });
}

export default {
  async fetch(req, env) {
    var url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/v1/chat' && req.method === 'POST') return chat(req, env);
    if (url.pathname === '/ws/device') {
      if (!env.DEVICE_TOKEN || !safeEq(url.searchParams.get('t'), env.DEVICE_TOKEN)) return json({ error: 'unauthorized' }, 401);
      return hub(env).fetch(req);
    }
    if (url.pathname === '/v1/cmd' && req.method === 'POST') {
      if (!env.CONTROL_TOKEN || !safeEq(bearer(req), env.CONTROL_TOKEN)) return json({ error: 'unauthorized' }, 401);
      return hub(env).fetch(req);
    }
    return json({ error: 'not found' }, 404);
  }
};

// One Durable Object holds the phone's WebSocket and relays commands to it.
export class Hub {
  constructor(state) {
    this.state = state;
    this.waiting = new Map();
    // the phone sends "ping" every 25 s; answered without waking the object
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(req) {
    var url = new URL(req.url);
    if (url.pathname === '/ws/device') {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket required' }, 426);
      this.state.getWebSockets().forEach(function (old) { try { old.close(1000, 'replaced'); } catch (e) {} });
      var pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/v1/cmd') {
      var body;
      try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      var actions = Array.isArray(body.actions) ? body.actions.slice(0, 12) : [];
      if (!actions.length) return json({ error: 'no actions' }, 400);
      var socks = this.state.getWebSockets();
      if (!socks.length) return json({ error: 'phone offline - open CORE and send /link on' }, 503);
      var id = crypto.randomUUID(), self = this;
      var result = new Promise(function (resolve) {
        var t = setTimeout(function () { self.waiting.delete(id); resolve({ ok: false, error: 'timeout' }); }, 60000);
        self.waiting.set(id, function (v) { clearTimeout(t); resolve(v); });
      });
      socks[0].send(JSON.stringify({ id: id, actions: actions }));
      return json(await result);
    }
    return json({ error: 'not found' }, 404);
  }
  webSocketMessage(ws, msg) {
    try {
      var j = JSON.parse(msg), f = this.waiting.get(j.id);
      if (f) { this.waiting.delete(j.id); f(j.result); }
    } catch (e) {}
  }
  webSocketClose(ws, code) { try { ws.close(code); } catch (e) {} }
}
