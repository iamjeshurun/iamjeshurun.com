// Modelled wheel streams (shared by wheel-traces.mjs and the browser checks). macOS trackpad: a finger
// phase ramping up at ~60 Hz, then exponentially decaying momentum; touching the pad cancels momentum.
export const DT = 16;
export function swipe(t, dir, { peak = 70, fingerFrames = 7, momentum = true, cutAfterMs = Infinity, decay = 0.935 } = {}) {
  const ev = [];
  for (let k = 1; k <= fingerFrames; k++) ev.push([t += DT, dir * Math.round(peak * Math.pow(k / fingerFrames, 1.3))]);
  if (momentum) { let v = peak * 0.9; const m0 = t; while (v >= 1 && t - m0 < cutAfterMs) { ev.push([t += DT, dir * Math.round(v)]); v *= decay; } }
  return { ev, end: t };
}
export function seq(parts, t0 = 0) {
  let t = t0; const all = [];
  for (const p of parts) { if (p.pause) { t += p.pause; continue; } const s = swipe(t, p.dir, p); all.push(...s.ev); t = s.end + (p.gapAfter ?? 24); }
  return all;
}
export const notches = (n, gapMs, dir = 1, size = 100) => Array.from({ length: n }, (_, k) => [k * gapMs + 10, dir * size]);
