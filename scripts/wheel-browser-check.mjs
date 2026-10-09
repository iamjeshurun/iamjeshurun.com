// Replays modelled trackpad/mouse wheel streams into the Spatial view at real time, in a real browser.
// Usage: node scripts/wheel-browser-check.mjs --browser=chromium|webkit|safari   (needs `npm run preview`)
// These are modelled streams dispatched as WheelEvents; they complement, not replace, physical-trackpad testing.
import { chromium, webkit } from 'playwright-core';
import { spawn } from 'node:child_process';
import { seq, notches } from './wheel-models.mjs';

const LAB = (process.env.BASE_URL || 'http://127.0.0.1:4321') + '/';
const engine = (process.argv.find((a) => a.startsWith('--browser=')) || '--browser=chromium').split('=')[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fast = (dir, n, cut = 200) => seq(Array.from({ length: n }, (_, k) => (k < n - 1 ? { dir, cutAfterMs: cut } : { dir })));
const SCENARIOS = [
  // name, start index (0 = 01), events, expected step directions, expected final index, expected boundary hits (min)
  ['fast forward ×3 from 01', 0, fast(1, 3), [1, 1, 1], 3, 0],
  ['fast backward ×3 from 04', 3, fast(-1, 3), [-1, -1, -1], 0, 0],
  ['fast forward ×2 from 02 (middle)', 1, fast(1, 2), [1, 1], 3, 0],
  ['fast backward ×2 from 03 (middle)', 2, fast(-1, 2), [-1, -1], 0, 0],
  ['alternating + − + − from 02', 1, seq([{ dir: 1, cutAfterMs: 180 }, { dir: -1, cutAfterMs: 180 }, { dir: 1, cutAfterMs: 180 }, { dir: -1 }]), [1, -1, 1, -1], 1, 0],
  ['one swipe then abrupt stop, from 02', 1, seq([{ dir: 1, cutAfterMs: 90 }]), [1], 2, 0],
  ['one fast swipe, long momentum tail, from 02 (must not skip)', 1, seq([{ dir: 1, peak: 120, decay: 0.958 }]), [1], 2, 0],
  ['very fast forward ×4 from 01 (last one meets the end)', 0, fast(1, 4, 120), [1, 1, 1], 3, 1],
  ['at 04: forward swipes bounce, then a backward swipe works at once', 3, seq([{ dir: 1, cutAfterMs: 150 }, { dir: 1, cutAfterMs: 150 }, { dir: -1 }]), [-1], 2, 2],
  ['mouse wheel: 3 notches 250 ms apart from 01', 0, notches(3, 250), [1, 1, 1], 3, 0],
];

// Runs inside the page: put the view on `start`, replay the stream at real time, report what happened.
const REPLAY = async (events, start) => {
  const waitIdle = (limit = 5000) => new Promise((res) => { const t0 = performance.now(); (function f() { if (window.__spatial.state === 'idle' || performance.now() - t0 > limit) res(performance.now()); else requestAnimationFrame(f); })(); });
  document.querySelector(`.sp-pick[data-i="${start}"]`).click();
  await waitIdle(); await new Promise((r) => setTimeout(r, 250));
  const stage = document.getElementById('sp-stage');
  window.__spatialInput.length = 0; // the log is a capped ring buffer; start each scenario empty
  const from = 0;
  window.__spTrace = [];
  const t0 = performance.now();
  for (const [t, d] of events) {
    const wait = t0 + t - performance.now();
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: d, bubbles: true, cancelable: true }));
  }
  const tEnd = performance.now();
  const tIdle = await waitIdle();
  const log = window.__spatialInput.slice(from).filter((x) => x.kind === 'wheel');
  const steps = log.filter((x) => x.action === 'step');
  const lastStep = steps.length ? steps[steps.length - 1].t : null;
  // Camera continuity: velocity may only change as fast as the acceleration cap allows per step.
  const tr = window.__spTrace; let excess = 0;
  for (let k = 2; k < tr.length; k++) { const [, x2, y2, d2] = tr[k], [, x1, y1, d1] = tr[k - 1], [, x0, y0] = tr[k - 2]; if (!d2 || !d1) continue; excess = Math.max(excess, Math.hypot((x2 - x1) / d2 - (x1 - x0) / d1, (y2 - y1) / d2 - (y1 - y0) / d1) - 14000 * d2); }
  const lastMove = tr.length ? tr[tr.length - 1][0] : tEnd;
  return {
    final: window.__spatial.active, state: window.__spatial.state,
    steps: steps.map((x) => (x.reason.match(/→ 0(\d)/) ? +x.reason.match(/→ 0(\d)/)[1] - 1 : null)),
    boundaries: log.filter((x) => x.action === 'boundary').length,
    ignored: log.filter((x) => x.action === 'ignore').length, events: log.length,
    cameraStillMovingAfterLastEventMs: Math.max(0, Math.round(lastMove - tEnd)),
    settledAfterLastStepMs: lastStep === null ? 0 : Math.round(tIdle - lastStep - (t0 - performance.timeOrigin) * 0),
    excessVelocityChange: Math.round(Math.max(0, excess)),
    durationMs: Math.round(tEnd - t0),
  };
};

