// Wheel-gesture traces: the old idle-lock logic vs. the new gesture classifier, on the same event streams.
// Traces model macOS trackpads (finger phase, then decaying momentum at ~60 Hz; touching the pad again
// cancels momentum) and notched mouse wheels. These are models, not recordings: physical-trackpad logs
// from the spatial view (/?debug=input → Copy log) can be pasted into ./wheel-recorded/*.json and replayed here.
// Usage: node scripts/wheel-traces.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { transformSync } from 'esbuild';

const src = readFileSync(new URL('../src/scripts/wheel-gestures.ts', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(transformSync(src, { loader: 'ts', format: 'esm' }).code).toString('base64'));

import { DT, swipe, seq, notches } from './wheel-models.mjs';
const slowDrag = (dir) => Array.from({ length: 26 }, (_, k) => [k * DT + 10, dir * (2 + (k % 3))]);
const jitteryMomentum = () => { const s = swipe(0, 1, {}).ev; return s.map(([t, d], k) => (k > 20 && k % 9 === 0 ? [t, -1] : [t, d])); };

const SCENARIOS = [
  ['fast forward ×3 (each swipe interrupts the last one’s momentum)', seq([{ dir: 1, cutAfterMs: 220 }, { dir: 1, cutAfterMs: 220 }, { dir: 1 }]), +3],
  ['fast forward ×4, very quick', seq([{ dir: 1, cutAfterMs: 120 }, { dir: 1, cutAfterMs: 120 }, { dir: 1, cutAfterMs: 120 }, { dir: 1 }]), +4],
  ['fast backward ×3', seq([{ dir: -1, cutAfterMs: 220 }, { dir: -1, cutAfterMs: 220 }, { dir: -1 }]), -3],
  ['alternating + − + −', seq([{ dir: 1, cutAfterMs: 200 }, { dir: -1, cutAfterMs: 200 }, { dir: 1, cutAfterMs: 200 }, { dir: -1 }]), 0, [1, -1, 1, -1]],
  ['one swipe, abrupt stop (fingers rest, momentum cut at 100 ms)', seq([{ dir: 1, cutAfterMs: 100 }]), +1],
  ['one fast swipe with a long momentum tail', seq([{ dir: 1, peak: 110, decay: 0.955 }]), +1],
  ['momentum with −1 jitter in its tail', jitteryMomentum(), +1],
  ['slow deliberate drag (tiny deltas)', slowDrag(1), +1],
  ['two swipes with a clear pause', seq([{ dir: 1 }, { pause: 400 }, { dir: 1 }]), +2],
  ['mouse wheel: 4 notches 250 ms apart', notches(4, 250), +4],
  ['mouse wheel: 5 notches spun fast (30 ms apart)', notches(5, 30), +1],
];

/* ---------- The previous logic, ported faithfully (220 ms idle lock, 50 px threshold) ---------- */
function oldLogic(events) {
  let acc = 0, locked = false, lastT = -Infinity; const steps = [], decisions = [];
  for (const [t, d] of events) {
    if (t - lastT >= 220) { locked = false; acc = 0; } // the idle timer fired during the gap
    lastT = t;
    if (locked) { decisions.push('ignore: locked (lock only releases after 220 ms of silence)'); continue; }
    acc += d;
    if (Math.abs(acc) >= 50) { locked = true; steps.push(Math.sign(acc)); decisions.push('step'); acc = 0; } else decisions.push('ignore: accumulating');
  }
  return { steps, decisions };
}
function newLogic(events) {
  const g = mod.createWheelGestures(); const steps = [], decisions = [];
  for (const [t, d] of events) { const r = g.classify(t, d); decisions.push(r); if (r.action === 'step') steps.push(r.dir); }
  return { steps, decisions };
}

/* ---------- Run ---------- */
const N = 9, START = 4; // away from both ends, so boundaries cannot mask behaviour
const land = (steps) => steps.reduce((a, s) => Math.max(0, Math.min(N - 1, a + s)), START) - START;
let pass = 0, total = 0;
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log(pad('scenario', 62), pad('events', 7), pad('expected', 10), pad('old', 18), 'new');
for (const [name, events, expectNet, expectSeq] of SCENARIOS) {
  const o = oldLogic(events), n = newLogic(events);
  const ok = expectSeq ? JSON.stringify(n.steps) === JSON.stringify(expectSeq) : land(n.steps) === expectNet && n.steps.length === Math.abs(expectNet);
  total++; if (ok) pass++;
  const fmt = (st) => `${st.length} step${st.length === 1 ? '' : 's'} [${st.map((s) => (s > 0 ? '+' : '−')).join('')}]`;
  console.log(pad(name, 62), pad(String(events.length), 7), pad(expectSeq ? expectSeq.map((s) => (s > 0 ? '+' : '−')).join('') : (expectNet > 0 ? '+' : '') + expectNet, 10), pad(fmt(o.steps), 18), fmt(n.steps), ok ? '' : '  ← MISMATCH');
}
// Why the old logic discarded input in the first scenario:
const why = oldLogic(SCENARIOS[0][1]).decisions.reduce((m, d) => (m[d] = (m[d] || 0) + 1, m), {});
console.log('\nold logic, fast forward ×3 — decisions:', JSON.stringify(why));
const whyNew = newLogic(SCENARIOS[0][1]).decisions.reduce((m, d) => { const k = d.action + ': ' + d.reason.replace(/#\d+/, '#n').replace(/\d+\/24px/, 'n/24px'); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log('new logic, fast forward ×3 — decisions:', JSON.stringify(whyNew, null, 1));

// Recorded physical-trackpad logs, when available.
const dir = new URL('./wheel-recorded/', import.meta.url);
if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const rec = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const events = rec.filter((r) => r.kind === 'wheel').map((r) => [r.t, r.d]);
  console.log(`\nrecorded ${f}: ${events.length} wheel events → old ${oldLogic(events).steps.length} steps, new ${newLogic(events).steps.length} steps`);
}
console.log(`\n${pass}/${total} modelled scenarios behave as intended with the new logic`);
process.exit(pass === total ? 0 : 1);
