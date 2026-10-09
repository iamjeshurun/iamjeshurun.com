// Interaction tests for the homepage project area, run in a real (headed) Chrome window so timers,
// animation frames and transitions behave as they do for visitors. Requires `npm run preview`.
// Usage: node scripts/interaction-check.mjs [--headless]
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
const HOME = process.env.HOME_PATH || '/'; // override to test another page that renders Home
const SLUGS = ['insightpulse', 'internship-tracker', 'campus-health', 'portfolio-risk'];
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: process.argv.includes('--headless') });

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const p = await ctx.newPage();
  await p.bringToFront(); // macOS reports covered windows as hidden, which (correctly) pauses rotation
  await p.goto(BASE + HOME, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1400); // let the opening sequence finish
  return [ctx, p];
}
// Everything the visitor can see about the selection, read in one go.
const STATE = () => {
  const picker = document.getElementById('picker');
  const tabs = [...picker.querySelectorAll('[role=tab]')];
  const sets = [...picker.querySelectorAll('.pset')];
  const dets = [...picker.querySelectorAll('.detail')];
  const op = (el) => parseFloat(getComputedStyle(el).opacity);
  const activeSet = sets.findIndex((s) => s.dataset.pos === 'active');
  return {
    sel: tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'),
    det: dets.findIndex((d) => d.classList.contains('is-active')),
    set: activeSet,
    openHref: sets[activeSet]?.querySelector('.layer__open')?.getAttribute('href'),
    detHref: dets.find((d) => d.classList.contains('is-active'))?.querySelector('a')?.getAttribute('href'),
    visDetails: dets.filter((d) => op(d) > 0.05).length,
    visSets: sets.filter((s) => op(s) > 0.05).length,
    pill: [...document.querySelectorAll('.mwork__pill')].findIndex((b) => b.getAttribute('aria-pressed') === 'true'),
    rotating: picker.dataset.rotating,
  };
};
const agree = (s) => s.sel === s.det && s.sel === s.set && s.openHref === `/work/${SLUGS[s.sel]}/` && s.detHref === s.openHref && s.pill === s.sel;
const sel = (p) => p.evaluate(() => [...document.querySelectorAll('#picker [role=tab]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'));

/* 1. Rapid and reversing clicks: state must agree on every frame; at most two sets / one description visible. */
{
  const [ctx, p] = await open();
  await p.evaluate((src) => {
    const read = new Function(`return (${src})()`);
    window.__frames = []; const t0 = performance.now();
    (function f() { window.__frames.push(read()); if (performance.now() - t0 < 2200) requestAnimationFrame(f); })();
  }, STATE.toString());
  for (const i of [1, 3, 0, 2, 1, 3, 2]) { await p.click(`#tab-${i}`); await p.waitForTimeout(50); }
  await p.waitForTimeout(2000);
  const frames = await p.evaluate(() => window.__frames);
  const bad = frames.filter((s) => !agree(s)).length;
  ok('rapid clicks: selection, preview, description and links agree on every frame', bad === 0, `${bad}/${frames.length} frames disagree`);
  ok('rapid clicks: never more than two preview sets visible', Math.max(...frames.map((s) => s.visSets)) <= 2, `max ${Math.max(...frames.map((s) => s.visSets))}`);
  ok('rapid clicks: never two descriptions visible at once', Math.max(...frames.map((s) => s.visDetails)) <= 1, `max ${Math.max(...frames.map((s) => s.visDetails))}`);
  const end = await p.evaluate(STATE);
  ok('rapid clicks: settles on the last choice with one set and one description', end.sel === 2 && end.visSets === 1 && end.visDetails === 1 && agree(end), JSON.stringify(end));
  await ctx.close();
}

/* 2. Clicking the preview mid-transition opens the project that was just selected. */
{
  const [ctx, p] = await open();
  await p.click('#tab-2'); await p.waitForTimeout(80);
  const box = await p.locator('#previews').boundingBox();
  await p.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.45);
  await p.waitForURL('**/work/**', { timeout: 5000 }).catch(() => {});
  ok('click during transition opens the selected project', p.url().endsWith(`/work/${SLUGS[2]}/`), p.url());
  await ctx.close();
}

/* 3. Hovering down the list does not change the selection or move the rows. */
{
  const [ctx, p] = await open();
  await p.click('#tab-0');
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#picker [role=tab]')].map((t) => Math.round(t.getBoundingClientRect().top)));
  const before = await rows();
  const b0 = await p.locator('#tab-0').boundingBox(), b3 = await p.locator('#tab-3').boundingBox();
  for (let y = b0.y + 5; y < b3.y + b3.height; y += 5) { await p.mouse.move(b0.x + 80, y); await p.waitForTimeout(12); }
  await p.waitForTimeout(500);
  ok('hover sweep: selection unchanged and rows stay put', (await sel(p)) === 0 && JSON.stringify(await rows()) === JSON.stringify(before));
  await ctx.close();
}