/* ---------- Engine adapters ---------- */
let run, close;
if (engine === 'safari') {
  const driver = spawn('safaridriver', ['-p', '4563'], { stdio: 'ignore' }); await sleep(1500);
  const wd = async (m, p, b) => { const j = await (await fetch('http://127.0.0.1:4563' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json(); if (j.value && j.value.error) throw new Error(j.value.message); return j.value; };
  const { sessionId } = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  const S = '/session/' + sessionId;
  await wd('POST', S + '/timeouts', { script: 30000 });
  await wd('POST', S + '/window/rect', { width: 1440, height: 1000 });
  await wd('POST', S + '/url', { url: LAB + '?w=' + Date.now() }); await sleep(1500);
  await wd('POST', S + '/execute/sync', { script: "sessionStorage.clear(); document.getElementById('spatial-launch').click()", args: [] }); await sleep(1500);
  run = (events, start) => wd('POST', S + '/execute/async', { script: `const done = arguments[2]; (${REPLAY})(arguments[0], arguments[1]).then(done, (e) => done({ error: String(e) }));`, args: [events, start] });
  close = async () => { await wd('DELETE', S).catch(() => {}); driver.kill(); };
} else {
  const b = engine === 'webkit' ? await webkit.launch({ headless: false }) : await chromium.launch({ channel: 'chrome', headless: false });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.bringToFront(); await p.goto(LAB, { waitUntil: 'networkidle' }); await sleep(1200);
  await p.click('#spatial-launch'); await sleep(1200);
  run = (events, start) => p.evaluate(([e, s, src]) => new Function(`return (${src})`)()(e, s), [events, start, REPLAY.toString()]);
  close = () => b.close();
}

let pass = 0;
for (const [name, start, events, expectSteps, expectFinal, minBoundary] of SCENARIOS) {
  const r = await run(events, start);
  const expectedIdx = []; let a = start; for (const s of expectSteps) { a += s; expectedIdx.push(a); }
  const ok = !r.error && JSON.stringify(r.steps) === JSON.stringify(expectedIdx) && r.final === expectFinal && r.boundaries >= minBoundary && r.state === 'idle' && r.excessVelocityChange < 400 && r.cameraStillMovingAfterLastEventMs < 1300;
  if (ok) pass++;
  const path = [start, ...r.steps || []].map((i) => '0' + (i + 1)).join('→');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      path ${path} (final 0${r.final + 1}) · ${r.events} events: ${r.steps?.length} stepped, ${r.boundaries} at boundary, ${r.ignored} ignored · camera stopped ${r.cameraStillMovingAfterLastEventMs} ms after the last event · velocity jumps beyond cap: ${r.excessVelocityChange}${r.error ? ' · ' + r.error : ''}`);
}
await close();
console.log(`\n[${engine}] ${pass}/${SCENARIOS.length} wheel-stream scenarios passed`);
process.exit(pass === SCENARIOS.length ? 0 : 1);
