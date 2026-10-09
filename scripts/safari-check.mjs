// Spatial view checks in real Safari via safaridriver (W3C WebDriver). Requires `npm run preview` and
// Safari ▸ Develop ▸ Allow Remote Automation. Usage: node scripts/safari-check.mjs
// Safari's WebDriver has no touch input and no reduced-motion emulation; those stay covered by spatial-check.mjs.
import { spawn } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
const LAB = BASE + '/';
const SLUGS = ['insightpulse', 'internship-tracker', 'campus-health', 'portfolio-risk'];
const PORT = 4556;
const results = [];
let undeliveredClicks = 0;
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const driver = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
await sleep(1500);
async function wd(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (j.value && j.value.error) throw new Error(`${method} ${path}: ${j.value.error} ${j.value.message}`);
  return j.value;
}
const { sessionId } = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const S = `/session/${sessionId}`;
const exec = (fn, ...args) => wd('POST', `${S}/execute/sync`, { script: `return (${fn}).apply(null, arguments)`, args });
const execAsync = (fn, ...args) => wd('POST', `${S}/execute/async`, { script: `const done = arguments[arguments.length - 1]; Promise.resolve((${fn}).apply(null, Array.prototype.slice.call(arguments, 0, -1))).then(done, (e) => done({ __error: String(e) }));`, args });
const url = () => wd('GET', `${S}/url`);
const go = (u) => wd('POST', `${S}/url`, { url: u });
const back = () => wd('POST', `${S}/back`, {});
async function until(fn, ms = 6000, ...args) { const t = Date.now(); while (Date.now() - t < ms) { if (await exec(fn, ...args).catch(() => false)) return true; await sleep(80); } return false; }
const pointer = (steps) => wd('POST', `${S}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: steps }] }).then(() => wd('DELETE', `${S}/actions`));
const move = (x, y, duration = 0) => ({ type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport', duration });
const click = (x, y) => pointer([move(x, y), { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }]);
const KEY = { ArrowRight: '', ArrowLeft: '', Escape: '', Enter: '', Tab: '', Alt: '', Home: '' };
const key = (k, mod) => wd('POST', `${S}/actions`, { actions: [{ type: 'key', id: 'kb', actions: [...(mod ? [{ type: 'keyDown', value: KEY[mod] }] : []), { type: 'keyDown', value: KEY[k] }, { type: 'keyUp', value: KEY[k] }, ...(mod ? [{ type: 'keyUp', value: KEY[mod] }] : [])] }] }).then(() => wd('DELETE', `${S}/actions`));
const clickSel = async (sel) => {
  const e = await wd('POST', `${S}/element`, { using: 'css selector', value: sel });
  try { await wd('POST', `${S}/element/${Object.values(e)[0]}/click`, {}); }
  catch (err) {
    const why = await exec((sel) => { const log = window.__closeLog; const el = document.querySelector(sel); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { rect: [r.left, r.top, r.width, r.height].map(Math.round), atCentre: top && (top.id || top.className), path: location.pathname, dialogOpen: document.getElementById('spatial')?.open, active: document.activeElement.id || document.activeElement.className, log }; }, sel).catch(() => ({}));
    throw new Error(`click ${sel}: ${err.message} ${JSON.stringify(why)}`);
  }
};

const ST = () => {
  const d = document.getElementById('spatial'); const picks = [...d.querySelectorAll('.sp-pick')];
  return { open: d.open, state: window.__spatial && window.__spatial.state, active: window.__spatial && window.__spatial.active,
    pick: picks.findIndex((b) => b.getAttribute('aria-pressed') === 'true'), cluster: [...d.querySelectorAll('.sp-cluster')].findIndex((c) => c.classList.contains('is-active')),
    href: d.querySelector('#sp-open').getAttribute('href'), name: d.querySelector('#sp-now').textContent.trim(), pickName: (picks.find((b) => b.getAttribute('aria-pressed') === 'true') || {}).dataset?.name };
};
const st = () => exec(ST);
const agree = (s) => s.active === s.pick && s.active === s.cluster && s.href === `/work/${SLUGS[s.active]}/` && s.name === s.pickName;
const idle = () => until(() => window.__spatial && window.__spatial.state === 'idle');
const visiblePoint = (i) => exec((i) => {
  const hit = document.querySelectorAll('.sp-card__hit')[i]; const r = hit.getBoundingClientRect();
  for (let fy = 0.3; fy < 0.95; fy += 0.08) for (let fx = 0.1; fx < 0.95; fx += 0.08) { const x = r.left + r.width * fx, y = r.top + r.height * fy; if (x > 8 && y > 8 && x < innerWidth - 8 && y < innerHeight - 8 && document.elementFromPoint(x, y) === hit) return [x, y]; }
  return null;
}, i);
async function fresh() {
  await go(LAB);
  await exec(() => { sessionStorage.clear(); history.replaceState(null, ''); });
  await go(LAB + '?r=' + Date.now());
  await until(() => !document.getElementById('spatial-launch').hidden);
  await exec(() => { window.__closeLog = []; const d = document.getElementById('spatial'); const L = (m) => window.__closeLog.push(Math.round(performance.now()) + ' ' + m);
    d.addEventListener('cancel', () => L('cancel event'), true); d.addEventListener('close', () => L('close event'), true);
    document.addEventListener('keydown', (e) => L('keydown ' + e.key + ' on ' + (e.target.id || e.target.className)), true);
    document.getElementById('sp-exit').addEventListener('click', () => L('exit clicked'), true);
    new MutationObserver(() => L('open=' + d.open + ' state=' + (window.__spatial && window.__spatial.state) + ' focus=' + (document.activeElement.id || document.activeElement.className))).observe(d, { attributes: true, attributeFilter: ['open'] });
    document.addEventListener('click', (e) => L('click ' + (e.target.id || e.target.className) + ' detail=' + e.detail + ' xy=' + e.clientX + ',' + e.clientY + ' state=' + (window.__spatial && window.__spatial.state)), true);
    document.addEventListener('pointerdown', (e) => L('pointerdown ' + (e.target.id || e.target.className) + ' type=' + e.pointerType), true);
    document.addEventListener('visibilitychange', () => L('visibility ' + document.visibilityState)); window.addEventListener('blur', () => L('window blur')); window.addEventListener('focus', () => L('window focus')); });
  await sleep(1200);
}
async function enter() {
  // The site scrolls smoothly; scroll instantly so WebDriver never clicks a moving target.
  await exec(() => { document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('spatial-launch').scrollIntoView({ block: 'center', behavior: 'instant' }); });
  await sleep(150);
  await clickSel('#spatial-launch');
  // safaridriver occasionally reports a click that never reaches the page (no pointerdown, no click logged).
  // Retry only in that provable case, and count it, so a real failure to open is still caught.
  if (!(await until(() => document.getElementById('spatial').open, 1500))) {
    const received = await exec(() => (window.__closeLog || []).some((l) => l.includes('click spatial-launch') || l.includes('pointerdown spatial-launch')));
    if (!received) { undeliveredClicks++; await clickSel('#spatial-launch'); }
  }
  if (!(await until(() => document.getElementById('spatial').open, 3000))) {
    const diag = await exec(() => { const b = document.getElementById('spatial-launch'); const r = b.getBoundingClientRect(); return { log: window.__closeLog, state: window.__spatial && window.__spatial.state, launchRect: [r.left, r.top, r.width, r.height].map(Math.round), atLaunch: (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || {}).id, scrollY, hidden: b.hidden }; });
    throw new Error('Spatial view did not open after clicking the launcher ' + JSON.stringify(diag));
  }
  await idle(); await sleep(800);
}

try {
  await wd('POST', `${S}/window/rect`, { width: 1440, height: 1000 });
  const vp = await exec(() => [innerWidth, innerHeight, navigator.userAgent.match(/Version\/([\d.]+)/)?.[1]]);
  console.log(`Safari ${vp[2]} viewport ${vp[0]}×${vp[1]}`);

  /* Selection, agreement, hit-testing */
  await fresh(); await enter();
  let s = await st();
  ok('enter: dialog open on InsightPulse, everything agrees', s.open && s.active === 0 && agree(s), JSON.stringify(s));
  for (let i = 0; i < 4; i++) {
    await clickSel(`.sp-pick[data-i="${i}"]`); await idle(); await sleep(100);
    s = await st();
    const h = await exec((i) => { const hit = document.querySelectorAll('.sp-card__hit')[i]; const r = hit.getBoundingClientRect(); const bar = document.querySelector('.sp-bar').getBoundingClientRect(); let n = 0, g = 0; for (let fy = 0.06; fy < 1; fy += 0.11) for (let fx = 0.06; fx < 1; fx += 0.11) { const x = r.left + r.width * fx, y = r.top + r.height * fy; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight || (y > bar.top && x > bar.left && x < bar.right)) continue; n++; if (document.elementFromPoint(x, y) === hit) g++; } return [g, n]; }, i);
    ok(`select 0${i + 1}: preview, label, link agree; front card fully clickable`, s.active === i && agree(s) && h[1] > 20 && h[0] === h[1], `${JSON.stringify({ active: s.active })} hit ${h[0]}/${h[1]}`);
  }
  await clickSel('.sp-pick[data-i="0"]'); await idle();
  const vp1 = await visiblePoint(1);
  await click(vp1[0], vp1[1]); await sleep(150); await idle();
  s = await st();
  ok('click a background card: brings it to the front, no navigation', s.active === 1 && agree(s) && (await url()).startsWith(LAB), JSON.stringify({ active: s.active }));

  /* Opening each project and returning (Back and the All work link) */
  for (let i = 0; i < 4; i++) {
    await fresh(); await enter();
    await clickSel(`.sp-pick[data-i="${i}"]`); await idle(); await sleep(150);
    const pt = await exec((i) => { const r = document.querySelectorAll('.sp-card__hit')[i].getBoundingClientRect(); return [r.left + r.width * [0.5, 0.15, 0.85, 0.3][i], r.top + r.height * [0.35, 0.12, 0.2, 0.85][i]]; }, i);
    await click(pt[0], pt[1]);
    await until(() => location.pathname.startsWith('/work/'), 6000);
    const u = await url();
    ok(`open 0${i + 1} by clicking its front card (off-centre point)`, u.endsWith(`/work/${SLUGS[i]}/`), u);
    await sleep(1000); // let the 760 ms page transition finish before WebDriver interacts
    if (i % 2 === 0) await back(); else await clickSel('[data-back]');
    await until(() => location.pathname === '/', 6000); await until(() => window.__spatial && window.__spatial.state === 'idle', 6000); await sleep(500);
    s = await st();
    ok(`return from 0${i + 1} via ${i % 2 === 0 ? 'Back' : 'All work'}: Spatial reopens on the same project`, s.open && s.active === i && agree(s), JSON.stringify(s));
    await key(i < 3 ? 'ArrowRight' : 'ArrowLeft'); await sleep(100); await idle();
    ok('  …and responds to input afterwards', (await st()).active === (i < 3 ? i + 1 : i - 1));
  }

  /* Pointer behaviour */
  await fresh(); await enter();
  let c = await exec(() => { const r = document.querySelectorAll('.sp-card__hit')[0].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.4]; });
  const drag = [move(c[0], c[1]), { type: 'pointerDown', button: 0 }];
  for (let k = 1; k <= 20; k++) drag.push(move(c[0] - k * 26, c[1] - k * 2, 16));
  drag.push({ type: 'pointerUp', button: 0 });
  await pointer(drag); await sleep(150); await idle();
  s = await st();
  ok('drag starting on the front card: no navigation, settles on the next project', (await url()).startsWith(LAB) && s.state === 'idle' && s.active === 1 && agree(s), JSON.stringify(s));
  const vp2 = await visiblePoint(2);
  await pointer([move(vp2[0], vp2[1]), { type: 'pointerDown', button: 0 }, move(vp2[0] + 3, vp2[1] + 2, 20), { type: 'pointerUp', button: 0 }]); await sleep(150); await idle();
  s = await st();
  ok('3 px of movement during a click on a background card still selects it', s.active === 2 && agree(s), JSON.stringify({ active: s.active }));
  c = await exec(() => { const r = document.querySelectorAll('.sp-card__hit')[2].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.4]; });
  const bar = await exec(() => { const r = document.querySelector('.sp-bar').getBoundingClientRect(); return [r.left + 40, r.top + 20]; });
  const out = [move(c[0], c[1]), { type: 'pointerDown', button: 0 }];
  for (let k = 1; k <= 12; k++) out.push(move(c[0] + (bar[0] - c[0]) * k / 12, c[1] + (bar[1] - c[1]) * k / 12, 16));
  out.push({ type: 'pointerUp', button: 0 });
  await pointer(out); await sleep(150); await idle();
  const m0 = await exec(() => getComputedStyle(document.getElementById('sp-world')).transform);
  await pointer([move(300, 300, 50), move(600, 200, 50)]); await sleep(200);
  s = await st();
  ok('release over the controls: drag ends, camera stops following', s.state === 'idle' && agree(s) && m0 === await exec(() => getComputedStyle(document.getElementById('sp-world')).transform), JSON.stringify({ state: s.state, active: s.active }));

  /* Rapid picks: agreement every frame, no discontinuity in spring motion, frame timing */
  await exec(() => { window.__spTrace = []; window.__fr = []; let last = performance.now(); const t0 = last; (function f(now) { const d = document.getElementById('spatial'); const picks = [...d.querySelectorAll('.sp-pick')]; window.__fr.push({ dt: now - last, a: window.__spatial.active, p: picks.findIndex((b) => b.getAttribute('aria-pressed') === 'true'), c: [...d.querySelectorAll('.sp-cluster')].findIndex((x) => x.classList.contains('is-active')) }); last = now; if (now - t0 < 3500) requestAnimationFrame(f); })(last); });
  for (const i of [3, 0, 2, 1, 3, 2]) { await clickSel(`.sp-pick[data-i="${i}"]`); await sleep(40); }
  await sleep(3000);
  const r = await exec(() => ({ fr: window.__fr, tr: window.__spTrace }));
  const bad = r.fr.filter((f) => f.a !== f.p || f.a !== f.c).length;
  let jump = 0; for (let k = 2; k < r.tr.length; k++) { const [, x2, y2, d2] = r.tr[k], [, x1, y1, d1] = r.tr[k - 1], [, x0, y0] = r.tr[k - 2]; if (!d2 || !d1) continue; jump = Math.max(jump, Math.hypot((x2 - x1) / d2 - (x1 - x0) / d1, (y2 - y1) / d2 - (y1 - y0) / d1) - 14000 * d2); }
  const dts = r.fr.slice(5).map((f) => f.dt).sort((a, b) => a - b);
  s = await st();
  ok('rapid picks: selection agrees on every frame', bad === 0, `${bad}/${r.fr.length}`);
  ok('rapid picks: no discontinuity in spring motion', jump < 400, `excess ${Math.round(Math.max(0, jump))} px/s`);
  ok('rapid picks: settle on the last choice', s.active === 2 && agree(s) && s.state === 'idle');
  console.log(`      Safari frame timing during the sequence: median ${dts[Math.floor(dts.length / 2)].toFixed(1)} ms, p95 ${dts[Math.floor(dts.length * 0.95)].toFixed(1)} ms, ${dts.filter((d) => d > 25).length} frames > 25 ms`);

  /* Wheel. safaridriver emits a scroll action as a +delta/−delta pair (net zero), so it cannot model a gesture;
     dispatch real WheelEvent objects inside Safari instead. A physical trackpad still needs a hands-on check. */
  await clickSel('.sp-pick[data-i="0"]'); await idle();
  await exec(() => { const st = document.getElementById('sp-stage'); for (let k = 0; k < 14; k++) st.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true })); });
  await sleep(500); await idle();
  ok('one wheel gesture (14 dispatched WheelEvents) moves exactly one project', (await st()).active === 1);

  /* Lifecycle: repeated entry/exit, exit restores B */
  await fresh(); await enter();
  for (let k = 0; k < 10; k++) {
    if (k % 2) await key('Escape'); else await clickSel('#sp-exit');
    await until(() => !document.getElementById('spatial').open);
    if ((await exec(() => window.__spatial.listening)) !== false) { ok(`exit ${k + 1}: listeners released`, false); }
    await enter();
  }
  ok('10 entries and exits: listeners released each time', !results.some((x) => x.name.startsWith('exit ') && !x.pass));
  await clickSel('.sp-pick[data-i="0"]'); await idle();
  await key('ArrowRight'); await sleep(100); await idle();
  ok('after 10 entries: one arrow press moves exactly one project', (await st()).active === 1);
  await clickSel('.sp-pick[data-i="2"]'); await idle();
  const y0 = await exec(() => scrollY);
  await key('Escape'); await sleep(500);
  const b = await exec(() => ({ sel: [...document.querySelectorAll('#picker [role=tab]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'), focus: document.activeElement.id, y: scrollY }));
  ok('exit: B shows the chosen project, focus on the launcher, scroll unchanged', b.sel === 2 && b.focus === 'spatial-launch' && Math.abs(b.y - y0) < 2, JSON.stringify(b));

  /* Resize during a drag */
  await enter();
  const dc = await exec(() => [innerWidth * 0.6, innerHeight * 0.45]);
  await wd('POST', `${S}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [move(dc[0], dc[1]), { type: 'pointerDown', button: 0 }, move(dc[0] - 60, dc[1], 60), move(dc[0] - 140, dc[1], 60)] }] });
  const during = (await st()).state;
  await wd('POST', `${S}/window/rect`, { width: 1150, height: 860 }); await sleep(700);
  await wd('POST', `${S}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerUp', button: 0 }] }] });
  await wd('DELETE', `${S}/actions`); await sleep(400);
  s = await st();
  const lay = await exec(() => { const r = document.querySelectorAll('.sp-card__hit')[window.__spatial.active].getBoundingClientRect(); return { dx: Math.round(r.left + r.width / 2 - innerWidth / 2), ctrls: [...document.querySelectorAll('.sp-pick, #sp-exit, #sp-recenter, #sp-open')].every((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; }), url: location.pathname }; });
  ok('resize during a drag: drag ends without opening anything, card recentred, controls on screen', during === 'dragging' && s.state === 'idle' && agree(s) && Math.abs(lay.dx) < 30 && lay.ctrls && lay.url === '/', JSON.stringify({ during, state: s.state, ...lay }));
  await wd('POST', `${S}/window/rect`, { width: 1440, height: 1000 }); await sleep(500);

  /* Keyboard only (Safari: Option+Tab reaches links and buttons unless "Press Tab to highlight" is on) */
  await fresh();
  await exec(() => document.getElementById('spatial-launch').focus());
  await key('Enter'); await idle(); await sleep(700);
  const sem = await exec(() => { const d = document.getElementById('spatial'); return { modal: d.matches(':modal'), focus: document.activeElement.className }; });
  ok('keyboard: Enter opens the modal dialog with focus on the active project', sem.modal && sem.focus.includes('sp-pick'), JSON.stringify(sem));
  await key('ArrowRight'); await sleep(100); await idle();
  const fk = await exec(() => ({ focus: document.activeElement.dataset.i, ring: getComputedStyle(document.activeElement).outlineStyle }));
  ok('keyboard: arrow moves project and focus, ring visible', (await st()).active === 1 && fk.focus === '1' && fk.ring !== 'none', JSON.stringify(fk));
  const stops = [];
  for (let k = 0; k < 9; k++) { await key('Tab', 'Alt'); stops.push(await exec(() => document.activeElement.id || document.activeElement.className.split(' ')[0])); }
  ok('keyboard: Option+Tab stays in the dialog and reaches Open case study, Recenter, Exit', stops.includes('sp-open') && stops.includes('sp-recenter') && stops.includes('sp-exit') && !stops.includes('spatial-launch'), stops.join(' → '));
  await exec(() => document.getElementById('sp-open').focus()); await key('Enter');
  await until(() => location.pathname.startsWith('/work/'), 6000);
  ok('keyboard: Enter on Open case study opens the active project', (await url()).endsWith(`/work/${SLUGS[1]}/`), await url());
  await back(); await until(() => location.pathname === '/'); await idle(); await sleep(400);
  await exec(() => { window.__keys = []; document.addEventListener('keydown', (e) => window.__keys.push(e.key + '@' + (document.activeElement.id || document.activeElement.tagName)), true); });
  await key('Escape'); await sleep(400);
  let escInfo = await exec(() => ({ open: document.getElementById('spatial').open, keys: window.__keys, state: window.__spatial.state, listening: window.__spatial.listening, focus: document.activeElement.id || document.activeElement.tagName }));
  if (escInfo.open && escInfo.keys.length === 0) { undeliveredClicks++; await key('Escape'); await sleep(400); escInfo = await exec(() => ({ open: document.getElementById('spatial').open, keys: window.__keys, state: window.__spatial.state, listening: window.__spatial.listening, focus: document.activeElement.id || document.activeElement.tagName })); }
  ok('keyboard: Escape exits after returning', !escInfo.open, JSON.stringify(escInfo));
} catch (e) {
  ok('script error', false, e.message);
} finally {
  await wd('DELETE', S).catch(() => {});
  driver.kill();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n[safari] ${results.length - failed.length}/${results.length} spatial checks passed${undeliveredClicks ? ` (safaridriver dropped ${undeliveredClicks} input${undeliveredClicks > 1 ? 's' : ''} before reaching the page; retried)` : ''}`);
process.exit(failed.length ? 1 : 0);
