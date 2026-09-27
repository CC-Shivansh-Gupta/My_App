// Hand gestures for the hologram, from MediaPipe's 21 hand landmarks per hand (x, y in 0..1 of
// the camera image). No DOM here so it can be tested with made-up hands.
//
//   pinch and drag (one hand)      → rotate
//   pinch with both hands, spread  → zoom in / out
//   quick pinch (tap)              → select what's under the cursor
//   point (index finger)           → move the cursor
//   swipe an open palm             → spin
//   make a fist and hold           → reset the view

const WRIST = 0; const THUMB_TIP = 4; const MIDDLE_MCP = 9;
const TIPS = [8, 12, 16, 20]; const PIPS = [6, 10, 14, 18];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// The camera sees you mirrored; flip x so moving your hand right moves things right.
const flip = (p) => ({ x: 1 - p.x, y: p.y });

export function handSize(lm) { return dist(lm[WRIST], lm[MIDDLE_MCP]) || 0.1; }

// Which fingers (index, middle, ring, pinky) are straight.
export function extended(lm) {
  return TIPS.map((tip, i) => dist(lm[tip], lm[WRIST]) > dist(lm[PIPS[i]], lm[WRIST]) * 1.12);
}

// 'pinch' | 'point' | 'open' | 'fist' | 'other'. `wasPinching` gives the pinch some hysteresis.
export function pose(lm, wasPinching = false) {
  const size = handSize(lm);
  const pinchD = dist(lm[THUMB_TIP], lm[8]) / size;
  if (pinchD < (wasPinching ? 0.5 : 0.33)) return 'pinch';
  const ext = extended(lm);
  const n = ext.filter(Boolean).length;
  if (n === 0) return 'fist';
  if (ext[0] && n === 1) return 'point';
  if (n >= 4) return 'open';
  return 'other';
}

const pinchPoint = (lm) => flip({ x: (lm[THUMB_TIP].x + lm[8].x) / 2, y: (lm[THUMB_TIP].y + lm[8].y) / 2 });

export function createGestures({ tapMs = 350, tapMove = 0.035, fistMs = 800, swipeSpeed = 1.6 } = {}) {
  let prev = []; // per hand slot: { pose, at, pt, start, startPt, travel, palm, fistSince }
  let lastTwo = null;
  let resetFired = false;

  // hands: [{ landmarks }] (MediaPipe's result.landmarks mapped). t: ms.
  // Returns { poses, cursor?, rotate?, zoom?, select?, spin?, reset? }.
  function update(hands, t) {
    const out = { poses: [] };
    // Order hands left→right on screen so slots stay stable between frames.
    const hs = (hands || []).map((h) => h.landmarks || h).filter((lm) => lm?.length >= 21)
      .map((lm) => ({ lm, cx: 1 - lm[WRIST].x })).sort((a, b) => a.cx - b.cx).slice(0, 2);
    const next = hs.map(({ lm }, i) => {
      const p = prev[i];
      const ps = pose(lm, p?.pose === 'pinch');
      out.poses.push(ps);
      const s = { pose: ps, at: t, pt: ps === 'pinch' ? pinchPoint(lm) : flip(lm[8]), palm: flip(lm[MIDDLE_MCP]), fistSince: 0 };
      if (ps === 'pinch') {
        if (p?.pose === 'pinch') { s.start = p.start; s.startPt = p.startPt; s.travel = p.travel + dist(p.pt, s.pt); } else { s.start = t; s.startPt = s.pt; s.travel = 0; }
      }
      if (ps === 'fist') s.fistSince = p?.pose === 'fist' ? p.fistSince : t;
      return s;
    });

    const pinching = next.filter((s) => s.pose === 'pinch');
    if (pinching.length === 2) {
      const d = dist(pinching[0].pt, pinching[1].pt);
      if (lastTwo) out.zoom = d / lastTwo;
      lastTwo = d;
    } else {
      lastTwo = null;
      if (pinching.length === 1) {
        const i = next.indexOf(pinching[0]);
        const p = prev[i];
        if (p?.pose === 'pinch') out.rotate = { dx: pinching[0].pt.x - p.pt.x, dy: pinching[0].pt.y - p.pt.y };
      }
    }
    // A pinch that ended quickly without moving is a tap.
    prev.forEach((p, i) => {
      if (p?.pose === 'pinch' && next[i]?.pose !== 'pinch' && t - p.start < tapMs && p.travel < tapMove && pinching.length === 0) out.select = { x: p.startPt.x, y: p.startPt.y };
    });
    const pointer = next.find((s) => s.pose === 'point' || s.pose === 'pinch');
    if (pointer) out.cursor = pointer.pt;
    // Swipe: an open palm moving fast sideways.
    next.forEach((s, i) => {
      const p = prev[i];
      if (s.pose === 'open' && p?.pose === 'open' && t > p.at) {
        const vx = (s.palm.x - p.palm.x) / ((t - p.at) / 1000);
        if (Math.abs(vx) > swipeSpeed) out.spin = vx;
      }
    });
    const fist = next.find((s) => s.pose === 'fist');
    if (fist && t - fist.fistSince >= fistMs) { if (!resetFired) { out.reset = true; resetFired = true; } } else if (!fist) resetFired = false;
    prev = next;
    return out;
  }
  return { update };
}

// ---- Test helpers: make a hand in a pose ----------------------------------------------------------------
// A rough right hand at (cx, cy), palm facing the camera, `size` = wrist → middle knuckle.
export function fakeHand(kind = 'open', { cx = 0.5, cy = 0.6, size = 0.12 } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const at = (i, dx, dy) => { lm[i] = { x: cx + dx * size, y: cy + dy * size, z: 0 }; };
  at(0, 0, 0.6);
  const fingers = [[5, 6, 7, 8, -0.35], [9, 10, 11, 12, -0.1], [13, 14, 15, 16, 0.12], [17, 18, 19, 20, 0.32]];
  const straight = { open: [1, 1, 1, 1], point: [1, 0, 0, 0], fist: [0, 0, 0, 0], pinch: [1, 1, 1, 1], other: [1, 1, 0, 0] }[kind];
  fingers.forEach(([mcp, pip, dip, tip, dx], i) => {
    at(mcp, dx, -0.4);
    at(pip, dx, -0.75);
    if (straight[i]) { at(dip, dx, -1.0); at(tip, dx, -1.25); } else { at(dip, dx, -0.55); at(tip, dx, -0.3); }
  });
  at(1, -0.35, 0.3); at(2, -0.55, 0.05); at(3, -0.6, -0.2);
  if (kind === 'pinch') at(4, -0.33, -1.2); else at(4, -0.8, -0.35);
  return lm;
}
