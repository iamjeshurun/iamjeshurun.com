// Acceptance checks for the Spatial view prototype (/), run against `npm run preview`.
// Usage: node scripts/spatial-check.mjs [--browser=chromium|webkit] [--headless]
// Chromium runs in a visible window by default: hidden or headless pages throttle animation frames.
import { chromium, webkit } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
const LAB = BASE + '/';
const SLUGS = ['insightpulse', 'internship-tracker', 'campus-health', 'portfolio-risk'];
const engine = (process.argv.find((a) => a.startsWith('--browser=')) || '--browser=chromium').split('=')[1];
const headless = process.argv.includes('--headless') || engine === 'webkit' && process.argv.includes('--headless');
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const browser = engine === 'webkit' ? await webkit.launch({ headless }) : await chromium.launch({ channel: 'chrome', headless });
const isChromium = engine === 'chromium';

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const p = await ctx.newPage();
  await p.bringToFront();
  await p.goto(LAB, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1300);
  return [ctx, p];
}
async function enter(p) {
  await p.locator('#spatial-launch').scrollIntoViewIfNeeded();
  await p.click('#spatial-launch');
  await p.waitForFunction(() => window.__spatial?.state === 'idle');
  await p.waitForTimeout(750); // entrance
}
const settle = (p) => p.waitForFunction(() => window.__spatial?.state === 'idle', null, { timeout: 5000 }).then(() => p.waitForTimeout(80));
const ST = () => {
  const d = document.getElementById('spatial');
  const picks = [...d.querySelectorAll('.sp-pick')];
  return {
    open: d.open,
    state: window.__spatial?.state,
    active: window.__spatial?.active,
    pick: picks.findIndex((b) => b.getAttribute('aria-pressed') === 'true'),
    cluster: [...d.querySelectorAll('.sp-cluster')].findIndex((c) => c.classList.contains('is-active')),
    href: d.querySelector('#sp-open').getAttribute('href'),
    name: d.querySelector('#sp-now').textContent.trim(),
    pickName: picks.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.name,
  };
};
const agree = (s) => s.active === s.pick && s.active === s.cluster && s.href === `/work/${SLUGS[s.active]}/` && s.name === s.pickName;
const st = (p) => p.evaluate(ST);
// Fraction of a card's visible, unobscured surface that reaches that card's own link.
const hitShare = (p, i) => p.evaluate((i) => {
  const hit = document.querySelectorAll('.sp-card__hit')[i];
  const r = hit.getBoundingClientRect();
  const bar = document.querySelector('.sp-bar').getBoundingClientRect(), top = document.querySelector('.sp-top__actions').getBoundingClientRect();
  const inside = (x, y, b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  let n = 0, good = 0;
  for (let fy = 0.06; fy < 1; fy += 0.11) for (let fx = 0.06; fx < 1; fx += 0.11) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight || inside(x, y, bar) || inside(x, y, top)) continue;
    n++; if (document.elementFromPoint(x, y) === hit) good++;
  }
  return { n, good };
}, i);
const visiblePoint = (p, i) => p.evaluate((i) => {
  const hit = document.querySelectorAll('.sp-card__hit')[i]; const r = hit.getBoundingClientRect();
  for (let fy = 0.3; fy < 0.95; fy += 0.08) for (let fx = 0.1; fx < 0.95; fx += 0.08) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x > 8 && y > 8 && x < innerWidth - 8 && y < innerHeight - 8 && document.elementFromPoint(x, y) === hit) return [x, y];
  }
  return null;
}, i);
const center = async (p, i) => { const b = await p.locator('.sp-card__hit').nth(i).boundingBox(); return [b.x + b.width / 2, b.y + b.height * 0.4]; };

