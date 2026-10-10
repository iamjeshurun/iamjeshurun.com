// End-to-end checks against the built site served by `npm run preview` (default http://127.0.0.1:4321).
// Usage: npm run build && npm run preview & npm run check   [--external to also check outbound links]
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
const SITE = 'https://iamjeshurun.com';
const PAGES = ['/', '/work/internship-tracker/', '/work/campus-health/', '/work/insightpulse/', '/work/portfolio-risk/'];
// Public pages must show no phone number and no email address other than PUBLIC_EMAIL. Extra private terms (e.g. legal name) can be
// listed in scripts/private-terms.json, which is git-ignored so the terms themselves are never published.
const PRIVATE_TERMS = new URL('./private-terms.json', import.meta.url);
const PUBLIC_EMAIL = 'aoacheampong@stetson.edu';
const FORBIDDEN_TEXT = [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
  ...(existsSync(PRIVATE_TERMS) ? JSON.parse(readFileSync(PRIVATE_TERMS, 'utf8')).map((t) => new RegExp(t, 'i')) : [])];
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });

/* ---------- Routes and files ---------- */
{
  const ctx = await browser.newContext();
  const r = ctx.request;
  for (const p of PAGES) { const res = await r.get(BASE + p); ok(`route ${p}`, res.status() === 200, String(res.status())); }
  const nf = await r.get(BASE + '/does-not-exist/');
  ok('unknown path serves 404', nf.status() === 404 && (await nf.text()).includes('This page doesn’t exist'), String(nf.status()));
  const pdf = await r.get(BASE + '/resume.pdf');
  const same = Buffer.compare(Buffer.from(await pdf.body()), readFileSync(new URL('../public/resume.pdf', import.meta.url))) === 0;
  ok('résumé served unchanged as PDF', pdf.status() === 200 && /pdf/.test(pdf.headers()['content-type'] || '') && same);
  for (const f of ['/robots.txt', '/sitemap-index.xml', '/sitemap-0.xml', '/favicon.svg', '/og/home.png']) {
    const res = await r.get(BASE + f); ok(`file ${f}`, res.status() === 200, String(res.status()));
  }
  const sm = await (await r.get(BASE + '/sitemap-0.xml')).text();
  ok('sitemap lists every page on iamjeshurun.com', PAGES.every((p) => sm.includes(SITE + p)) && !sm.includes('404'));
  // `astro preview` doesn't serve extensionless files; Pages reads CNAME from the artifact.
  ok('dist/CNAME is iamjeshurun.com', readFileSync(new URL('../dist/CNAME', import.meta.url), 'utf8').trim() === 'iamjeshurun.com');
  await ctx.close();
}

