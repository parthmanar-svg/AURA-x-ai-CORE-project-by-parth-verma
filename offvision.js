/* CORE offline vision v1
   On-device faces + objects with TFLite (WASM). No network once the pack is downloaded.
   Models (in /models): BlazeFace short-range (detect), FaceMesh (468 landmarks, used for alignment),
   FaceNet-512 (identity embedding), EfficientDet-Lite0 (objects).
   Exposes window.CORE_OFFVIS. Pure math lives in CORE_OFFVIS._pure so it can be unit-tested in Node. */
(function (root) {
  'use strict';

  var SCRIPT = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || (root.location && root.location.href) || 'http://localhost/';
  var BASE = new URL('./', SCRIPT).href;
  var CACHE = 'core-offvis-v1'; // kept across service-worker updates (see sw.js)

  var FILES = {
    det: 'models/face_detection_short_range.tflite',
    lm: 'models/face_landmark.tflite',
    emb: 'models/facenet_512_int_quantized.tflite',
    obj: 'models/efficientdet_lite0.tflite'
  };
  // [path, approx bytes] — bytes only drive the progress bar
  var PACK = [
    ['vendor/tf.min.js', 1469678],
    ['vendor/tflite/tf-tflite.min.js', 1219490],
    ['vendor/tflite/tflite_web_api_client.js', 1208927],
    ['vendor/tflite/tflite_web_api_cc.js', 78792],
    ['vendor/tflite/tflite_web_api_cc.wasm', 3592067],
    ['vendor/tflite/tflite_web_api_cc_simd.js', 78797],
    ['vendor/tflite/tflite_web_api_cc_simd.wasm', 3689633],
    ['vendor/tflite/tflite_web_api_cc_threaded.js', 96151],
    ['vendor/tflite/tflite_web_api_cc_threaded.wasm', 3626387],
    ['vendor/tflite/tflite_web_api_cc_threaded.worker.js', 2302],
    ['vendor/tflite/tflite_web_api_cc_simd_threaded.js', 96161],
    ['vendor/tflite/tflite_web_api_cc_simd_threaded.wasm', 3723481],
    ['vendor/tflite/tflite_web_api_cc_simd_threaded.worker.js', 2302],
    [FILES.det, 229032],
    [FILES.lm, 1242398],
    [FILES.obj, 4563519],
    [FILES.emb, 24538272]
  ];

  /* ------------------------------------------------------------------ pure math (no DOM, no tf) */
  var P = {};

  var _anch = null;
  // SSD anchors for BlazeFace short-range (128x128 input): 896 anchors, fixed 1x1 size
  P.anchors = function () {
    if (_anch) return _anch;
    var a = [], strides = [8, 16, 16, 16], n = strides.length, l = 0;
    while (l < n) {
      var last = l, rep = 0;
      while (last < n && strides[last] === strides[l]) { rep += 2; last++; }
      var fm = Math.ceil(128 / strides[l]);
      for (var y = 0; y < fm; y++) for (var x = 0; x < fm; x++) for (var r = 0; r < rep; r++) a.push([(x + 0.5) / fm, (y + 0.5) / fm]);
      l = last;
    }
    return (_anch = a);
  };

  function iou(a, b) {
    var ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2, ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2;
    var bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2, bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2;
    var iw = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1)), ih = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    var i = iw * ih;
    return i / (a.w * a.h + b.w * b.h - i + 1e-9);
  }

  // reg: Float32Array(896*16), cls: Float32Array(896). Returns detections in normalized 128-space.
  P.decodeFaces = function (reg, cls, thr, nmsThr) {
    var A = P.anchors(), dets = [];
    for (var i = 0; i < 896; i++) {
      var z = cls[i]; z = z > 80 ? 80 : z < -80 ? -80 : z;
      var s = 1 / (1 + Math.exp(-z));
      if (s < thr) continue;
      var o = i * 16, ax = A[i][0], ay = A[i][1], kp = [];
      for (var k = 0; k < 6; k++) kp.push([reg[o + 4 + 2 * k] / 128 + ax, reg[o + 5 + 2 * k] / 128 + ay]);
      dets.push({ score: s, cx: reg[o] / 128 + ax, cy: reg[o + 1] / 128 + ay, w: reg[o + 2] / 128, h: reg[o + 3] / 128, kp: kp });
    }
    dets.sort(function (a, b) { return b.score - a.score; });
    var keep = [];
    dets.forEach(function (d) {
      for (var j = 0; j < keep.length; j++) if (iou(d, keep[j]) >= nmsThr) return;
      keep.push(d);
    });
    return keep;
  };

  // square letterbox of a (sw x sh) source into n x n
  P.letterbox = function (sw, sh, n) {
    var side = Math.max(sw, sh), sc = n / side, dw = sw * sc, dh = sh * sc;
    return { sc: sc, ox: (n - dw) / 2, oy: (n - dh) / 2, dw: dw, dh: dh };
  };

  P.toSource = function (d, lb) {
    function f(nx, ny) { return { x: (nx * 128 - lb.ox) / lb.sc, y: (ny * 128 - lb.oy) / lb.sc }; }
    var c = f(d.cx, d.cy);
    return { score: d.score, cx: c.x, cy: c.y, w: d.w * 128 / lb.sc, h: d.h * 128 / lb.sc, kp: d.kp.map(function (k) { return f(k[0], k[1]); }) };
  };

  // eye line angle from BlazeFace keypoints 0 (image-left eye) and 1 (image-right eye)
  P.kpRoll = function (kp) { return Math.atan2(kp[1].y - kp[0].y, kp[1].x - kp[0].x); };

  // 192x192 crop coords (flat [x,y,z,...] x468) -> source pixel coords (flat [x,y,...] x468)
  P.meshToSource = function (m, cx, cy, size, roll) {
    var n = 192, k = size / n, c = Math.cos(roll), s = Math.sin(roll), out = new Float32Array(468 * 2);
    for (var i = 0; i < 468; i++) {
      var qx = (m[i * 3] - n / 2) * k, qy = (m[i * 3 + 1] - n / 2) * k;
      out[i * 2] = c * qx - s * qy + cx;
      out[i * 2 + 1] = s * qx + c * qy + cy;
    }
    return out;
  };

  P.meshGeom = function (pts) { // eye-line roll + bbox center/size from mesh (source coords)
    function mid(a, b) { return [(pts[a * 2] + pts[b * 2]) / 2, (pts[a * 2 + 1] + pts[b * 2 + 1]) / 2]; }
    var L = mid(33, 133), R = mid(362, 263);
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < 468; i++) {
      var x = pts[i * 2], y = pts[i * 2 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { roll: Math.atan2(R[1] - L[1], R[0] - L[0]), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0) };
  };

  P.prewhiten = function (f32) { // FaceNet standardization over the whole crop (in place)
    var n = f32.length, m = 0, i;
    for (i = 0; i < n; i++) m += f32[i];
    m /= n;
    var v = 0;
    for (i = 0; i < n; i++) { var d = f32[i] - m; v += d * d; }
    var sd = Math.max(Math.sqrt(v / n), 1 / Math.sqrt(n));
    for (i = 0; i < n; i++) f32[i] = (f32[i] - m) / sd;
    return f32;
  };

  P.l2 = function (v) {
    var s = 0, i; for (i = 0; i < v.length; i++) s += v[i] * v[i];
    s = Math.sqrt(s) || 1;
    var o = new Array(v.length); for (i = 0; i < v.length; i++) o[i] = v[i] / s;
    return o;
  };
  P.cosine = function (a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }; // inputs are L2-normalized

  P.describeObjects = function (list, minScore) {
    var c = {}, order = [];
    list.forEach(function (o) { if (o.score >= (minScore || 0.4)) { if (!c[o.class]) { c[o.class] = 0; order.push(o.class); } c[o.class]++; } });
    if (!order.length) return "I couldn't make out any objects clearly.";
    var parts = order.map(function (k) {
      if (c[k] > 1) return c[k] + ' ' + (k === 'person' ? 'people' : /(s|x|ch|sh)$/.test(k) ? k + 'es' : k + 's');
      return (/^[aeiou]/i.test(k) ? 'an ' : 'a ') + k;
    });
    var s = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
    return 'I can see ' + s + '.';
  };

  /* ------------------------------------------------------------------ browser side */
  var cvs = {};
  function cv(n) { if (!cvs[n]) { var c = document.createElement('canvas'); c.width = c.height = n; cvs[n] = c; } return cvs[n]; }
  function srcW(s) { return s.videoWidth || s.naturalWidth || s.width; }
  function srcH(s) { return s.videoHeight || s.naturalHeight || s.height; }

  // draw a rotated, scaled square crop of src centered on (cx,cy) into an n x n canvas
  function cropRot(src, cx, cy, size, roll, n) {
    var c = cv(n), g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
    g.translate(n / 2, n / 2); g.rotate(-roll); g.scale(n / size, n / size); g.translate(-cx, -cy);
    g.drawImage(src, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  var RT = null;
  function runtime() {
    if (RT) return RT;
    RT = (async function () {
      if (!root.tf) await loadScript(BASE + 'vendor/tf.min.js');
      await root.tf.ready();
      if (!root.tflite) await loadScript(BASE + 'vendor/tflite/tf-tflite.min.js');
      root.tflite.setWasmPath(BASE + 'vendor/tflite/');
    })().catch(function (e) { RT = null; throw e; });
    return RT;
  }

  async function bytes(path) {
    var url = BASE + path;
    try {
      if (root.caches) {
        var c = await caches.open(CACHE), m = await c.match(url);
        if (!m) m = await caches.match(url);
        if (m) return await m.arrayBuffer();
      }
    } catch (e) { /* fall through to network */ }
    var r = await fetch(url);
    if (!r.ok) throw new Error('Missing ' + path + ' — download the offline vision pack first');
    return await r.arrayBuffer();
  }

  var M = {}, L = {};
  function model(name) {
    if (M[name]) return Promise.resolve(M[name]);
    if (!L[name]) {
      L[name] = (async function () {
        await runtime();
        var buf = await bytes(FILES[name]);
        var nt = Math.max(1, Math.min(4, Math.floor(((root.navigator && navigator.hardwareConcurrency) || 2) / 2))); // explicit: the library's default can be fractional on 1-core CPUs
        M[name] = name === 'obj'
          ? await root.tflite.ObjectDetector.create(buf, { maxResults: 12, scoreThreshold: 0.3, numThreads: nt })
          : await root.tflite.loadTFLiteModel(buf, { numThreads: nt });
        return M[name];
      })().catch(function (e) { L[name] = null; throw e; });
    }
    return L[name];
  }

  function outList(o) {
    if (Array.isArray(o)) return o;
    if (o && o.shape && o.data) return [o];
    return Object.keys(o).map(function (k) { return o[k]; });
  }
  function lastDim(t) { return t.shape[t.shape.length - 1]; }
  function freeAll(list) { list.forEach(function (t) { try { t.dispose(); } catch (e) { } }); }

  async function detectFaces(src, thr) {
    var m = await model('det'), tf = root.tf;
    var sw = srcW(src), sh = srcH(src), lb = P.letterbox(sw, sh, 128), g = cv(128).getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
    g.drawImage(src, 0, 0, sw, sh, lb.ox, lb.oy, lb.dw, lb.dh);
    var out = tf.tidy(function () {
      var x = tf.browser.fromPixels(cv(128)).cast('float32').sub(127.5).div(127.5).expandDims(0);
      return m.predict(x);
    });
    var list = outList(out);
    var reg = list.filter(function (t) { return lastDim(t) === 16; })[0];
    var cls = list.filter(function (t) { return lastDim(t) === 1; })[0];
    var rd = await reg.data(), cd = await cls.data();
    freeAll(list);
    return P.decodeFaces(rd, cd, thr || 0.6, 0.3).map(function (d) { return P.toSource(d, lb); });
  }

  async function landmarks(src, f) {
    var m = await model('lm'), tf = root.tf;
    var roll = P.kpRoll(f.kp), size = Math.max(f.w, f.h) * 1.5;
    var c = cropRot(src, f.cx, f.cy, size, roll, 192);
    var out = tf.tidy(function () { return m.predict(tf.browser.fromPixels(c).cast('float32').div(255).expandDims(0)); });
    var list = outList(out);
    var mesh = list.filter(function (t) { return t.size === 1404; })[0];
    var sc = list.filter(function (t) { return t.size === 1; })[0];
    var md = await mesh.data(), sd = await sc.data();
    freeAll(list);
    return { score: 1 / (1 + Math.exp(-sd[0])), pts: P.meshToSource(md, f.cx, f.cy, size, roll) };
  }

  async function embed(src, cx, cy, size, roll) {
    var m = await model('emb'), tf = root.tf;
    var c = cropRot(src, cx, cy, size, roll, 160);
    var px = tf.tidy(function () { return tf.browser.fromPixels(c).cast('float32'); });
    var raw = await px.data(); px.dispose();
    var x = P.prewhiten(new Float32Array(raw));
    var inp = tf.tensor4d(x, [1, 160, 160, 3]);
    var out = m.predict(inp); inp.dispose();
    var list = outList(out), v = await list[0].data(); freeAll(list);
    return P.l2(v);
  }

  // Largest face -> {emb, box, score, lmScore, faces}. null if no face.
  async function faceFromSource(src) {
    var faces = await detectFaces(src, 0.6);
    if (!faces.length) return null;
    faces.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    var f = faces[0], lm = null, roll, cx, cy, size;
    try { lm = await landmarks(src, f); } catch (e) { lm = null; }
    if (lm && lm.score > 0.5) {
      var g = P.meshGeom(lm.pts); roll = g.roll; cx = g.cx; cy = g.cy; size = g.size * 1.15;
    } else { roll = P.kpRoll(f.kp); cx = f.cx; cy = f.cy; size = Math.max(f.w, f.h) * 1.3; }
    var emb = await embed(src, cx, cy, size, roll);
    return { emb: emb, box: { x: f.cx - f.w / 2, y: f.cy - f.h / 2, w: f.w, h: f.h }, score: f.score, lmScore: lm ? lm.score : null, faces: faces.length };
  }

  /* ---- storage + public face API ---- */
  var KEY = 'core_face_emb512', THR_KEY = 'core_offvis_thr', DEF_THR = 0.70; // cosine similarity; 0.70 ~ the usual FaceNet-512 cutoff, tune per person
  function storedEmb() { try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function threshold() { var t = parseFloat(localStorage.getItem(THR_KEY)); return t > 0 && t < 1 ? t : DEF_THR; }
  function imgFromUrl(u) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = u; }); }

  async function enroll(src) {
    var r = await faceFromSource(src);
    if (!r) return { ok: false, reason: 'noface' };
    try { localStorage.setItem(KEY, JSON.stringify(r.emb.map(function (v) { return Math.round(v * 1e5) / 1e5; }))); } catch (e) { }
    return { ok: true, faces: r.faces, lmScore: r.lmScore };
  }

  async function match(src) {
    var ref = storedEmb();
    if (!ref) { // enrolled earlier with the online model? derive the offline template from the saved photo
      var photo = null; try { photo = localStorage.getItem('core_face_photo'); } catch (e) { }
      if (photo) {
        try { var pr = await faceFromSource(await imgFromUrl(photo)); if (pr) { ref = pr.emb; localStorage.setItem(KEY, JSON.stringify(ref)); } } catch (e) { }
      }
    }
    if (!ref) return { enrolled: false };
    var r = await faceFromSource(src);
    if (!r) return { enrolled: true, face: false };
    var sim = P.cosine(ref, r.emb);
    return { enrolled: true, face: true, sim: sim, match: sim >= threshold(), threshold: threshold() };
  }

  async function detectObjects(src, max) {
    var d = await model('obj'), res = d.detect(src);
    return res.map(function (o) {
      var c = o.classes[0] || { className: '?', probability: 0 };
      return { class: c.className, score: c.probability, bbox: [o.boundingBox.originX, o.boundingBox.originY, o.boundingBox.width, o.boundingBox.height] };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, max || 8);
  }

  /* ---- pack download (models + runtime into a cache the service worker leaves alone) ---- */
  async function downloadPack(onProgress) {
    if (!root.caches) throw new Error('This browser has no Cache Storage');
    var c = await caches.open(CACHE), total = 0, done = 0;
    PACK.forEach(function (p) { total += p[1]; });
    for (var i = 0; i < PACK.length; i++) {
      var url = BASE + PACK[i][0], r = await fetch(url, { cache: 'reload' });
      if (!r.ok) throw new Error('Could not fetch ' + PACK[i][0] + ' (' + r.status + ')');
      var put = c.put(url, r.clone()), rd = r.body.getReader();
      for (;;) { var s = await rd.read(); if (s.done) break; done += s.value.length; if (onProgress) onProgress(Math.min(1, done / total)); }
      await put;
    }
    try { localStorage.setItem('core_offvis_ready', '1'); } catch (e) { }
    if (onProgress) onProgress(1);
  }

  function isReady() { try { return localStorage.getItem('core_offvis_ready') === '1'; } catch (e) { return false; } }
  function force() { try { return localStorage.getItem('core_offvis_force') === '1'; } catch (e) { return false; } }
  function shouldUse() { return isReady() && (force() || (typeof navigator !== 'undefined' && navigator.onLine === false)); }

  var API = {
    ready: isReady, shouldUse: shouldUse, enroll: enroll, match: match, faceFromSource: faceFromSource,
    detectObjects: detectObjects, describeObjects: P.describeObjects, downloadPack: downloadPack,
    objModel: { detect: function (v, max) { return detectObjects(v, max); } },
    setThreshold: function (t) { try { localStorage.setItem(THR_KEY, String(t)); } catch (e) { } },
    getThreshold: threshold, _pure: P
  };
  root.CORE_OFFVIS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  /* ---- settings UI (More tab) ---- */
  function buildUI() {
    var ct = document.getElementById('xMore'); if (!ct || document.getElementById('xOV')) return;
    var note = Array.prototype.filter.call(ct.children, function (c) { return c.classList && c.classList.contains('note'); })[0], box = document.createElement('div'); // direct child only
    box.innerHTML =
      '<div class="xRow"><span>Always use offline vision</span><input type="checkbox" id="xOV"></div>' +
      '<button class="panelActionBtn" id="xOVD" type="button">Download offline vision pack (~48 MB, use Wi-Fi)</button>' +
      '<div class="note" id="xOVS" style="margin-top:6px"></div>';
    if (note) ct.insertBefore(box, note); else ct.appendChild(box);
    var cb = document.getElementById('xOV'), btn = document.getElementById('xOVD'), st = document.getElementById('xOVS');
    function idle() {
      st.textContent = isReady()
        ? 'Offline vision ready \u2713 Face match + object scan work with no internet. Used automatically when you\u2019re offline.'
        : 'Faces (detect, mesh, FaceNet-512) and objects (EfficientDet) running on-device. Download once, then it works offline.';
      btn.textContent = isReady() ? 'Re-download offline vision pack' : 'Download offline vision pack (~48 MB, use Wi-Fi)';
    }
    cb.checked = force(); idle();
    cb.onchange = function () { try { localStorage.setItem('core_offvis_force', cb.checked ? '1' : '0'); } catch (e) { } };
    btn.onclick = async function () {
      btn.disabled = true;
      try {
        await downloadPack(function (p) { st.textContent = 'Downloading\u2026 ' + Math.round(p * 100) + '%'; });
        st.textContent = 'Checking models\u2026';
        await model('det'); await model('obj');
        idle();
      } catch (e) { st.textContent = 'Download failed: ' + (e && e.message ? e.message : e); }
      btn.disabled = false;
    };
  }
  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI); else buildUI();
  }
})(typeof self !== 'undefined' ? self : globalThis);