/* ---------- Selection and opening ---------- */
{
  const [ctx, p] = await page();
  await enter(p);
  const s0 = await st(p);
  ok('enter: dialog open, InsightPulse in front, everything agrees', s0.open && s0.active === 0 && agree(s0), JSON.stringify(s0));
  ok('enter by mouse: focus is on the dialog (no stray focus ring); keyboard entry is checked below', await p.evaluate(() => document.activeElement.id === 'spatial'));
  for (let i = 0; i < 4; i++) {
    await p.click(`.sp-pick[data-i="${i}"]`); await settle(p);
    const s = await st(p);
    const h = await hitShare(p, i);
    ok(`select 0${i + 1} from the bar: preview, label, link agree`, s.active === i && agree(s), JSON.stringify(s));
    ok(`0${i + 1}: every visible point of the front card reaches its link`, h.n > 20 && h.good === h.n, `${h.good}/${h.n}`);
  }
  // A visible background card selects (does not open).
  await p.click('.sp-pick[data-i="0"]'); await settle(p);
  const [bx, by] = await visiblePoint(p, 1);
  await p.mouse.click(bx, by); await settle(p);
  const s1 = await st(p);
  ok('click a background card: brings it to the front, no navigation', s1.active === 1 && agree(s1) && p.url() === LAB, JSON.stringify({ active: s1.active, url: p.url() }));
  await ctx.close();
}
for (let i = 0; i < 4; i++) {
  const [ctx, p] = await page();
  await enter(p);
  await p.click(`.sp-pick[data-i="${i}"]`); await settle(p);
  const pts = await p.evaluate((i) => { const r = document.querySelectorAll('.sp-card__hit')[i].getBoundingClientRect(); return [[0.5, 0.35], [0.12, 0.1], [0.88, 0.15], [0.2, 0.9]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]); }, i);
  const [x, y] = pts[(i % 3) + 1]; // a different region of the card each time
  await p.mouse.click(x, y);
  await p.waitForURL(`**/work/${SLUGS[i]}/`, { timeout: 5000 }).catch(() => {});
  ok(`open 0${i + 1} by clicking its front card (off-centre point)`, p.url().endsWith(`/work/${SLUGS[i]}/`), p.url());
  if (i % 2 === 0) await p.goBack(); else await p.click('[data-back]');
  await p.waitForURL(LAB); await p.waitForFunction(() => window.__spatial?.state === 'idle', null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);
  const s = await st(p);
  ok(`return from 0${i + 1} via ${i % 2 === 0 ? 'browser Back' : 'the site’s All work link'}: Spatial reopens on the same project`, s.open && s.active === i && agree(s), JSON.stringify(s));
  // The view must be usable again (not frozen in "opening").
  await p.keyboard.press(i < 3 ? 'ArrowRight' : 'ArrowLeft'); await settle(p);
  ok(`after returning, the view responds to input`, (await st(p)).active === (i < 3 ? i + 1 : i - 1));
  await ctx.close();
}

