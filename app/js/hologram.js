// The knowledge map as a hologram: your notes, vault pages and links floating in 3D. Drag to
// turn it, scroll or pinch to zoom, tap a dot to read it. Switch on hand control and your webcam
// follows your hands (MediaPipe, runs in the browser; the video never leaves the device):
// pinch and drag to rotate, pinch with both hands to zoom, a quick pinch to select, swipe an
// open palm to spin, hold a fist to reset.

import * as G from './graph.js';
import * as G3 from './graph3d.js';
import { createGestures } from './gestures.js';
import { h, icon } from './ui.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const pos = new Map(); // kept between openings so the shape stays familiar

// opts: { graph, ids, edges, onOpen(node) }
export function open({ graph, ids, edges, onOpen }) {
  const canvas = h('canvas', { class: 'holo-canvas', 'aria-label': 'Your knowledge map in 3D. Drag to rotate, scroll to zoom.' });
  const info = h('div', { class: 'holo-info', hidden: true });
  const hint = h('p', { class: 'holo-hint' }, 'Drag to rotate · scroll to zoom · tap a dot');
  const video = h('video', { class: 'holo-video', playsinline: true, muted: true, autoplay: true, hidden: true });
  const overlay = h('canvas', { class: 'holo-video-overlay', hidden: true });
  const handBtn = h('button', { class: 'holo-btn', 'aria-pressed': 'false', onclick: () => (hands ? stopHands() : startHands()) }, icon('hand', 16), 'Hand control');
  const spinBtn = h('button', { class: 'holo-btn on', 'aria-pressed': 'true', onclick: () => { auto = !auto; spinBtn.classList.toggle('on', auto); spinBtn.setAttribute('aria-pressed', String(auto)); } }, icon('orbit', 16), 'Auto-rotate');
  const root = h('div', { class: 'holo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Knowledge hologram' },
    canvas,
    h('header', { class: 'holo-top' },
      h('div', null, h('p', { class: 'holo-title' }, 'KNOWLEDGE MAP'), h('p', { class: 'holo-sub' }, `${ids.length} nodes · ${edges.length} links`)),
      h('div', { class: 'holo-actions' }, spinBtn, handBtn, h('button', { class: 'holo-btn', 'aria-label': 'Close (Esc)', onclick: () => close() }, icon('close', 16)))),
    info, hint, h('div', { class: 'holo-cam' }, video, overlay));
  document.body.append(root);
  document.body.classList.add('sheet-open');

  const g = canvas.getContext('2d');
  let w = 0; let hh = 0; let frame = 0; let alpha = 1; let auto = true; let lastUser = 0; let spinV = 0;
  let hover = null; let selected = null; let cursor = null; let hands = null;
  const cam = { yaw: 0.4, pitch: -0.25, dist: 600, fov: 1 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  G3.seed3(pos, ids, graph);
  for (let i = 0; i < 120; i++) G3.step3(pos, ids, edges, { alpha: 1 });
  G3.recenter(pos, ids);
  cam.dist = G3.fitDistance(pos, ids, cam.fov);
  const fitDist = () => G3.fitDistance(pos, ids, cam.fov);

  const deg = (id) => G.degree(graph.nodes.get(id));
  // Labels for the few biggest hubs only, so the cloud stays readable.
  const hubs = new Set([...ids].sort((a, b) => deg(b) - deg(a)).slice(0, Math.min(8, Math.ceil(ids.length / 6))).filter((id) => deg(id) > 1));

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; hh = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  let projected = [];
  function draw(now) {
    if (!w) resize();
    g.clearRect(0, 0, w, hh);
    // Floor grid rings, for depth.
    g.save();
    g.strokeStyle = 'rgba(79, 209, 255, 0.12)';
    g.lineWidth = 1;
    const floorY = G3.fitDistance(pos, ids, 2) * 0.35;
    for (let r = 1; r <= 4; r++) {
      g.beginPath();
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * Math.PI * 2;
        const p = G3.project({ x: Math.cos(th) * r * floorY * 0.6, y: floorY, z: Math.sin(th) * r * floorY * 0.6 }, cam, w, hh);
        if (!p) continue;
        if (a) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]);
      }
      g.stroke();
    }
    g.restore();

    projected = [];
    for (const id of ids) {
      const p = G3.project(pos.get(id), cam, w, hh);
      if (p) projected.push({ id, x: p[0], y: p[1], z: p[2], k: p[3] });
    }
    const at = new Map(projected.map((p) => [p.id, p]));
    const focus = hover || selected;
    const near = focus ? G.neighborhood(graph, focus, 1) : null;
    const zs = projected.map((p) => p.z);
    const zmin = Math.min(...zs); const zmax = Math.max(...zs);
    const fade = (z) => (zmax > zmin ? 1 - 0.7 * ((z - zmin) / (zmax - zmin)) : 1);

    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1;
    for (const e of edges) {
      const a = at.get(e.a); const b = at.get(e.b);
      if (!a || !b) continue;
      const lit = near && near.has(e.a) && near.has(e.b);
      g.strokeStyle = lit ? 'rgba(120, 225, 255, 0.75)' : `rgba(79, 209, 255, ${(0.18 * fade((a.z + b.z) / 2)).toFixed(3)})`;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    projected.sort((a, b) => b.z - a.z); // far first
    for (const p of projected) {
      const n = graph.nodes.get(p.id);
      const r = Math.max(1.2, (2 + Math.sqrt(deg(p.id)) * 1.4) * p.k * 1.6);
      const dim = near && !near.has(p.id);
      const col = G.GROUPS[n.group]?.color || '#4fd1ff';
      const a = fade(p.z) * (dim ? 0.25 : 1);
      g.globalAlpha = a * 0.35;
      g.fillStyle = col;
      g.beginPath(); g.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2); g.fill();
      g.globalAlpha = a;
      g.fillStyle = mixCyan(col);
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
      if (p.id === selected || p.id === hover) {
        g.globalAlpha = 1;
        g.strokeStyle = '#eafcff';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(p.x, p.y, r + 5 + Math.sin(now / 200) * 1.5, 0, Math.PI * 2); g.stroke();
      }
    }
    g.restore();
    // Labels: hovered, selected, their neighbours, and the big hubs up close.
    g.save();
    g.font = '12px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const p of projected) {
      const big = hubs.has(p.id) && p.k > 0.6;
      if (!(p.id === hover || p.id === selected || (near && near.has(p.id)) || big)) continue;
      const n = graph.nodes.get(p.id);
      g.globalAlpha = fade(p.z);
      g.fillStyle = p.id === hover || p.id === selected ? '#ffffff' : '#bfefff';
      g.fillText(truncate(n.display || n.title, 32), p.x, p.y - 10 - 4 * p.k);
    }
    g.restore();
    if (cursor) {
      g.save();
      g.strokeStyle = '#4fd1ff'; g.lineWidth = 2; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(cursor.x, cursor.y, 14, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cursor.x, cursor.y, 3, 0, Math.PI * 2); g.fillStyle = '#4fd1ff'; g.fill();
      g.restore();
    }
  }

  function hit(sx, sy, radius = 22) {
    let best = null; let bd = radius;
    for (const p of projected) {
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }

  function select(id) {
    selected = id;
    const n = id && graph.nodes.get(id);
    info.hidden = !n;
    if (!n) return;
    const links = [...n.links, ...n.backlinks].map((x) => graph.nodes.get(x)).filter((x) => x && x.kind !== 'tag').slice(0, 8);
    info.replaceChildren(
      h('p', { class: 'holo-info-kind' }, G.GROUPS[n.group]?.label || n.kind),
      h('p', { class: 'holo-info-title' }, n.display || n.title),
      h('p', { class: 'holo-sub' }, `${n.links.size} links out · ${n.backlinks.size} in`),
      links.length ? h('ul', null, links.map((x) => h('li', null, h('button', { class: 'holo-link', onclick: () => select(x.id) }, x.display || x.title)))) : null,
      h('div', { class: 'holo-actions' },
        h('button', { class: 'holo-btn on', onclick: () => { close(); onOpen?.(n); } }, 'Open'),
        h('button', { class: 'holo-btn', onclick: () => select(null) }, 'Close')));
  }

  const tick = (now) => {
    if (!root.isConnected) return;
    if (alpha > 0.02) { G3.step3(pos, ids, edges, { alpha }); alpha *= 0.97; G3.recenter(pos, ids); }
    if (auto && !reduced && now - lastUser > 2500 && !selected) cam.yaw += 0.0025;
    if (Math.abs(spinV) > 0.0005) { cam.yaw += spinV; spinV *= 0.95; }
    if (hands) handFrame(now);
    draw(now);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  // ---- Mouse and touch -----------------------------------------------------------------------------------------
  const pts = new Map();
  let drag = null; let pinch = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    lastUser = performance.now();
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: cam.dist }; drag = null; return; }
    drag = { x: p[0], y: p[1], yaw: cam.yaw, pitch: cam.pitch, moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!pts.has(e.pointerId)) { if (e.pointerType === 'mouse') { hover = hit(...p); canvas.style.cursor = hover ? 'pointer' : 'grab'; } return; }
    pts.set(e.pointerId, p);
    lastUser = performance.now();
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; cam.dist = clampDist(pinch.dist * pinch.d / Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1]))); return; }
    if (!drag) return;
    drag.moved = Math.max(drag.moved, Math.hypot(p[0] - drag.x, p[1] - drag.y));
    cam.yaw = drag.yaw + (p[0] - drag.x) * 0.006;
    cam.pitch = clampPitch(drag.pitch + (p[1] - drag.y) * 0.006);
  });
  const end = (e) => {
    const p = local(e);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (drag && drag.moved < 5) select(hit(...p));
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); lastUser = performance.now(); cam.dist = clampDist(cam.dist * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  const clampDist = (d) => Math.max(40, Math.min(fitDist() * 3, d));
  const clampPitch = (p) => Math.max(-1.35, Math.min(1.35, p));

  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  // ---- Hands --------------------------------------------------------------------------------------------------------
  let landmarker = null; let stream = null; let lastVideoTime = -1; const gestures = createGestures();
  async function startHands() {
    handBtn.disabled = true;
    hint.textContent = 'Loading hand tracking (about 8 MB, once)…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      video.srcObject = stream;
      video.hidden = false; overlay.hidden = false;
      await video.play();
      if (!landmarker) {
        const { FilesetResolver, HandLandmarker } = await import(`${MP}/vision_bundle.mjs`);
        const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
        const make = (delegate) => HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2 });
        try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
      }
      hands = true;
      handBtn.classList.add('on'); handBtn.setAttribute('aria-pressed', 'true');
      hint.textContent = 'Pinch + drag: rotate · two-hand pinch: zoom · quick pinch: select · swipe palm: spin · fist: reset';
    } catch (e) {
      console.error(e);
      stopHands();
      hint.textContent = e.name === 'NotAllowedError' ? 'Camera blocked. Allow it in the browser’s site settings to use hand control.' : `Hand control couldn’t start: ${e.message}`;
    } finally { handBtn.disabled = false; }
  }
  function stopHands() {
    hands = null; cursor = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.hidden = true; overlay.hidden = true;
    handBtn.classList.remove('on'); handBtn.setAttribute('aria-pressed', 'false');
  }
  function handFrame(now) {
    if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    let res;
    try { res = landmarker.detectForVideo(video, now); } catch { return; }
    const list = (res.landmarks || []).map((l) => ({ landmarks: l }));
    drawHands(res.landmarks || []);
    const act = gestures.update(list, now);
    if (list.length) lastUser = now;
    cursor = act.cursor ? { x: act.cursor.x * w, y: act.cursor.y * hh } : null;
    if (cursor) hover = hit(cursor.x, cursor.y, 36);
    if (act.rotate) { cam.yaw += act.rotate.dx * 5; cam.pitch = clampPitch(cam.pitch + act.rotate.dy * 3.5); }
    if (act.zoom && Number.isFinite(act.zoom)) cam.dist = clampDist(cam.dist / act.zoom);
    if (act.select) select(hit(act.select.x * w, act.select.y * hh, 40));
    if (act.spin) spinV = Math.max(-0.08, Math.min(0.08, act.spin * 0.02));
    if (act.reset) { cam.yaw = 0.4; cam.pitch = -0.25; cam.dist = fitDist(); select(null); spinV = 0; }
  }
  function drawHands(all) {
    const c = overlay.getContext('2d');
    overlay.width = 160; overlay.height = 120;
    c.clearRect(0, 0, 160, 120);
    c.fillStyle = '#4fd1ff';
    for (const lm of all) for (const p of lm) { c.beginPath(); c.arc((1 - p.x) * 160, p.y * 120, 2, 0, Math.PI * 2); c.fill(); }
  }

  function close() {
    cancelAnimationFrame(frame);
    stopHands();
    try { landmarker?.close(); } catch { /* ignore */ }
    ro.disconnect();
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    document.body.classList.remove('sheet-open');
  }
  return { close };
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

// Pull a group colour toward hologram cyan so the whole map reads as one projection.
const mixed = new Map();
function mixCyan(hex) {
  if (mixed.has(hex)) return mixed.get(hex);
  const n = parseInt(hex.slice(1), 16);
  const [r, gg, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const out = `rgb(${Math.round(r * 0.55 + 79 * 0.45)}, ${Math.round(gg * 0.55 + 209 * 0.45)}, ${Math.round(b * 0.55 + 255 * 0.45)})`;
  mixed.set(hex, out);
  return out;
}