/* 4. Auto-advance rules. */
{
  const [ctx, p] = await open();
  await p.mouse.move(5, 895);
  const t0 = Date.now(); while ((await sel(p)) === 0 && Date.now() - t0 < 9000) await p.waitForTimeout(100);
  const vis = await p.evaluate(() => document.visibilityState);
  ok('auto-advance: moves on after 7 s untouched', (await sel(p)) === 1, `after ${Date.now() - t0 + 1400} ms, page ${vis}`);
  const pk = await p.locator('#picker').boundingBox();
  await p.mouse.move(pk.x + pk.width * 0.7, pk.y + 200);
  await p.waitForTimeout(9000);
  ok('auto-advance: holds while the pointer is over the project area', (await sel(p)) === 1);
  await p.mouse.move(5, 895);
  const tr = Date.now(); while ((await sel(p)) !== 2 && Date.now() - tr < 9500) await p.waitForTimeout(100);
  ok('auto-advance: resumes after the pointer leaves', (await sel(p)) === 2, `after ${Date.now() - tr} ms, page ${await p.evaluate(() => document.visibilityState + (document.hasFocus() ? ', focused' : ', not focused'))}`);
  await p.focus('#tab-2');
  await p.waitForTimeout(8500);
  ok('auto-advance: holds while focus is inside', (await sel(p)) === 2);
  await p.evaluate(() => document.activeElement.blur());
  await p.click('#tab-0'); await p.mouse.move(5, 895); await p.evaluate(() => document.activeElement.blur());
  await p.waitForTimeout(10000);
  const st = await p.evaluate(STATE);
  ok('auto-advance: a manual choice stops it for the session', st.sel === 0 && st.rotating === 'off', JSON.stringify(st));
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(8000);
  ok('auto-advance: stays off after reload in the same session', (await sel(p)) === 0);
  await ctx.close();
}
{
  const [ctx, p] = await open();
  await p.mouse.move(5, 895);
  await p.waitForTimeout(3000);
  await p.click('.dock [data-motion-toggle]'); await p.mouse.move(5, 895);
  const frozen = await p.evaluate(() => document.querySelector('#tab-0').style.getPropertyValue('--p'));
  await p.waitForTimeout(8000);
  const still = await p.evaluate(() => [document.querySelector('#tab-0').getAttribute('aria-selected'), document.querySelector('#tab-0').style.getPropertyValue('--p')]);
  ok('pause: stops auto-advance and freezes its progress', still[0] === 'true' && still[1] === frozen, `progress ${frozen} → ${still[1]}`);
  const live = await p.evaluate(() => document.getElementById('previews').classList.contains('is-live'));
  ok('pause: supporting-layer drift stops', live === false);
  await p.click('.dock [data-motion-toggle]'); await p.mouse.move(5, 895);
  const t = Date.now(); while ((await sel(p)) === 0 && Date.now() - t < 9000) await p.waitForTimeout(100);
  const took = Date.now() - t;
  const remaining = (1 - parseFloat(frozen)) * 7000;
  ok('resume: continues from where it paused, not a fresh 7 s', Math.abs(took - remaining) < 700, `expected ≈${Math.round(remaining)} ms, took ${took} ms`);
  await ctx.close();
}

/* 5. Return journey: preview click → case study → back; and the "All work" button. */
for (const how of ['browser back', 'All work button']) {
  const [ctx, p] = await open();
  await ctx.addInitScript(() => addEventListener('pagereveal', (e) => sessionStorage.setItem('vt-reveal', String(!!e.viewTransition))));
  await p.click('#tab-2'); await p.waitForTimeout(900);
  await p.mouse.wheel(0, 120); await p.waitForTimeout(400);
  const y0 = await p.evaluate(() => scrollY);
  const box = await p.locator('#previews').boundingBox();
  await p.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.45);
  await p.waitForURL(`**/work/${SLUGS[2]}/`); await p.waitForTimeout(900);
  if (how === 'browser back') await p.goBack(); else await p.click('[data-back]');
  await p.waitForURL(BASE + HOME); await p.waitForTimeout(1200);
  const st = await p.evaluate(STATE);
  const y1 = await p.evaluate(() => scrollY);
  const reveal = await p.evaluate(() => sessionStorage.getItem('vt-reveal'));
  ok(`return (${how}): selected project restored and consistent`, st.sel === 2 && agree(st), JSON.stringify(st));
  ok(`return (${how}): scroll position restored`, Math.abs(y1 - y0) < 4, `${y0} → ${y1}`);
  ok(`return (${how}): transition back to the preview ran`, reveal === 'true', String(reveal));
  await ctx.close();
}

