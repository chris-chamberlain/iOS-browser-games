/* ===== SIM: fixed-step simulation core (no DOM, no Three.js). Deterministic for a given snapshot list. ===== */
const Sim = (function () {
  'use strict';
  const STEP = 1 / 60;
  const DEG = Math.PI / 180;
  // Tuning table. Starting values come from the Technical Spec and the Character and Combat Spec.
  const T = {
    gravity: 28, terminal: 30, jumpV: 11.1, djumpV: 9.5, holdMul: 0.846, runSpeed: 7,
    accelG: 70, accelA: 49, dashSteps: 12, dashSpeed: 20, jumpBuf: 6, coyote: 6,
    wallSteps: 72, wallSpeed: 6, wallSink: 0.6, wallStick: 0.6, kickOut: 6, kickUp: 11.1, kickLock: 12,
    earthHold: 15, atkFrames: 18, killY: -20,
    radius: 0.35, height: 1.7, supportR: 0.2, stepUp: 0.35, snapDown: 0.3, slopeMax: Math.tan(50 * DEG),
    camDist: 9, camSettle: 0.2, camYawMax: 40, camPitchMin: 5, camPitchMax: 35,
    camPitchBase: 15, camDragDeg: 0.25, camIdleSteps: 120, camLead: 1.5,
    camRadius: 0.25, camPull: 0.2, camRestore: 4
  };
  const B = { ATK: 1, JMP: 2, DSH: 4, EAR: 8, LCK: 16 };

  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------- world: boxes in an 8 m hash grid, one optional heightfield ---------- */
  function makeWorld(def) {
    const w = {
      name: def.name, boxes: def.boxes.map((a, i) => ({ id: i, x0: a[0], x1: a[1], y0: a[2], y1: a[3], z0: a[4], z1: a[5], tag: a[6] || '', mark: 0 })),
      hf: def.hf || null, cps: def.cps || [], gaps: def.gaps || [], spawn: def.spawn || { x: 0, y: 0, z: 0, yaw: Math.PI / 2 },
      finishX: def.finishX === undefined ? 1e9 : def.finishX, grid: new Map(), stamp: 0
    };
    w.boxes.forEach((b) => {
      for (let ix = Math.floor(b.x0 / 8); ix <= Math.floor(b.x1 / 8); ix++)
        for (let iy = Math.floor(b.y0 / 8); iy <= Math.floor(b.y1 / 8); iy++)
          for (let iz = Math.floor(b.z0 / 8); iz <= Math.floor(b.z1 / 8); iz++) {
            const k = ix + ',' + iy + ',' + iz; let a = w.grid.get(k); if (!a) { a = []; w.grid.set(k, a); } a.push(b);
          }
    });
    return w;
  }
  function query(w, x0, x1, y0, y1, z0, z1, out) {
    out.length = 0; const st = ++w.stamp;
    for (let ix = Math.floor(x0 / 8); ix <= Math.floor(x1 / 8); ix++)
      for (let iy = Math.floor(y0 / 8); iy <= Math.floor(y1 / 8); iy++)
        for (let iz = Math.floor(z0 / 8); iz <= Math.floor(z1 / 8); iz++) {
          const a = w.grid.get(ix + ',' + iy + ',' + iz);
          if (a) for (let i = 0; i < a.length; i++) { const b = a[i]; if (b.mark !== st) { b.mark = st; out.push(b); } }
        }
    return out;
  }
  function hfH(hf, x, z) {
    const gx = (x - hf.x0) / hf.cell, gz = (z - hf.z0) / hf.cell;
    if (gx < 0 || gz < 0 || gx > hf.nx || gz > hf.nz) return -Infinity;
    let i = Math.floor(gx), j = Math.floor(gz); if (i >= hf.nx) i = hf.nx - 1; if (j >= hf.nz) j = hf.nz - 1;
    const fx = gx - i, fz = gz - j, W = hf.nx + 1, h = hf.h;
    return (h[j * W + i] * (1 - fx) + h[j * W + i + 1] * fx) * (1 - fz) + (h[(j + 1) * W + i] * (1 - fx) + h[(j + 1) * W + i + 1] * fx) * fz;
  }
  function hfSlope(hf, x, z) {
    const e = 0.25, a = hfH(hf, x + e, z), b = hfH(hf, x - e, z), c = hfH(hf, x, z + e), d = hfH(hf, x, z - e);
    if (!isFinite(a + b + c + d)) return 0;
    return Math.hypot((a - b) / (2 * e), (c - d) / (2 * e));
  }
  const _q = [], _q2 = [];
  // Highest walkable surface at (x,z) whose height is at most ref + reach.
  function groundAt(w, x, z, ref, reach) {
    let best = -Infinity; const r = T.supportR, lim = ref + reach;
    query(w, x - r, x + r, ref - 14, lim, z - r, z + r, _q);
    for (let i = 0; i < _q.length; i++) {
      const b = _q[i]; if (b.y1 > lim || b.y1 <= best) continue;
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
      if (dx * dx + dz * dz <= r * r) best = b.y1;
    }
    if (w.hf) { const h = hfH(w.hf, x, z); if (h > best && h <= lim && hfSlope(w.hf, x, z) <= T.slopeMax) best = h; }
    return best;
  }
  function resolveHoriz(s, w) {
    const r = T.radius;
    for (let pass = 0; pass < 3; pass++) {
      const feet = s.y, head = s.y + T.height, top = feet + (s.grounded ? T.stepUp : 0.05);
      query(w, s.x - r, s.x + r, feet, head, s.z - r, s.z + r, _q2);
      let moved = false;
      for (let i = 0; i < _q2.length; i++) {
        const b = _q2[i]; if (b.y1 <= top || b.y0 >= head) continue;
        const cx = clamp(s.x, b.x0, b.x1), cz = clamp(s.z, b.z0, b.z1);
        let dx = s.x - cx, dz = s.z - cz, nx, nz, pen;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
        else {
          const a0 = s.x - b.x0, a1 = b.x1 - s.x, c0 = s.z - b.z0, c1 = b.z1 - s.z, m = Math.min(a0, a1, c0, c1);
          if (m === a0) { nx = -1; nz = 0; } else if (m === a1) { nx = 1; nz = 0; } else if (m === c0) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
          pen = m + r;
        }
        s.x += nx * pen; s.z += nz * pen; moved = true;
        const vn = s.vx * nx + s.vz * nz; if (vn < 0) { s.vx -= vn * nx; s.vz -= vn * nz; }
        s.wallHit = true; s.wnx = nx; s.wnz = nz;
      }
      if (!moved) break;
    }
  }
  function headBump(s, w, y0, y1) {
    const r = T.radius * 0.9;
    query(w, s.x - r, s.x + r, y0 + T.height, y1 + T.height, s.z - r, s.z + r, _q2);
    for (let i = 0; i < _q2.length; i++) {
      const b = _q2[i]; if (b.y0 < y0 + T.height - 0.01 || b.y0 >= y1 + T.height) continue;
      const dx = Math.max(b.x0 - s.x, 0, s.x - b.x1), dz = Math.max(b.z0 - s.z, 0, s.z - b.z1);
      if (dx * dx + dz * dz < r * r) { s.y = b.y0 - T.height; if (s.vy > 0) s.vy = 0; y1 = s.y; }
    }
  }
  // Moves the capsule in substeps of at most 0.2 m. Horizontal first, then vertical with the ground probe.
  function collideMove(s, w, dx, dy, dz) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.2));
    const fx = dx / n, fy = dy / n, fz = dz / n;
    s.wallHit = false;
    for (let k = 0; k < n; k++) {
      s.x += fx; s.z += fz; resolveHoriz(s, w);
      const ref = s.y; s.y += fy;
      if (fy > 0) { headBump(s, w, ref, s.y); s.grounded = false; continue; }
      const g = groundAt(w, s.x, s.z, ref, s.grounded ? T.stepUp : 0.05);
      if (g >= s.y - 1e-9 && g > -Infinity) { s.y = g; s.grounded = true; }
      else if (s.grounded && g > -Infinity && s.y - g <= T.snapDown && fy >= -1e-9) { s.y = g; }
      else s.grounded = false;
    }
  }
  function wallProbe(s, w, nx, nz) {
    const px = s.x - nx * (T.radius + 0.1), pz = s.z - nz * (T.radius + 0.1);
    query(w, px - 0.1, px + 0.1, s.y + 0.4, s.y + T.height - 0.2, pz - 0.1, pz + 0.1, _q2);
    for (let i = 0; i < _q2.length; i++) {
      const b = _q2[i];
      if (b.y1 > s.y + T.stepUp && b.y0 < s.y + T.height - 0.2 && px >= b.x0 - 0.02 && px <= b.x1 + 0.02 && pz >= b.z0 - 0.02 && pz <= b.z1 + 0.02) return true;
    }
    return false;
  }

  /* ---------- camera ---------- */
  function camDir(s) {
    const yaw = s.yawOff * DEG, pit = s.pitch * DEG;
    return [Math.sin(yaw) * Math.cos(pit), Math.sin(pit), Math.cos(yaw) * Math.cos(pit)];
  }
  function updateCamPos(s) {
    const d = camDir(s);
    s.cx = s.tx + d[0] * s.arm; s.cy = s.ty + d[1] * s.arm; s.cz = s.tz + d[2] * s.arm;
  }
  // distance from a point to the nearest box surface, 0 when inside
  function boxDist(w, x, y, z) {
    let best = 1e9;
    query(w, x - 1, x + 1, y - 1, y + 1, z - 1, z + 1, _q2);
    for (let i = 0; i < _q2.length; i++) {
      const b = _q2[i], dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1), dz = Math.max(b.z0 - z, 0, z - b.z1);
      const d = Math.hypot(dx, dy, dz); if (d < best) best = d;
    }
    return best;
  }
  // The ray runs from the follow target to the wanted camera position. Boxes that contain the target are skipped.
  // The arm shortens at once and recovers at 4 m/s.
  function camCollide(s, w) {
    const d = camDir(s), want = T.camDist;
    const o = [s.tx, s.ty, s.tz], ex = o[0] + d[0] * want, ey = o[1] + d[1] * want, ez = o[2] + d[2] * want;
    let hit = want;
    query(w, Math.min(o[0], ex) - 0.4, Math.max(o[0], ex) + 0.4, Math.min(o[1], ey) - 0.4, Math.max(o[1], ey) + 0.4, Math.min(o[2], ez) - 0.4, Math.max(o[2], ez) + 0.4, _q2);
    for (let i = 0; i < _q2.length; i++) {
      const b = _q2[i];
      if (o[0] >= b.x0 && o[0] <= b.x1 && o[1] >= b.y0 && o[1] <= b.y1 && o[2] >= b.z0 && o[2] <= b.z1) continue;
      // A target inside the padded shell but outside the box, with the ray pointing away from the box, does not hit it.
      const nx = o[0] - Math.min(Math.max(o[0], b.x0), b.x1), ny = o[1] - Math.min(Math.max(o[1], b.y0), b.y1), nz = o[2] - Math.min(Math.max(o[2], b.z0), b.z1);
      if (nx * d[0] + ny * d[1] + nz * d[2] >= 0 && nx * nx + ny * ny + nz * nz < T.camRadius * T.camRadius) continue;
      let t0 = 0, t1 = hit, ok = true;
      const R = T.camRadius, lo = [b.x0 - R, b.y0 - R, b.z0 - R], hi = [b.x1 + R, b.y1 + R, b.z1 + R];
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) ok = false; }
        else { let a1 = (lo[a] - o[a]) / d[a], a2 = (hi[a] - o[a]) / d[a]; if (a1 > a2) { const t = a1; a1 = a2; a2 = t; } if (a1 > t0) t0 = a1; if (a2 < t1) t1 = a2; if (t0 > t1) ok = false; }
      }
      if (ok && t0 < hit) hit = t0;
    }
    const wantArm = hit >= want ? want : Math.max(hit - T.camPull, hit * 0.5);
    if (wantArm < s.arm) s.arm = wantArm; else s.arm = Math.min(wantArm, s.arm + T.camRestore * STEP);
  }

  /* ---------- state ---------- */
  function snapCam(s) {
    s.tx = s.x; s.ty = s.y + 1.2; s.tz = s.z; s.tvx = s.tvy = s.tvz = 0; s.lx = s.lz = 0; s.arm = T.camDist;
    updateCamPos(s);
    s.ptx = s.tx; s.pty = s.ty; s.ptz = s.tz; s.pcx = s.cx; s.pcy = s.cy; s.pcz = s.cz;
  }
  function reset(s, worldName) {
    if (worldName) s.world = worldName;
    if (!s.world) s.world = 'field';
    s.w = getWorld(s.world);
    const sp = s.w.spawn;
    s.step = 0;
    s.x = sp.x; s.y = sp.y; s.z = sp.z; s.px = s.x; s.py = s.y; s.pz = s.z;
    s.vx = 0; s.vy = 0; s.vz = 0;
    s.yaw = sp.yaw; s.pyaw = s.yaw;
    s.grounded = true; s.coyote = T.coyote; s.jbuf = 0; s.airJumps = 1; s.holdOK = false;
    s.dash = 0; s.dashUsed = false; s.ddx = 0; s.ddz = 0;
    s.wallRun = 0; s.wallRunUsed = false; s.wnx = 0; s.wnz = 0; s.wcStep = -99; s.wallHit = false; s.lockH = 0;
    s.atk = 0; s.earthDown = false; s.earthHold = 0; s.lastEarthHold = 0;
    s.lock = false; s.prevBits = 0;
    s.needles = 0; s.boulders = 0; s.jumps = 0; s.djumps = 0; s.dashes = 0; s.attacks = 0; s.respawns = 0; s.kicks = 0; s.wallRuns = 0;
    s.cp = 0; s.gapDone = s.w.gaps.map(() => 0); s.gapNear = s.w.gaps.map(() => false); s.finishStep = 0;
    s.evJump = -99; s.evDJump = -99; s.evDash = -99; s.evAirDash = -99; s.evLand = -99; s.evKick = -99; s.evWallRun = -99; s.landV = 0;
    s.nan = false; s.camMin = 1e9; s.camClip = 0; s.maxApex = 0; s.wallRunSteps = 0;
    s.yawOff = 0; s.pitch = T.camPitchBase; s.idle = 0;
    snapCam(s);
    return s;
  }
  function create(worldName) { return reset({}, worldName || 'field'); }

  function respawn(s) {
    const w = s.w, c = s.cp > 0 ? w.cps[s.cp - 1] : w.spawn;
    s.x = c.x; s.y = c.y; s.z = c.z; s.px = s.x; s.py = s.y; s.pz = s.z;
    s.vx = s.vy = s.vz = 0; s.grounded = true; s.dash = 0; s.wallRun = 0; s.wallRunUsed = false; s.airJumps = 1; s.dashUsed = false;
    s.coyote = T.coyote; s.jbuf = 0; s.lockH = 0; s.yaw = s.pyaw = c.yaw === undefined ? Math.PI / 2 : c.yaw;
    s.gapNear = w.gaps.map(() => false);
    s.respawns++; snapCam(s);
  }

  function intent(s, snap) {
    let sx = snap.sx, sy = snap.sy; const m = Math.hypot(sx, sy); if (m > 1) { sx /= m; sy /= m; }
    const camYaw = s.yawOff * DEG, c = Math.cos(camYaw), sn = Math.sin(camYaw);
    return { mx: c * sx - sn * sy, mz: -sn * sx - c * sy, mag: Math.min(1, m) };
  }

  // snap = { sx, sy, bits, dx, dy }: stick x/y in -1..1 (y up), button bits, camera drag in CSS px since the last step.
  function step(s, snap) {
    const w = s.w;
    const bits = snap.bits | 0;
    const pressed = bits & ~s.prevBits;
    const it = intent(s, snap), mx = it.mx, mz = it.mz, mag = it.mag;
    const ml = Math.hypot(mx, mz) || 1, ix = mx / ml, iz = mz / ml;

    s.px = s.x; s.py = s.y; s.pz = s.z; s.pyaw = s.yaw;
    s.ptx = s.tx; s.pty = s.ty; s.ptz = s.tz; s.pcx = s.cx; s.pcy = s.cy; s.pcz = s.cz;
    const wasGrounded = s.grounded;

    // wall-run: start, keep or end
    if (s.wallRun > 0) {
      if (s.grounded || !wallProbe(s, w, s.wnx, s.wnz)) { s.wallRun = 0; s.wallRunUsed = true; }
    } else if (!s.grounded && !s.wallRunUsed && s.dash === 0 && s.step - s.wcStep <= 2 && mag > 0.1 && ix * -s.wnx + iz * -s.wnz > 0.2) {
      let tx = -s.wnz, tz = s.wnx; const vt = tx * s.vx + tz * s.vz;
      if (Math.abs(vt) >= 3) {
        if (vt < 0) { tx = -tx; tz = -tz; }
        s.wallRun = T.wallSteps; s.wtx = tx; s.wtz = tz; s.wallRuns++; s.evWallRun = s.step; s.vy = 0;
      }
    }

    // dash
    if ((pressed & B.DSH) && s.dash === 0 && (s.grounded || !s.dashUsed)) {
      s.dash = T.dashSteps; s.dashUsed = !s.grounded; s.dashes++; s.wallRun = 0;
      if (mag > 0.1) { s.ddx = ix; s.ddz = iz; s.yaw = Math.atan2(ix, iz); } else { s.ddx = Math.sin(s.yaw); s.ddz = Math.cos(s.yaw); }
      if (!s.grounded) { s.vy = 0; s.evAirDash = s.step; } else s.evDash = s.step;
    }

    // jump with buffer and coyote time; a jump during a wall-run kicks off the wall
    if (pressed & B.JMP) s.jbuf = T.jumpBuf;
    if (s.jbuf > 0) {
      if (s.wallRun > 0) {
        s.vx = s.wnx * T.kickOut + s.wtx * 3; s.vz = s.wnz * T.kickOut + s.wtz * 3; s.vy = T.kickUp;
        s.wallRun = 0; s.wallRunUsed = true; s.lockH = T.kickLock; s.jbuf = 0; s.kicks++; s.evKick = s.step; s.holdOK = false;
        s.yaw = Math.atan2(s.vx, s.vz);
      } else if (s.grounded || (s.coyote > 0 && s.vy <= 0.01)) {
        s.vy = T.jumpV; s.grounded = false; s.coyote = 0; s.jbuf = 0; s.jumps++; s.holdOK = true; s.evJump = s.step;
      } else if (s.airJumps > 0) {
        s.vy = T.djumpV; s.airJumps--; s.jbuf = 0; s.jumps++; s.djumps++; s.holdOK = false; s.evDJump = s.step;
      } else s.jbuf--;
    }

    // horizontal velocity
    if (s.dash > 0) {
      s.vx = s.ddx * T.dashSpeed; s.vz = s.ddz * T.dashSpeed; s.dash--;
      if (s.dash === 0) { s.vx = s.ddx * T.runSpeed; s.vz = s.ddz * T.runSpeed; }
    } else if (s.wallRun > 0) {
      s.vx = s.wtx * T.wallSpeed - s.wnx * T.wallStick; s.vz = s.wtz * T.wallSpeed - s.wnz * T.wallStick;
      s.yaw = Math.atan2(s.wtx, s.wtz); s.wallRun--; s.wallRunSteps++;
      if (s.wallRun === 0) s.wallRunUsed = true;
    } else if (s.lockH > 0) s.lockH--;
    else {
      const a = (s.grounded ? T.accelG : T.accelA) * STEP;
      const tx = mx * mag / ml * T.runSpeed, tz = mz * mag / ml * T.runSpeed;
      const ex = tx - s.vx, ez = tz - s.vz, el = Math.hypot(ex, ez);
      if (el <= a) { s.vx = tx; s.vz = tz; } else { s.vx += ex / el * a; s.vz += ez / el * a; }
      if (mag > 0.1) s.yaw = wrapPi(s.yaw + wrapPi(Math.atan2(mx, mz) - s.yaw) * Math.min(1, 15 * STEP));
    }

    // vertical: velocity-Verlet so the apex matches v = sqrt(2gh); holding Jump after a ground jump lowers gravity
    let dy;
    if (s.wallRun > 0) { s.vy = -T.wallSink; dy = s.vy * STEP; }
    else if (s.dash > 0 && !s.grounded) { s.vy = 0; dy = 0; }
    else if (!s.grounded) {
      let g = T.gravity; if (s.holdOK && (bits & B.JMP) && s.vy > 0) g *= T.holdMul;
      const vy0 = s.vy; s.vy -= g * STEP; if (s.vy < -T.terminal) s.vy = -T.terminal;
      dy = vy0 * STEP - 0.5 * g * STEP * STEP;
    } else dy = s.vy * STEP;

    collideMove(s, w, s.vx * STEP, dy, s.vz * STEP);

    // ground and wall events
    if (s.grounded) {
      if (!wasGrounded) { s.landV = s.vy; if (s.vy < -3) s.evLand = s.step; s.wallRun = 0; }
      if (s.vy < 0) s.vy = 0;
      s.coyote = T.coyote; s.airJumps = 1; s.dashUsed = false; s.wallRunUsed = false; s.holdOK = false;
    } else if (s.coyote > 0) s.coyote--;
    if (s.wallHit && !s.grounded) { s.dashUsed = false; s.wcStep = s.step; }
    if (s.y > s.maxApex) s.maxApex = s.y;
    if (s.y < T.killY) respawn(s);

    // checkpoints, gaps and finish
    for (let i = s.cp; i < w.cps.length; i++) {
      const c = w.cps[i];
      if (s.grounded && Math.abs(s.x - c.x) < c.r && Math.abs(s.z - c.z) < 4 && Math.abs(s.y - c.y) < 1.5) s.cp = i + 1;
    }
    if (s.grounded) {
      for (let i = 0; i < w.gaps.length; i++) {
        const g = w.gaps[i];
        if (s.x < g.x0 - 0.2) s.gapNear[i] = true;
        else if (s.gapNear[i] && !s.gapDone[i] && s.x > g.x1 + 0.2) s.gapDone[i] = s.step + 1;
      }
      if (!s.finishStep && s.x >= w.finishX) s.finishStep = s.step + 1;
    }

    // attack, earth, lock
    if (pressed & B.ATK) { s.atk = T.atkFrames; s.attacks++; }
    else if (s.atk > 0) s.atk--;
    if (pressed & B.EAR) { s.earthDown = true; s.earthHold = 0; }
    if (bits & B.EAR) { if (s.earthDown) s.earthHold++; }
    else if (s.earthDown) {
      s.earthDown = false; s.lastEarthHold = s.earthHold;
      if (s.earthHold < T.earthHold) s.needles++; else s.boulders++;
    }
    if (pressed & B.LCK) s.lock = !s.lock;
    s.prevBits = bits;

    // camera: drag, idle return, spring follow, then wall collision
    const ddx = snap.dx || 0, ddy = snap.dy || 0;
    if (ddx !== 0 || ddy !== 0) {
      s.yawOff = clamp(s.yawOff + ddx * T.camDragDeg, -T.camYawMax, T.camYawMax);
      s.pitch = clamp(s.pitch - ddy * T.camDragDeg, T.camPitchMin, T.camPitchMax);
      s.idle = 0;
    } else if (++s.idle > T.camIdleSteps) {
      const k = Math.min(1, 4 * STEP);
      s.yawOff -= s.yawOff * k; s.pitch += (T.camPitchBase - s.pitch) * k;
    }
    const lk = Math.min(1, 3 * STEP);
    s.lx += (Math.sin(s.yaw) * mag * T.camLead - s.lx) * lk;
    s.lz += (Math.cos(s.yaw) * mag * T.camLead - s.lz) * lk;
    const wn = 4 / T.camSettle;
    const tx = s.x + s.lx, ty = s.y + 1.2, tz = s.z + s.lz;
    s.tvx += (wn * wn * (tx - s.tx) - 2 * wn * s.tvx) * STEP; s.tx += s.tvx * STEP;
    s.tvy += (wn * wn * (ty - s.ty) - 2 * wn * s.tvy) * STEP; s.ty += s.tvy * STEP;
    s.tvz += (wn * wn * (tz - s.tz) - 2 * wn * s.tvz) * STEP; s.tz += s.tvz * STEP;
    camCollide(s, w);
    updateCamPos(s);
    const cd = boxDist(w, s.cx, s.cy, s.cz);
    if (cd < s.camMin) s.camMin = cd;
    if (cd < 0.2) s.camClip++;

    s.step++;
    if (!isFinite(s.x + s.y + s.z + s.vx + s.vy + s.vz + s.cx + s.cy + s.cz)) s.nan = true;
  }

  function hash(s) {
    return [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.yaw, s.cx, s.cy, s.cz].map(v => v.toFixed(5)).join(',') +
      '|' + [s.step, s.needles, s.boulders, s.jumps, s.dashes, s.attacks, s.respawns, s.lock ? 1 : 0, s.cp, s.kicks, s.wallRuns, s.finishStep].join(',') +
      '|' + s.gapDone.join('.');
  }

  /* ---------- worlds ---------- */
  const SPAWN = { x: 0, y: 0, z: 0, yaw: Math.PI / 2 };
  // Course widths (m). Single-jump gaps follow the Level Design Doc. The others follow the measured reach (see measure()).
  const CW = { g1: 3, g2: 4, g3: 7, g4: 8, g5: 10.5, g6: 11.5, pit: 9.5 };
  function courseDef() {
    const boxes = [], gaps = [], cps = [];
    const plat = (x0, x1, top, tag) => boxes.push([x0, x1, top - 10, top, -2, 2, tag || 'plat']);
    boxes.push([-12, 12, -10, 0, -10, 10, 'yard']);
    let x = 12;
    const gap = (id, w, tech) => { gaps.push({ id, x0: x, x1: x + w, tech }); x += w; };
    const land = (len, top, cp) => { plat(x, x + len, top); if (cp) cps.push({ x: x + len / 2, y: top, z: 0, r: len / 2, yaw: Math.PI / 2 }); x += len; };
    gap('G1', CW.g1, 'single'); land(7, 0);
    gap('G2', CW.g2, 'single'); land(7, 0);
    gap('G3', CW.g3, 'double'); land(7, 0, true);
    gap('G4', CW.g4, 'double'); land(7, 0);
    const camWall0 = x;
    gap('G5', CW.g5, 'dash'); land(7, 0, true);
    gap('G6', CW.g6, 'dash'); land(7.5, 0);
    boxes.push([camWall0, x, -2, 9, 3.4, 4.4, 'camwall']);
    const pit0 = x;
    gap('WALL', CW.pit, 'wall'); boxes.push([pit0 + 1.5, pit0 + 7.5, -3, 6, -3.2, -2.2, 'wall']);
    land(8, 0, true);
    // step-ups: 2.0 m for a single jump, then 3.6 m for jump plus double jump
    gaps.push({ id: 'S1', x0: x, x1: x, tech: 'step1', jx: x - 2.9 }); plat(x, x + 12, 2.0); x += 12;
    gaps.push({ id: 'S2', x0: x, x1: x, tech: 'step2', jx: x - 5.4 }); plat(x, x + 6, 5.6); cps.push({ x: x + 3, y: 5.6, z: 0, r: 3, yaw: Math.PI / 2 }); x += 6;
    // heightfield descent with a steep ridge, 30 m long
    const hx0 = x, nx = 60, nz = 16, cell = 0.5, h = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const t = i / nx, sm = t * t * (3 - 2 * t); let v = 5.6 * (1 - sm);
      const dx = (i * cell) - 15; if (Math.abs(dx) < 2.4) v += 1.0 * (1 + Math.cos(Math.PI * dx / 2.4)) / 2;
      h[j * (nx + 1) + i] = v;
    }
    const hf = { x0: hx0, z0: -4, cell, nx, nz, h };
    x += 30;
    plat(x, x + 10, 0, 'finish');
    const finishX = x + 2;
    return { name: 'course', boxes, gaps, cps, hf, finishX, spawn: SPAWN, length: x + 10 };
  }
  const worlds = {};
  function getWorld(name) {
    if (!worlds[name]) {
      if (name === 'course') worlds[name] = makeWorld(courseDef());
      else worlds[name] = makeWorld({ name: 'field', boxes: [[-100, 100, -10, 0, -100, 100, 'ground']], spawn: SPAWN });
    }
    return worlds[name];
  }
  function rebuildWorld(name) { delete worlds[name]; return getWorld(name); }

  /* ---------- scripted input ---------- */
  function pulse(p, a, n) { return p >= a && p < a + n; }
  // M0 scripted input for the bot runner: a pure function of the step index. Runs in the field world.
  function scripted(i, out, s) {
    const p = i % 720;
    let sx = 0, sy = 0, bits = 0, dx = 0, dy = 0;
    if (p < 240) sx = 1; else if (p < 360) { sx = 0.6; sy = 0.6; } else if (p < 480) sx = -1;
    else if (p < 600) sy = -0.8; else { sx = 0.5; sy = 0.5; }
    if (pulse(p, 40, 4) || pulse(p, 100, 2) || pulse(p, 500, 3)) bits |= B.JMP;
    if (pulse(p, 150, 2) || pulse(p, 520, 2)) bits |= B.DSH;
    if (pulse(p, 200, 3)) bits |= B.ATK;
    if (pulse(p, 250, 6) || pulse(p, 300, 30)) bits |= B.EAR;
    if (pulse(p, 400, 2)) bits |= B.LCK;
    if (pulse(p, 60, 30)) { dx = 6; dy = 1; }
    if (s && Math.hypot(s.x, s.z) > 35) {
      const n = Math.hypot(s.x, s.z), mx = -s.x / n, mz = -s.z / n;
      const yw = s.yawOff * Math.PI / 180, c = Math.cos(yw), sn = Math.sin(yw);
      sx = c * mx - sn * mz; sy = -sn * mx - c * mz;
    }
    out = out || {};
    out.sx = sx; out.sy = sy; out.bits = bits; out.dx = dx; out.dy = dy;
    return out;
  }
  function runScripted(n) {
    const s = create('field'), snap = {};
    for (let i = 0; i < n; i++) step(s, scripted(i, snap, s));
    return { hash: hash(s), nan: s.nan, respawns: s.respawns, s };
  }

  // Technique driver: tap-only jumps, aimed at the next obstacle. Pure function of the sim state.
  function drive(s, out, g) {
    out.sx = 1; out.sy = 0; out.bits = 0; out.dx = 0; out.dy = 0;
    const jx = g.jx !== undefined ? g.jx : g.x0 + 0.05, t = g.tech;
    if (s.grounded) {
      out.sy = clamp(s.z * 0.8, -1, 1) * 0.6;
      if (s.x >= jx && s.x < jx + 3) out.bits |= B.JMP;
      return out;
    }
    if (t === 'wall') { if (s.wallRun > 0 || !s.wallRunUsed) out.sy = 0.6; }
    if (s.coyote > 0 && s.vy <= 0.01 && s.x >= jx) { out.bits |= B.JMP; return out; }
    if (t === 'single' || t === 'step1') return out;
    if (t === 'wall') {
      if (s.wallRunUsed && s.wallRun === 0 && s.airJumps > 0 && s.vy < -1) out.bits |= B.JMP;
      return out;
    }
    if (s.airJumps > 0 && s.vy <= 0 && s.coyote === 0 && s.wallRun === 0) { out.bits |= B.JMP; return out; }
    if (t === 'dash' && s.airJumps === 0 && s.vy <= 0 && !s.dashUsed && s.dash === 0) out.bits |= B.DSH;
    return out;
  }
  function pilot(s, out) {
    const w = s.w; let g = null;
    for (let i = 0; i < w.gaps.length; i++) if (!s.gapDone[i]) { g = w.gaps[i]; break; }
    if (!g) { out.sx = 1; out.sy = clamp(s.z * 0.8, -1, 1) * 0.6; out.bits = 0; out.dx = out.dy = 0; return out; }
    return drive(s, out, g);
  }
  // Runs the pilot over the whole course with no rendering. Returns the recorded snapshot list and the end state.
  function runPilot(maxSteps) {
    const s = create('course'), snap = {}, rec = [];
    for (let i = 0; i < maxSteps && !s.finishStep; i++) {
      pilot(s, snap); rec.push({ sx: snap.sx, sy: snap.sy, bits: snap.bits, dx: snap.dx, dy: snap.dy });
      step(s, snap);
    }
    return { rec, hash: hash(s), s };
  }
  function replayList(world, list) {
    const s = create(world);
    for (let i = 0; i < list.length; i++) step(s, list[i]);
    return { hash: hash(s), s };
  }

  /* ---------- measurement (headless, uses the real step) ---------- */
  function synthWorld(boxes) { return makeWorld({ name: 'synth', boxes, spawn: SPAWN }); }
  function synthState(w, x, y) {
    const s = { world: 'synth' }; worlds.synth = w; reset(s, 'synth'); s.x = s.px = x; s.y = s.py = y || 0; snapCam(s); return s;
  }
  // success when Storm ends grounded past the far edge
  function tryGap(tech, W, hold) {
    const w = synthWorld([[-80, 0, -10, 0, -3, 3], [W, W + 40, -10, 0, -3, 3]]);
    const s = synthState(w, -14, 0), out = {}, g = { tech, jx: 0.05 };
    for (let i = 0; i < 260; i++) {
      drive(s, out, g); out.sx = 1; out.sy = 0; if (hold && s.vy > 0) out.bits |= B.JMP;
      step(s, out);
      if (s.y < -3) return false;
      if (s.grounded && s.x > W + 0.5) return true;
    }
    return false;
  }
  function reach(tech, hold) {
    let last = 0;
    for (let W = 2; W < 24; W += 0.05) { if (tryGap(tech, W, hold)) last = W; else if (W > last + 0.5) break; }
    return Math.round(last * 100) / 100;
  }
  function tryStep(tech, h, d) {
    const w = synthWorld([[-80, 0, -10, 0, -3, 3], [0, 40, -10, h, -3, 3]]);
    const s = synthState(w, -14, 0), out = {}, g = { tech, jx: -d };
    for (let i = 0; i < 200; i++) {
      drive(s, out, g); out.sx = 1; out.sy = 0; step(s, out);
      if (s.y < -3) return false;
      if (s.grounded && s.x > 0.5 && Math.abs(s.y - h) < 0.01) return true;
    }
    return false;
  }
  function stepReach(tech) {
    let best = 0;
    for (let h = 0.5; h < 6; h += 0.05) { let ok = false; for (let d = 1; d < 9 && !ok; d += 0.1) ok = tryStep(tech, h, d); if (ok) best = h; else if (h > best + 0.5) break; }
    return Math.round(best * 100) / 100;
  }
  // Flat-ground arc of the first jump: apex, time to apex, air time and run distance.
  function arc(hold) {
    const w = synthWorld([[-80, 80, -10, 0, -3, 3]]);
    const s = synthState(w, 0, 0), out = { sx: 1, sy: 0, bits: 0, dx: 0, dy: 0 };
    for (let i = 0; i < 20; i++) { out.bits = 0; step(s, out); }
    const x0 = s.x; let apex = 0, tApex = 0, n = 0, started = false;
    for (let i = 0; i < 200; i++) {
      out.bits = (!started ? B.JMP : 0) | (hold && started && s.vy > 0 ? B.JMP : 0); started = true;
      step(s, out); n++;
      if (s.y > apex) { apex = s.y; tApex = n; }
      if (s.grounded && n > 3) break;
    }
    return { apex: Math.round(apex * 1000) / 1000, tApex: Math.round(tApex / 60 * 1000) / 1000, air: Math.round(n / 60 * 1000) / 1000, dist: Math.round((s.x - x0) * 100) / 100 };
  }
  function wallRunDistance() {
    const w = synthWorld([[-20, 0, -10, 0, -3, 3], [0.5, 60, -3, 8, -3.2, -2.2]]);
    const s = synthState(w, -6, 0), out = {}, g = { tech: 'wall', jx: 0.05 };
    let x0 = null, x1 = null, st = 0;
    for (let i = 0; i < 200; i++) {
      drive(s, out, g); step(s, out);
      if (s.wallRun > 0) { if (x0 === null) x0 = s.x; x1 = s.x; st++; }
    }
    return { steps: s.wallRunSteps, dist: x0 === null ? 0 : Math.round((x1 - x0) * 100) / 100, started: s.wallRuns };
  }
  function measure() {
    const m = {
      arcTap: arc(false), arcHold: arc(true),
      single: reach('single', false), singleHold: reach('single', true), double: reach('double', false), dash: reach('dash', false),
      step1: stepReach('step1'), step2: stepReach('step2'), wall: wallRunDistance()
    };
    const need = [['G1', m.single], ['G2', m.single], ['G3', m.double], ['G4', m.double], ['G5', m.dash], ['G6', m.dash]];
    m.rows = need.map(([id, r]) => { const g = getWorld('course').gaps.find(q => q.id === id), wd = g.x1 - g.x0; return { id, width: wd, reach: r, margin: Math.round((r - wd) * 100) / 100 }; });
    const wallGap = getWorld('course').gaps.find(q => q.id === 'WALL');
    m.wallLen = (function () { const b = getWorld('course').boxes.find(q => q.tag === 'wall'); return b.x1 - b.x0; })();
    m.wallMargin = Math.round((m.wall.dist - m.wallLen) * 100) / 100;
    m.pass = m.rows.every(r => r.margin >= 1) && m.wall.steps >= T.wallSteps - 2 && m.wallMargin >= 1 && m.step1 >= 2.0 && m.step2 >= 3.6;
    return m;
  }

  return { STEP, T, B, SPAWN, CW, create, reset, step, hash, scripted, runScripted, pilot, drive, runPilot, replayList, measure, getWorld, rebuildWorld, wrapPi, boxDist, snapCam };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