/* ---------- Pointer behaviour ---------- */
{
  const [ctx, p] = await page();
  await enter(p);
  const [cx, cy] = await center(p, 0);
  // A real drag that starts on the front card's link and ends elsewhere must not navigate.
  await p.mouse.move(cx, cy); await p.mouse.down();
  for (let k = 1; k <= 20; k++) { await p.mouse.move(cx - k * 14, cy - k * 4); await p.waitForTimeout(16); }
  await p.mouse.up(); await settle(p);
  let s = await st(p);
  ok('drag starting on the front card: no navigation, settles on a project, all agree', p.url() === LAB && s.state === 'idle' && agree(s), JSON.stringify(s));
  // Slight movement during a click still counts as a click (on the visible neighbour, 03, from 02).
  await p.click('.sp-pick[data-i="1"]'); await settle(p);
  const [bx, by] = await visiblePoint(p, 2);
  await p.mouse.move(bx, by); await p.mouse.down(); await p.mouse.move(bx + 3, by + 2); await p.mouse.up(); await settle(p);
  s = await st(p);
  ok('3 px of movement during a click on a background card still selects it', s.active === 2 && agree(s), JSON.stringify(s));
  // Release outside the scene (over the control bar) ends the drag cleanly.
  const [fx, fy] = await center(p, 2); // card 02 is now in front
  const bar = await p.locator('.sp-bar').boundingBox();
  await p.mouse.move(fx, fy); await p.mouse.down();
  for (let k = 1; k <= 12; k++) { await p.mouse.move(fx + (bar.x + 40 - fx) * k / 12, fy + (bar.y + 20 - fy) * k / 12); await p.waitForTimeout(16); }
  await p.mouse.up(); await settle(p);
  const m0 = await p.evaluate(() => getComputedStyle(document.getElementById('sp-world')).transform);
  await p.mouse.move(300, 300); await p.mouse.move(600, 200); await p.waitForTimeout(200);
  const m1 = await p.evaluate(() => getComputedStyle(document.getElementById('sp-world')).transform);
  s = await st(p);
  ok('release over the controls: drag ends, camera no longer follows the pointer', s.state === 'idle' && m0 === m1 && agree(s), JSON.stringify(s));
  // Rapid reversals, then rapid picks: every frame agrees, the camera never jumps.
  await p.evaluate((src) => {
    const read = new Function(`return (${src})()`);
    window.__f = []; window.__spTrace = []; const t0 = performance.now();
    (function f() { const m = new DOMMatrix(getComputedStyle(document.getElementById('sp-world')).transform); window.__f.push({ s: read(), x: m.m41, y: m.m42, t: performance.now() }); if (performance.now() - t0 < 3600) requestAnimationFrame(f); })();
  }, ST.toString());
  await p.mouse.move(720, 400); await p.mouse.down();
  let px = 720;
  for (const to of [880, 720, 920, 700, 820]) { const from = px; for (let k = 1; k <= 8; k++) { px = from + (to - from) * k / 8; await p.mouse.move(px, 400); await p.waitForTimeout(12); } }
  await p.mouse.up();
  for (const i of [3, 0, 2, 1, 3, 2]) { await p.click(`.sp-pick[data-i="${i}"]`); await p.waitForTimeout(45); }
  await p.waitForTimeout(2600);
  const fr = await p.evaluate(() => window.__f);
  const disagree = fr.filter((f) => !(f.s.active === f.s.pick && f.s.active === f.s.cluster && f.s.name === f.s.pickName)).length;
  // A jump is a discontinuity: between the spring's own steps, velocity may only change as much as the
  // acceleration cap allows for that step (uneven frames in some engines are accounted for by each step's dt).
  const tr = await p.evaluate(() => window.__spTrace);
  let jump = 0;
  for (let k = 2; k < tr.length; k++) {
    const [, x2, y2, d2] = tr[k], [, x1, y1, d1] = tr[k - 1], [, x0, y0] = tr[k - 2];
    if (!d2 || !d1) continue;
    const dv = Math.hypot((x2 - x1) / d2 - (x1 - x0) / d1, (y2 - y1) / d2 - (y1 - y0) / d1);
    jump = Math.max(jump, dv - 14000 * d2);
  }
  const end = await st(p);
  ok('rapid reversals and picks: selection agrees on every frame', disagree === 0, `${disagree}/${fr.length}`);
  ok('rapid reversals and picks: no discontinuity in spring-driven camera motion', jump < 400, `worst velocity change beyond the acceleration cap: ${Math.round(Math.max(0, jump))} px/s`);
  ok('rapid input settles on the last choice', end.active === 2 && end.state === 'idle' && agree(end), JSON.stringify(end));
  // Grabbing a moving camera: it stops where it is (no jump) and stays put while held.
  await p.click('.sp-pick[data-i="0"]'); await settle(p);
  await p.evaluate(() => { const w = document.getElementById('sp-world'); const pos = () => { const m = new DOMMatrix(getComputedStyle(w).transform); return [m.m41, m.m42]; };
    window.__prev = pos(); (function f() { window.__prev2 = window.__prev; window.__prev = pos(); if (!window.__grab) requestAnimationFrame(f); })();
    document.getElementById('sp-stage').addEventListener('pointerdown', () => { window.__grab = { before: window.__prev, at: pos() }; requestAnimationFrame(() => requestAnimationFrame(() => { window.__grab.after = pos(); })); }, { once: true, capture: true }); });
  await p.click('.sp-pick[data-i="3"]'); await p.waitForTimeout(160);
  await p.mouse.move(700, 420); await p.mouse.down(); await p.waitForTimeout(250);
  const held = await p.evaluate(() => { const w = document.getElementById('sp-world'); const m = new DOMMatrix(getComputedStyle(w).transform); return { ...window.__grab, later: [m.m41, m.m42], state: window.__spatial.state }; });
  await p.mouse.up(); await settle(p);
  const d = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
  const lastStep = await p.evaluate(() => Math.hypot(window.__prev[0] - window.__prev2[0], window.__prev[1] - window.__prev2[1]));
  ok('grabbing a moving camera: stops within one frame of motion, holds still while pressed', d(held.before, held.at) <= lastStep * 1.6 + 2 && d(held.at, held.later) < 1 && held.state === 'pressed', JSON.stringify({ movedAtGrab: d(held.before, held.at), previousFrameStep: Math.round(lastStep), driftWhileHeld: d(held.at, held.later), state: held.state }));
  // Wheel: one project per gesture.
  await p.click('.sp-pick[data-i="0"]'); await settle(p);
  for (let k = 0; k < 14; k++) { await p.mouse.wheel(0, 40); await p.waitForTimeout(30); }
  await p.waitForTimeout(500); await settle(p);
  ok('one wheel/trackpad gesture moves exactly one project', (await st(p)).active === 1);
  await ctx.close();
}
if (isChromium) {
  // Pointer cancellation (touch) mid-drag.
  const [ctx, p] = await page({ hasTouch: true });
  await enter(p);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 900, y: 450 }] });
  for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 900 - k * 30, y: 450 }] });
  const during = (await st(p)).state;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await settle(p);
  const s = await st(p);
  ok('pointercancel mid-drag: recovers and settles on a project', during === 'dragging' && s.state === 'idle' && agree(s), `${during} → ${JSON.stringify(s)}`);
  // Touch drag then release settles; a tap on a background card selects; a tap on the front card opens.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 1000, y: 420 }] });
  for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 1000 - k * 45, y: 420 - k * 6 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(p);
  const t1 = await st(p);
  ok('touch drag (simulated): settles on a project without navigating', t1.state === 'idle' && agree(t1) && p.url() === LAB, JSON.stringify(t1));
  const target = (t1.active + 1) % 4;
  await p.click(`.sp-pick[data-i="${t1.active}"]`); await settle(p);
  const [tx, ty] = await center(p, target);
  if (tx > 0 && tx < 1440 && ty > 0 && ty < 800) {
    await p.touchscreen.tap(tx, ty); await settle(p);
    ok('touch tap on a background card (simulated) selects it', (await st(p)).active === target);
  }
  const [fx, fy] = await center(p, (await st(p)).active);
  await p.touchscreen.tap(fx, fy);
  await p.waitForURL('**/work/**', { timeout: 5000 }).catch(() => {});
  ok('touch tap on the front card (simulated) opens it', p.url().includes('/work/'), p.url());
  await ctx.close();
}

