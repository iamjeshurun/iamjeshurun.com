// Motion state, pause control, spring, visibility gating and navigation shared by every page.

const root = document.documentElement;
const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
const listeners = new Set<() => void>();
let paused = false;
try { paused = localStorage.getItem('motion') === 'paused'; } catch { /* storage unavailable */ }

export const motion = {
  get reduced() { return reducedMQ.matches; },
  get paused() { return paused; },
  /** Sustained or automatic motion may run only while this is true. */
  get active() { return !reducedMQ.matches && !paused && !document.hidden; },
  on(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
};
const emit = () => listeners.forEach((fn) => fn());

function syncMotionAttr() {
  root.dataset.motion = reducedMQ.matches ? 'reduced' : paused ? 'paused' : 'on';
  document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]').forEach((b) => {
    b.setAttribute('aria-pressed', String(paused));
    const label = b.querySelector('[data-label]');
    if (label) label.textContent = paused ? 'Play motion' : 'Pause motion';
    b.hidden = reducedMQ.matches; // nothing sustained runs under reduced motion
  });
}
reducedMQ.addEventListener('change', () => { syncMotionAttr(); emit(); });
document.addEventListener('visibilitychange', emit);
document.querySelectorAll('[data-motion-toggle]').forEach((b) =>
  b.addEventListener('click', () => {
    paused = !paused;
    try { localStorage.setItem('motion', paused ? 'paused' : 'on'); } catch { /* ignore */ }
    syncMotionAttr(); emit();
  }));
syncMotionAttr();

/** Critically-damped-ish spring: stiffness 170, damping 26 → ~2% overshoot, settles ≈ 600ms. */
export function spring(opts: { from: number[]; to: number[]; stiffness?: number; damping?: number; onUpdate: (v: number[]) => void; onDone?: () => void }) {
  const { from, to, stiffness = 170, damping = 26, onUpdate, onDone } = opts;
  const x = from.slice(), v = new Array(from.length).fill(0);
  let last = performance.now(), raf = 0;
  const step = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    let moving = false;
    for (let i = 0; i < x.length; i++) {
      v[i] += (-stiffness * (x[i] - to[i]) - damping * v[i]) * dt;
      x[i] += v[i] * dt;
      if (Math.abs(v[i]) > 0.001 || Math.abs(x[i] - to[i]) > 0.001) moving = true;
    }
    onUpdate(x);
    if (moving) raf = requestAnimationFrame(step);
    else { onUpdate(to.slice()); onDone?.(); }
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** Calls start/stop so loops run only while el is on screen, the tab is visible and motion is on. */
export function whileVisible(el: Element, start: () => void, stop: () => void) {
  let onScreen = false, running = false;
  const sync = () => {
    const want = onScreen && motion.active;
    if (want && !running) { running = true; start(); }
    else if (!want && running) { running = false; stop(); }
  };
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { threshold: 0.05 }).observe(el);
  motion.on(sync);
}

/* ---------- Dock: active section indicator ---------- */
const links = [...document.querySelectorAll<HTMLAnchorElement>('.nav__links a')];
const pill = document.querySelector<HTMLElement>('.nav__pill');
function setActive(a: HTMLAnchorElement | null | undefined) {
  links.forEach((l) => l.toggleAttribute('aria-current', l === a));
  if (!pill) return;
  if (!a) { pill.style.opacity = '0'; return; }
  pill.style.opacity = '1';
  pill.style.width = a.offsetWidth + 'px';
  pill.style.transform = `translateX(${a.offsetLeft}px)`;
}
const fixed = links.find((l) => l.dataset.current === 'true');
if (fixed) setActive(fixed);
else {
  const sections = links.map((l) => document.getElementById(l.dataset.section || '')).filter(Boolean) as HTMLElement[];
  const update = () => {
    const mid = innerHeight * 0.45;
    const hit = sections.find((s) => { const r = s.getBoundingClientRect(); return r.top < mid && r.bottom > mid; });
    setActive(links.find((l) => l.dataset.section === hit?.id));
  };
  let raf = 0;
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); }, { passive: true });
  addEventListener('resize', update);
  update();
}

/* ---------- "All work" from a case study: go back when we came from the homepage ---------- */
// History navigation restores the exact scroll position and the selected project; a fresh link would not.
document.querySelectorAll<HTMLAnchorElement>('[data-back]').forEach((a) => a.addEventListener('click', (e) => {
  const ref = document.referrer ? new URL(document.referrer) : null;
  if (ref && ref.origin === location.origin && ref.pathname === '/' && history.length > 1) { e.preventDefault(); history.back(); }
}));
