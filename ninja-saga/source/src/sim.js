/* ===== SIM: fixed-step simulation core (no DOM, no Three.js). Deterministic for a given snapshot list. ===== */
const Sim = (function () {
  'use strict';
  const STEP = 1 / 60;
  const DEG = Math.PI / 180;
  // Tuning table. Starting values come from the Technical Spec; M1 and M2 replace them with measured values.
  const T = {
    gravity: 28, terminal: 30, jumpV: 11.1, djumpV: 9.5, runSpeed: 7,
    accelG: 12, accelA: 6, dashSteps: 12, dashSpeed: 20, jumpBuf: 6, coyote: 6,
    earthHold: 15, atkFrames: 18, killY: -20, groundHalf: 100,
    camDist: 9, camSettle: 0.2, camYawMax: 40, camPitchMin: 5, camPitchMax: 35,
    camPitchBase: 15, camDragDeg: 0.25, camIdleSteps: 120, camLead: 1.5
  };
  const B = { ATK: 1, JMP: 2, DSH: 4, EAR: 8, LCK: 16 };
  const SPAWN = { x: 0, y: 0, z: 0, yaw: Math.PI / 2 };

  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function reset(s) {
    s.step = 0;
    s.x = SPAWN.x; s.y = SPAWN.y; s.z = SPAWN.z; s.px = s.x; s.py = s.y; s.pz = s.z;
    s.vx = 0; s.vy = 0; s.vz = 0;
    s.yaw = SPAWN.yaw; s.pyaw = s.yaw;
    s.grounded = true; s.coyote = T.coyote; s.jbuf = 0; s.airJumps = 1;
    s.dash = 0; s.dashUsed = false; s.ddx = 0; s.ddz = 0;
    s.atk = 0; s.earthDown = false; s.earthHold = 0; s.lastEarthHold = 0;
    s.lock = false; s.prevBits = 0;
    s.needles = 0; s.boulders = 0; s.jumps = 0; s.dashes = 0; s.attacks = 0; s.respawns = 0;
    s.nan = false;
    // camera
    s.yawOff = 0; s.pitch = T.camPitchBase; s.idle = 0; s.lx = 0; s.lz = 0;
    s.tx = s.x; s.ty = s.y + 1.2; s.tz = s.z; s.tvx = 0; s.tvy = 0; s.tvz = 0;
    s.ptx = s.tx; s.pty = s.ty; s.ptz = s.tz;
    updateCamPos(s); s.pcx = s.cx; s.pcy = s.cy; s.pcz = s.cz;
    return s;
  }

  function create() { return reset({}); }

  function updateCamPos(s) {
    const yaw = s.yawOff * DEG, pit = s.pitch * DEG;
    s.cx = s.tx + T.camDist * Math.sin(yaw) * Math.cos(pit);
    s.cy = s.ty + T.camDist * Math.sin(pit);
    s.cz = s.tz + T.camDist * Math.cos(yaw) * Math.cos(pit);
  }

  function respawn(s) {
    s.x = SPAWN.x; s.y = SPAWN.y; s.z = SPAWN.z; s.px = s.x; s.py = s.y; s.pz = s.z;
    s.vx = s.vy = s.vz = 0; s.grounded = true; s.dash = 0; s.respawns++;
  }

  // snap = { sx, sy, bits, dx, dy }: stick x/y in -1..1 (y up), button bits, camera drag in CSS px since the last step.
  function step(s, snap) {
    const bits = snap.bits | 0;
    const pressed = bits & ~s.prevBits;
    const camYaw = s.yawOff * DEG;

    s.px = s.x; s.py = s.y; s.pz = s.z; s.pyaw = s.yaw;
    s.ptx = s.tx; s.pty = s.ty; s.ptz = s.tz; s.pcx = s.cx; s.pcy = s.cy; s.pcz = s.cz;

    // movement intent, relative to the camera yaw
    const c = Math.cos(camYaw), sn = Math.sin(camYaw);
    const mx = c * snap.sx - sn * snap.sy;
    const mz = -sn * snap.sx - c * snap.sy;
    const mag = Math.min(1, Math.hypot(snap.sx, snap.sy));

    const acc = Math.min(1, (s.grounded ? T.accelG : T.accelA) * STEP);
    s.vx += (mx * T.runSpeed - s.vx) * acc;
    s.vz += (mz * T.runSpeed - s.vz) * acc;
    if (mag > 0.1) {
      const target = Math.atan2(mx, mz);
      s.yaw = wrapPi(s.yaw + wrapPi(target - s.yaw) * Math.min(1, 15 * STEP));
    }

    // dash
    if ((pressed & B.DSH) && s.dash === 0 && (s.grounded || !s.dashUsed)) {
      s.dash = T.dashSteps; s.dashUsed = !s.grounded; s.dashes++;
      s.ddx = Math.sin(s.yaw); s.ddz = Math.cos(s.yaw);
      if (!s.grounded) s.vy = 0;
    }
    if (s.dash > 0) { s.vx = s.ddx * T.dashSpeed; s.vz = s.ddz * T.dashSpeed; s.dash--; }

    // jump with buffer and coyote time
    if (pressed & B.JMP) s.jbuf = T.jumpBuf;
    if (s.jbuf > 0) {
      if (s.grounded || s.coyote > 0) { s.vy = T.jumpV; s.grounded = false; s.coyote = 0; s.jbuf = 0; s.jumps++; }
      else if (s.airJumps > 0) { s.vy = T.djumpV; s.airJumps--; s.jbuf = 0; s.jumps++; }
      else s.jbuf--;
    }

    // gravity and integration
    // velocity-Verlet so the peak matches v = sqrt(2gh) from the Technical Spec
    const vy0 = s.vy;
    if (!s.grounded && s.dash === 0) {
      s.vy -= T.gravity * STEP; if (s.vy < -T.terminal) s.vy = -T.terminal;
      s.y += vy0 * STEP - 0.5 * T.gravity * STEP * STEP;
    } else s.y += s.vy * STEP;
    s.x += s.vx * STEP; s.z += s.vz * STEP;
    const onGround = Math.abs(s.x) <= T.groundHalf && Math.abs(s.z) <= T.groundHalf;
    if (onGround && s.y <= 0 && s.vy <= 0) {
      s.y = 0; s.vy = 0; s.grounded = true; s.coyote = T.coyote; s.airJumps = 1; s.dashUsed = false;
    } else {
      s.grounded = false;
      if (s.coyote > 0) s.coyote--;
    }
    if (s.y < T.killY) respawn(s);

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

    // camera: drag, idle return, spring follow
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
    const w = 4 / T.camSettle;
    const tx = s.x + s.lx, ty = s.y + 1.2, tz = s.z + s.lz;
    s.tvx += (w * w * (tx - s.tx) - 2 * w * s.tvx) * STEP; s.tx += s.tvx * STEP;
    s.tvy += (w * w * (ty - s.ty) - 2 * w * s.tvy) * STEP; s.ty += s.tvy * STEP;
    s.tvz += (w * w * (tz - s.tz) - 2 * w * s.tvz) * STEP; s.tz += s.tvz * STEP;
    updateCamPos(s);

    s.step++;
    if (!isFinite(s.x + s.y + s.z + s.vx + s.vy + s.vz + s.cx + s.cy + s.cz)) s.nan = true;
  }

  function hash(s) {
    return [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.yaw, s.cx, s.cy, s.cz].map(v => v.toFixed(5)).join(',') +
      '|' + [s.step, s.needles, s.boulders, s.jumps, s.dashes, s.attacks, s.respawns, s.lock ? 1 : 0].join(',');
  }

  function pulse(p, a, n) { return p >= a && p < a + n; }
  // Scripted input for the bot runner: a pure function of the step index.
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
      // steer home, converting the world direction back into a stick vector for the current camera yaw
      const n = Math.hypot(s.x, s.z), mx = -s.x / n, mz = -s.z / n;
      const yw = s.yawOff * Math.PI / 180, c = Math.cos(yw), sn = Math.sin(yw);
      sx = c * mx - sn * mz; sy = -sn * mx - c * mz;
    }
    out = out || {};
    out.sx = sx; out.sy = sy; out.bits = bits; out.dx = dx; out.dy = dy;
    return out;
  }

  // Runs n steps with no rendering and returns the final hash. Used to check live runs against a headless run.
  function runScripted(n) {
    const s = create(), snap = {};
    for (let i = 0; i < n; i++) step(s, scripted(i, snap, s));
    return { hash: hash(s), nan: s.nan, respawns: s.respawns, s };
  }

  return { STEP, T, B, SPAWN, create, reset, step, hash, scripted, runScripted, wrapPi };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
