// A 3D layout of the knowledge map, for the hologram view: the same forces as the flat map
// (repulsion, springs along links, a pull to the centre) in three dimensions, plus a camera
// that projects points onto the screen. No DOM here so it can be tested.

export function seed3(pos, ids, graph) {
  let i = pos.size;
  for (const id of ids) {
    if (pos.has(id)) continue;
    const n = graph.nodes.get(id);
    const near = n ? [...n.links, ...n.backlinks].map((o) => pos.get(o)).find(Boolean) : null;
    // Fibonacci sphere, growing with the count.
    const k = i + 0.5;
    const phi = Math.acos(1 - (2 * ((k * 0.618034) % 1)));
    const theta = Math.PI * (1 + Math.sqrt(5)) * k;
    const r = near ? 22 : 18 * Math.cbrt(i + 1) * 2;
    const b = near || { x: 0, y: 0, z: 0 };
    pos.set(id, { x: b.x + r * Math.sin(phi) * Math.cos(theta), y: b.y + r * Math.cos(phi), z: b.z + r * Math.sin(phi) * Math.sin(theta), vx: 0, vy: 0, vz: 0 });
    i++;
  }
}

export function step3(pos, ids, edges, { alpha = 1, repel = 400, spring = 0.05, length = 60, gravity = 0.012 } = {}) {
  const P = ids.map((id) => pos.get(id)).filter(Boolean);
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i];
    for (let j = i + 1; j < n; j++) {
      const b = P[j];
      let dx = a.x - b.x; let dy = a.y - b.y; let dz = a.z - b.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 250000) continue;
      if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dz = Math.random() - 0.5; d2 = 0.75; }
      const f = (repel * alpha) / (d2 * Math.sqrt(d2) / 40 + 40);
      a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
      b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
    }
  }
  for (const { a: ia, b: ib } of edges) {
    const a = pos.get(ia); const b = pos.get(ib);
    if (!a || !b) continue;
    const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const f = ((d - length) / d) * spring * alpha;
    a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
    b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
  }
  let moved = 0;
  for (const p of P) {
    p.vx -= p.x * gravity * alpha; p.vy -= p.y * gravity * alpha; p.vz -= p.z * gravity * alpha;
    p.vx *= 0.55; p.vy *= 0.55; p.vz *= 0.55;
    p.x += Math.max(-30, Math.min(30, p.vx));
    p.y += Math.max(-30, Math.min(30, p.vy));
    p.z += Math.max(-30, Math.min(30, p.vz));
    moved += Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
  }
  return n ? moved / n : 0;
}

// Camera: yaw/pitch rotate the world, `dist` is how far away it is, `fov` the lens.
// Returns [screenX, screenY, depth, scale] or null when behind the camera.
export function project(p, cam, w, h) {
  const cy = Math.cos(cam.yaw); const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch); const sp = Math.sin(cam.pitch);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;
  const depth = z2 + cam.dist;
  if (depth <= 1) return null;
  const f = (Math.min(w, h) / 2) / Math.tan((cam.fov || 1) / 2);
  const k = f / depth;
  return [w / 2 + x1 * k, h / 2 + y2 * k, depth, k];
}

// How far the camera must be to fit the cloud (a few far-flung outliers may sit off screen).
export function fitDistance(pos, ids, fov = 1, share = 0.92) {
  const rs = ids.map((id) => pos.get(id)).filter(Boolean).map((p) => Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)).sort((a, b) => a - b);
  const r = Math.max(1, rs[Math.min(rs.length - 1, Math.floor(rs.length * share))] || 1);
  return r / Math.tan(fov / 2) + r;
}

// Keep the cloud centred on the origin (the springs let it drift).
export function recenter(pos, ids) {
  let x = 0; let y = 0; let z = 0; let n = 0;
  for (const id of ids) { const p = pos.get(id); if (p) { x += p.x; y += p.y; z += p.z; n++; } }
  if (!n) return;
  x /= n; y /= n; z /= n;
  for (const id of ids) { const p = pos.get(id); if (p) { p.x -= x; p.y -= y; p.z -= z; } }
}