/* ---------- Per-page structure, metadata, privacy, overflow ---------- */
const internal = new Set();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  for (const path of [...PAGES, '/404.html']) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (q) => errors.push('failed ' + q.url()));
    page.on('response', (s) => { if (s.status() >= 400 && s.url().startsWith(BASE)) errors.push(`${s.status()} ${s.url()}`); });
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    // Scroll through so lazy images load, then return.
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const heads = [...document.querySelectorAll('h1,h2,h3,h4')].filter((e) => e.offsetParent !== null || e.closest('[hidden]') === null).map((e) => +e.tagName[1]);
      let skip = false; for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) skip = true;
      return {
        title: document.title,
        canonical: q('link[rel=canonical]')?.href,
        ogImage: q('meta[property="og:image"]')?.content,
        description: q('meta[name=description]')?.content,
        h1: document.querySelectorAll('h1').length,
        headingSkip: skip,
        imgsNoAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
        brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').map((i) => i.currentSrc),
        overflow: document.documentElement.scrollWidth - innerWidth,
        text: document.body.innerText + ' ' + document.title + ' ' + (q('meta[name=description]')?.content || ''),
        links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
        smallText: [...document.querySelectorAll('p, li, a, span, dd, dt, small, button')].filter((e) => e.offsetParent && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length,
      };
    });
    const tag = `${path} @${w}`;
    if (w === 1440) {
      const expect = path === '/404.html' ? null : SITE + path;
      ok(`${tag} title/description`, /Jeshurun/.test(info.title) && !!info.description, info.title);
      if (expect) ok(`${tag} canonical`, info.canonical === expect, info.canonical);
      ok(`${tag} og:image absolute on domain`, (info.ogImage || '').startsWith(SITE + '/og/'), info.ogImage);
      ok(`${tag} one h1, no heading skips`, info.h1 === 1 && !info.headingSkip, `h1=${info.h1} skip=${info.headingSkip}`);
      ok(`${tag} every image has alt`, info.imgsNoAlt === 0, String(info.imgsNoAlt));
      const text = info.text.split(PUBLIC_EMAIL).join(' ');
      const leak = FORBIDDEN_TEXT.filter((re) => re.test(text)).map(String);
      ok(`${tag} public name only, no phone, only the published email`, leak.length === 0, leak.join(' '));
      info.links.filter((l) => l.startsWith(BASE)).forEach((l) => internal.add(l.split('#')[0]));
    }
    ok(`${tag} no horizontal overflow`, info.overflow <= 0, `${info.overflow}px`);
    ok(`${tag} no console/network errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    ok(`${tag} no text under 11px`, info.smallText === 0, String(info.smallText));
    ok(`${tag} images decode`, info.brokenImgs.length === 0, info.brokenImgs.slice(0, 2).join(' '));
    await page.close();
  }
  await ctx.close();
}
{
  const ctx = await browser.newContext();
  for (const l of internal) { const res = await ctx.request.get(l); ok(`internal link ${l.replace(BASE, '')}`, res.status() === 200, String(res.status())); }
  await ctx.close();
}

/* ---------- 200% text size ---------- */
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  for (const path of ['/', '/work/campus-health/']) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'html{font-size:200%!important}' });
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(`${path} @${w} at 200% text: no horizontal overflow`, over <= 0, `${over}px`);
  }
  await ctx.close();
}

/* Motion and interaction behaviour is covered in depth by scripts/interaction-check.mjs. */

/* ---------- Cross-document view transition: preview frame → case-study header ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    addEventListener('pageswap', (e) => {
      // Runs before the site's own handler, so read the paired element on the next task.
      setTimeout(() => {
        const named = [...document.querySelectorAll('[style*="view-transition-name"]')].map((el) => el.dataset.slug);
        sessionStorage.setItem('vt-swap', JSON.stringify({ vt: !!e.viewTransition, named }));
      }, 0);
    });
    addEventListener('pagereveal', (e) => { sessionStorage.setItem('vt-reveal', String(!!e.viewTransition)); });
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.mouse.move(5, 890);
  await page.click('.pset[data-pos="active"] .layer__open');
  await page.waitForURL('**/work/insightpulse/');
  await page.waitForTimeout(1200);
  const swap = JSON.parse(await page.evaluate(() => sessionStorage.getItem('vt-swap')) || '{}');
  const reveal = await page.evaluate(() => sessionStorage.getItem('vt-reveal'));
  ok('view transition runs and pairs the focal frame', swap.vt === true && swap.named?.[0] === 'insightpulse' && reveal === 'true', JSON.stringify({ swap, reveal }));
  await page.goBack(); await page.waitForTimeout(1200);
  ok('back navigation returns to the homepage', new URL(page.url()).pathname === '/');
  await ctx.close();
}

/* ---------- Optional: outbound links ---------- */
if (process.argv.includes('--external')) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const ext = new Set(await page.evaluate(() => [...document.querySelectorAll('a[href^="http"]')].map((a) => a.href)));
  for (const p of PAGES.slice(1)) { await page.goto(BASE + p); (await page.evaluate(() => [...document.querySelectorAll('a[href^="http"]')].map((a) => a.href))).forEach((l) => ext.add(l)); }
  for (const l of ext) {
    let s = 0; try { s = (await ctx.request.get(l, { timeout: 20000, maxRedirects: 5 })).status(); } catch (e) { s = 0; }
    const linkedin = /linkedin\.com/.test(l);
    ok(`external ${l}`, s === 200 || (linkedin && s === 999), linkedin && s === 999 ? '999 (LinkedIn blocks automated requests)' : String(s));
  }
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