/* 6. Resize across the breakpoint keeps the choice and leaves every control reachable. */
{
  const [ctx, p] = await open();
  await p.click('#tab-3'); await p.waitForTimeout(800);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
  const m = await p.evaluate(() => { const tr = document.getElementById('mtrack'); const c = tr.querySelectorAll('.mcard')[3]; const r = c.getBoundingClientRect(); return { pill: [...document.querySelectorAll('.mwork__pill')].findIndex((b) => b.getAttribute('aria-pressed') === 'true'), cardInView: r.left >= -1 && r.right <= innerWidth + 1, overflow: document.documentElement.scrollWidth - innerWidth }; });
  ok('resize to phone: same project shown and selected', m.pill === 3 && m.cardInView && m.overflow <= 0, JSON.stringify(m));
  await p.setViewportSize({ width: 1100, height: 800 }); await p.waitForTimeout(900);
  const d = await p.evaluate(STATE);
  const tabsVisible = await p.evaluate(() => [...document.querySelectorAll('#picker [role=tab]')].every((t) => { const r = t.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth; }));
  ok('resize back to desktop: preview and list agree, controls visible', d.sel === 3 && d.visSets === 1 && agree(d) && tabsVisible, JSON.stringify(d));
  await ctx.close();
}

/* 7. Keyboard only. */
{
  const [ctx, p] = await open();
  await p.focus('#tab-0');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  const k = await p.evaluate(() => ({ focus: document.activeElement.id, ring: getComputedStyle(document.activeElement).outlineStyle }));
  const st = await p.evaluate(STATE);
  ok('keyboard: arrows select and move focus with a visible ring', st.sel === 2 && k.focus === 'tab-2' && k.ring === 'solid' && agree(st), JSON.stringify(k));
  await p.keyboard.press('End');
  ok('keyboard: End selects the last project', (await sel(p)) === 3);
  await p.keyboard.press('Tab');
  const link = await p.evaluate(() => document.activeElement.getAttribute('href'));
  ok('keyboard: Tab moves to the selected project’s case-study link', link === `/work/${SLUGS[3]}/`, link);
  await p.keyboard.press('Enter'); await p.waitForURL(`**/work/${SLUGS[3]}/`);
  ok('keyboard: Enter opens it', p.url().endsWith(`/work/${SLUGS[3]}/`));
  await ctx.close();
}

/* 8. Phone touch: swipe the cards, tap pills, tap a link. */
{
  const [ctx, p] = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const cdp = await ctx.newCDPSession(p);
  await p.locator('#mtrack').scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const tb = await p.locator('#mtrack').boundingBox();
  await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(tb.x + tb.width * 0.7), y: Math.round(tb.y + 150), xDistance: -260, yDistance: 0, gestureSourceType: 'touch', speed: 900 });
  await p.waitForTimeout(900);
  const a = await p.evaluate(STATE);
  ok('phone: swiping to the next card selects it', a.pill === 1 && a.sel === 1, JSON.stringify({ pill: a.pill, sel: a.sel }));
  await p.tap('.mwork__pill[data-i="3"]'); await p.waitForTimeout(900);
  const b = await p.evaluate(() => { const tr = document.getElementById('mtrack'); const c = tr.querySelectorAll('.mcard')[3].getBoundingClientRect(); return { pill: [...document.querySelectorAll('.mwork__pill')].findIndex((x) => x.getAttribute('aria-pressed') === 'true'), left: Math.round(c.left), right: Math.round(c.right) }; });
  ok('phone: tapping pill 04 brings card 04 fully into view and selects it', b.pill === 3 && b.left >= 0 && b.right <= 391, JSON.stringify(b));
  const vScroll0 = await p.evaluate(() => scrollY);
  await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: Math.round(tb.y + 150), xDistance: 0, yDistance: -300, gestureSourceType: 'touch', speed: 900 });
  await p.waitForTimeout(600);
  ok('phone: a vertical swipe over the cards still scrolls the page', (await p.evaluate(() => scrollY)) > vScroll0 + 100);
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
  await p.locator('.mcard[data-i="3"] .mcard__links a').first().tap();
  await p.waitForURL(`**/work/${SLUGS[3]}/`);
  ok('phone: tapping the card’s case-study link opens that project', p.url().endsWith(`/work/${SLUGS[3]}/`));
  await ctx.close();
}

/* 9. Tablet touch: swipe the desktop previews. */
{
  const [ctx, p] = await open({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const cdp = await ctx.newCDPSession(p);
  const bx = await p.locator('#previews').boundingBox();
  const y = bx.y + bx.height * 0.5, x0 = bx.x + bx.width * 0.7, x1 = bx.x + bx.width * 0.2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * (k / 8), y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(900);
  const st = await p.evaluate(STATE);
  ok('tablet: swiping the previews selects the next project and stops rotation', st.sel === 1 && st.rotating === 'off' && agree(st), JSON.stringify(st));
  await ctx.close();
}

/* 10. Reduced motion: everything works, nothing animates. */
{
  const [ctx, p] = await open({ reducedMotion: 'reduce' });
  await p.click('#tab-3'); await p.waitForTimeout(150);
  const st = await p.evaluate(STATE);
  const running = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  ok('reduced motion: selection is immediate and consistent, nothing running', st.sel === 3 && st.visSets === 1 && st.visDetails === 1 && agree(st) && running === 0, JSON.stringify({ ...st, running }));
  await p.mouse.move(5, 895); await p.waitForTimeout(8000);
  ok('reduced motion: no auto-advance', (await sel(p)) === 3);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} interaction checks passed`);
process.exit(failed.length ? 1 : 0);