/* ---------- Lifecycle ---------- */
{
  const [ctx, p] = await page();
  const settleTime = async () => { await p.click('.sp-pick[data-i="0"]'); await settle(p); const t = Date.now(); await p.click('.sp-pick[data-i="3"]'); await settle(p); return Date.now() - t; };
  await enter(p);
  const t0 = await settleTime();
  for (let k = 0; k < 10; k++) {
    if (k % 2) await p.keyboard.press('Escape'); else await p.click('#sp-exit');
    await p.waitForFunction(() => !document.getElementById('spatial').open);
    ok(`exit ${k + 1}: listeners released`, (await p.evaluate(() => window.__spatial.listening)) === false);
    await enter(p);
  }
  await p.click('.sp-pick[data-i="0"]'); await settle(p);
  await p.keyboard.press('ArrowRight'); await settle(p);
  ok('after 10 entries: one arrow press moves exactly one project', (await st(p)).active === 1);
  const t1 = await settleTime();
  ok('after 10 entries: camera speed unchanged', Math.abs(t1 - t0) < Math.max(250, t0 * 0.3), `${t0} ms → ${t1} ms`);
  // Exit restores B: selected project, scroll position, focus.
  await p.click('.sp-pick[data-i="2"]'); await settle(p);
  const y0 = await p.evaluate(() => scrollY);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  const b = await p.evaluate(() => ({ sel: [...document.querySelectorAll('#picker [role=tab]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'), focus: document.activeElement.id, y: scrollY }));
  ok('exit: B shows the project chosen in Spatial, focus returns to the launcher, scroll unchanged', b.sel === 2 && b.focus === 'spatial-launch' && Math.abs(b.y - y0) < 2, JSON.stringify(b));
  // B no longer auto-advances after a Spatial session.
  await p.mouse.move(5, 895); await p.waitForTimeout(8000);
  ok('B does not auto-advance after the visitor used Spatial', (await p.evaluate(() => [...document.querySelectorAll('#picker [role=tab]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'))) === 2);
  await ctx.close();
}
if (isChromium) {
  // Switching tabs mid-movement, then returning.
  const [ctx, p] = await page();
  await enter(p);
  await p.click('.sp-pick[data-i="3"]'); await p.waitForTimeout(80);
  // Automated Chrome never reports a background tab as hidden here, so the visibility change is simulated.
  // (A genuinely hidden page was verified separately in the in-app browser pane.)
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await p.evaluate(() => ({ vis: document.visibilityState, state: window.__spatial.state, rest: !document.getElementById('sp-world').style.transform }));
  await p.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(200);
  await p.keyboard.press('ArrowLeft'); await settle(p);
  const s = await st(p);
  ok('page hidden mid-move (simulated visibilitychange): finishes instantly at rest, works on return', hidden.vis === 'hidden' && hidden.state === 'idle' && hidden.rest && s.active === 2 && agree(s), JSON.stringify({ hidden, s }));
  await ctx.close();
}
{
  // Resizing during a drag.
  const [ctx, p] = await page();
  await enter(p);
  await p.mouse.move(800, 420); await p.mouse.down();
  for (let k = 1; k <= 6; k++) { await p.mouse.move(800 - k * 25, 420); await p.waitForTimeout(16); }
  await p.setViewportSize({ width: 1100, height: 760 }); await p.waitForTimeout(500);
  await p.mouse.up(); await p.waitForTimeout(300);
  const s = await st(p);
  const layout = await p.evaluate(() => {
    const r = document.querySelectorAll('.sp-card__hit')[window.__spatial.active].getBoundingClientRect();
    const ctrls = [...document.querySelectorAll('.sp-pick, #sp-exit, #sp-recenter, #sp-open')].every((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; });
    return { cardCentreX: Math.round(r.left + r.width / 2), w: innerWidth, ctrls, inline: document.getElementById('sp-world').style.transform };
  });
  ok('resize during a drag: drag ends, active card recentred, controls on screen', s.state === 'idle' && agree(s) && Math.abs(layout.cardCentreX - layout.w / 2) < 30 && layout.ctrls && !layout.inline, JSON.stringify({ s, layout }));
  await ctx.close();
}

/* ---------- Accessibility ---------- */
{
  const [ctx, p] = await page();
  await p.locator('#spatial-launch').scrollIntoViewIfNeeded();
  await p.focus('#spatial-launch'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => window.__spatial?.state === 'idle'); await p.waitForTimeout(700);
  const sem = await p.evaluate(() => { const d = document.getElementById('spatial'); return { modal: d.matches(':modal'), label: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent }; });
  ok('keyboard: Enter opens a labelled modal dialog', sem.modal && sem.label === 'Spatial view', JSON.stringify(sem));
  await p.keyboard.press('ArrowRight'); await settle(p);
  const f = await p.evaluate(() => ({ focus: document.activeElement.dataset.i, ring: getComputedStyle(document.activeElement).outlineStyle }));
  ok('keyboard: arrows change project and keep focus on the active button, ring visible', (await st(p)).active === 1 && f.focus === '1' && f.ring === 'solid', JSON.stringify(f));
  const stops = [];
  const TAB = isChromium ? 'Tab' : 'Alt+Tab'; // WebKit/Safari: Option+Tab reaches links and buttons
  for (let k = 0; k < 9; k++) { await p.keyboard.press(TAB); stops.push(await p.evaluate(() => document.activeElement.id || document.activeElement.className.split(' ')[0])); }
  ok('keyboard: Tab stays inside the dialog and reaches Open case study, Recenter, Exit', stops.includes('sp-open') && stops.includes('sp-exit') && stops.includes('sp-recenter') && !stops.some((s) => s === 'skip' || s === 'spatial-launch'), stops.join(' → '));
  await p.focus('#sp-open'); await p.keyboard.press('Enter');
  await p.waitForURL(`**/work/${SLUGS[1]}/`, { timeout: 5000 }).catch(() => {});
  ok('keyboard: Enter on Open case study opens the active project', p.url().endsWith(`/work/${SLUGS[1]}/`), p.url());
  await p.goBack(); await p.waitForURL(LAB); await p.waitForTimeout(600);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  ok('keyboard: Escape exits after returning', !(await p.evaluate(() => document.getElementById('spatial').open)));
  await ctx.close();
}
{
  const [ctx, p] = await page({ reducedMotion: 'reduce' });
  await enter(p);
  await p.click('.sp-pick[data-i="3"]');
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // let the frame complete
  const s = await st(p);
  const running = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect.getComputedTiming().duration > 1).length); // 1 ms state changes are instant, not motion
  ok('reduced motion: selection is immediate, nothing animating', s.state === 'idle' && s.active === 3 && agree(s) && running === 0, JSON.stringify({ ...s, running }));
  await p.keyboard.press('Home'); await p.waitForTimeout(60);
  ok('reduced motion: keyboard reaches every project', (await st(p)).active === 0);
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const p = await ctx.newPage(); await p.goto(LAB, { waitUntil: 'networkidle' });
  const r = await p.evaluate(() => ({ launchVisible: !document.getElementById('spatial-launch').checkVisibility?.() === false && getComputedStyle(document.getElementById('spatial-launch')).display !== 'none', b: !!document.querySelector('#picker [role=tab][aria-selected=true]') }));
  ok('without JavaScript: B works and no dead Spatial button is shown', !r.launchVisible && r.b, JSON.stringify(r));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n[${engine}${headless ? ', headless' : ''}] ${results.length - failed.length}/${results.length} spatial checks passed`);
process.exit(failed.length ? 1 : 0);
