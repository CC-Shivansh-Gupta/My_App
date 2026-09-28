// The orb: an arc-reactor style ring that shows what Jarvis is doing. It breathes when idle,
// its bars follow your voice while it listens, arcs spin while it thinks, and it pulses with
// its own voice while it speaks. Drawn on a canvas, sized by its container.

import * as convo from './convo.js';
import * as A from './audio.js';

const TAU = Math.PI * 2;

export function createOrb({ label = 'Talk', onTap = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'jv-orb';
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('aria-label', label);
  const g = canvas.getContext('2d');
  let w = 0; let hgt = 0; let frame = 0; let lv = 0; let spin = 0; let flash = 0; let colors = null; let colorAt = 0;
  const bars = new Array(48).fill(0);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const tap = () => { if (onTap) onTap(); };
  canvas.addEventListener('click', tap);
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
  const off = convo.subscribe((ev, res) => { if (ev === 'reply' && res?.miss) flash = 1; });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => size()) : null;
  ro?.observe(canvas);
  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; hgt = r.height;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(hgt * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function readColors() {
    const css = getComputedStyle(canvas);
    colors = {
      glow: css.getPropertyValue('--jv-glow').trim() || '#4fd1ff',
      core: css.getPropertyValue('--jv-core').trim() || '#e8fbff',
      bad: css.getPropertyValue('--bad').trim() || '#d03b3b',
    };
  }

  function draw(now) {
    if (!w) size();
    if (!colors || now - colorAt > 2000) { readColors(); colorAt = now; }
    const mode = convo.state.mode;
    const target = A.level();
    lv += (target - lv) * 0.25;
    const speed = reduced ? 0.15 : 1;
    spin += (mode === 'thinking' ? 0.05 : mode === 'listening' ? 0.012 : 0.004) * speed;
    flash *= 0.94;
    const t = now / 1000;
    const cx = w / 2; const cy = hgt / 2;
    const R = Math.min(w, hgt) * 0.2;
    const col = flash > 0.05 ? colors.bad : colors.glow;
    g.clearRect(0, 0, w, hgt);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = col;
    g.fillStyle = col;

    // Outer tick ring.
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU + spin * 0.3;
      const long = i % 6 === 0;
      const r1 = R * 2.05; const r2 = R * (long ? 2.22 : 2.12);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      g.stroke();
    }

    // Spinning arcs.
    g.globalAlpha = mode === 'thinking' ? 0.9 : 0.55;
    g.lineWidth = 2.5;
    for (const [len, off, dir, r] of [[1.4, 0, 1, 1.78], [0.8, 2.2, 1, 1.78], [0.5, 4.1, 1, 1.78], [2.2, 1, -1.4, 1.62], [0.6, 4, -1.4, 1.62]]) {
      const a = off + spin * dir * 2;
      g.beginPath();
      g.arc(cx, cy, R * r, a, a + len);
      g.stroke();
    }

    // Bars that follow the voice.
    const b = A.bands(bars.length);
    g.lineWidth = Math.max(1.5, R * 0.05);
    g.lineCap = 'round';
    for (let i = 0; i < bars.length; i++) {
      const idle = mode === 'idle' ? 0.06 + 0.04 * Math.sin(t * 1.6 + i * 0.5) : 0.04;
      bars[i] += (Math.max(idle, b[i]) - bars[i]) * 0.3;
      const a = (i / bars.length) * TAU - Math.PI / 2;
      const r1 = R * 1.22; const r2 = r1 + R * 0.08 + bars[i] * R * 0.62;
      g.globalAlpha = 0.35 + bars[i] * 0.6;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      g.stroke();
    }

    // Thinking: dots in orbit. Listening: ripples.
    if (mode === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const a = spin * 3 + (i * TAU) / 3;
        g.globalAlpha = 0.9;
        g.beginPath();
        g.arc(cx + Math.cos(a) * R * 1.45, cy + Math.sin(a) * R * 1.45, R * 0.06, 0, TAU);
        g.fill();
      }
    }
    if (mode === 'listening' && !reduced) {
      for (let i = 0; i < 2; i++) {
        const p = ((t * 0.8 + i / 2) % 1);
        g.globalAlpha = (1 - p) * 0.4;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(cx, cy, R * (1 + p * 1.1), 0, TAU);
        g.stroke();
      }
    }

    // The core.
    const breathe = mode === 'idle' ? 0.04 * Math.sin(t * 1.8) : 0;
    const cr = R * (0.78 + lv * 0.35 + breathe);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, cr * 1.6);
    grad.addColorStop(0, colors.core);
    grad.addColorStop(0.35, col);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.55 + lv * 0.45;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, cr * 1.6, 0, TAU);
    g.fill();
    g.globalAlpha = 0.9;
    g.lineWidth = 2;
    g.strokeStyle = col;
    g.beginPath();
    g.arc(cx, cy, R * 1.02, 0, TAU);
    g.stroke();
    // Inner coils, like the reactor.
    g.globalAlpha = 0.55;
    g.lineWidth = Math.max(2, R * 0.09);
    g.lineCap = 'butt';
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 3 - spin * 0.5;
      g.beginPath();
      g.arc(cx, cy, R * 0.6, a + 0.25, a + TAU / 3 - 0.25);
      g.stroke();
    }
    g.restore();
  }

  const tick = (now) => {
    if (!canvas.isConnected) { frame = 0; return; }
    draw(now);
    frame = requestAnimationFrame(tick);
  };
  // Views call wake() after putting the orb on screen (it stops itself when taken off).
  canvas.wake = () => { if (!frame) frame = requestAnimationFrame(tick); };
  canvas.destroy = () => { cancelAnimationFrame(frame); frame = 0; ro?.disconnect(); off(); };
  return canvas;
}
