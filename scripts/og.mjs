// Renders 1200×630 social-sharing images into public/og/ with the site's own fonts and screenshots.
// Usage: npm run og   (needs Google Chrome installed; uses playwright-core with channel "chrome")
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
// Assets are inlined as data URIs: a page created with setContent cannot load file:// URLs.
const dataUri = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;
const font = (pkg, file) => dataUri(join(root, 'node_modules/@fontsource-variable', pkg, 'files', file), 'font/woff2');
const shot = (name) => dataUri(join(root, 'src/assets/shots', name), 'image/webp');
const field = (yaml, key) => JSON.parse(yaml.match(new RegExp(`^${key}: (".*")$`, 'm'))[1]);

const css = `
@font-face { font-family: G; src: url(${font('geist', 'geist-latin-wght-normal.woff2')}); font-weight: 100 900; }
@font-face { font-family: M; src: url(${font('geist-mono', 'geist-mono-latin-wght-normal.woff2')}); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; background: #0d0e10; color: #f1f3f6; font-family: G; overflow: hidden; position: relative; }
.copy { position: absolute; left: 64px; top: 64px; width: 530px; }
.k { font: 500 18px M; color: #a596ff; letter-spacing: .04em; text-transform: uppercase; }
h1 { font-family: G; font-weight: 750; letter-spacing: -0.06em; line-height: .9; margin: 22px 0 22px; }
p { font-size: 26px; line-height: 1.3; color: #bcc2cc; }
.foot { position: absolute; left: 64px; bottom: 56px; font: 500 20px M; color: #959ca8; display: flex; gap: 12px; align-items: center; }
.foot i { width: 12px; height: 12px; border-radius: 4px; background: #a596ff; display: block; }
.stage { position: absolute; left: 600px; top: 70px; width: 760px; perspective: 1600px; }
.f { position: absolute; width: 640px; border-radius: 16px; overflow: hidden; border: 1px solid rgba(236,240,247,.2); box-shadow: 0 30px 60px -20px #000; transform: rotateY(-10deg); }
.f img { width: 100%; display: block; aspect-ratio: 16/10; object-fit: cover; object-position: top; }
.f.back { top: -30px; left: 120px; opacity: .45; transform: rotateY(-10deg) translateZ(-300px); }
.f.front { top: 90px; left: 0; }`;

const page = ({ kicker, title, size, line, front, back }) => `<!doctype html><html><head><style>${css}</style></head><body>
<div class="stage"><div class="f back"><img src="${back}"></div><div class="f front"><img src="${front}"></div></div>
<div class="copy"><div class="k">${kicker}</div><h1 style="font-size:${size}px">${title}</h1><p>${line}</p></div>
<div class="foot"><i></i>iamjeshurun.com</div></body></html>`;

const outDir = join(root, 'public/og');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 } });
const p = await ctx.newPage();
async function render(name, opts) {
  await p.setContent(page(opts), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('og/' + name + '.png');
}
await render('home', {
  kicker: 'Computer science & public health · Stetson', title: 'Jeshurun', size: 132,
  line: 'I build cool things.',
  front: shot('insight-0.webp'), back: shot('risk-0.webp'),
});
const keys = { 'internship-tracker': 'tracker', 'campus-health': 'shs', insightpulse: 'insight', 'portfolio-risk': 'risk' };
for (const file of readdirSync(join(root, 'src/content/work'))) {
  const slug = file.replace('.yaml', '');
  const y = readFileSync(join(root, 'src/content/work', file), 'utf8');
  const name = field(y, 'name');
  await render(slug, {
    kicker: `Case study · ${field(y, 'kind')}`, title: name, size: name.length > 24 ? 60 : 84,
    line: field(y, 'headline'),
    front: shot(`${keys[slug]}-0.webp`), back: shot(`${keys[slug]}-1.webp`),
  });
}
await browser.close();
