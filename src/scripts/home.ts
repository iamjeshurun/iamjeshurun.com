// Homepage behaviour. Selection *state* is rendered by the inline script in index.astro
// (window.__jshSel.render), which only flips attributes; every visual change is a CSS transition
// on that state. Interrupted or rapid changes therefore retarget instead of queuing timers.
import { motion, whileVisible } from './core';

declare global {
  interface Window { __jshSel: { render(i: number): void; get(): number } }
}

const DWELL = 7000; // ms per project while auto-advancing

export function initHome() {
  const sel = window.__jshSel;
  const picker = document.getElementById('picker')!;
  const previews = document.getElementById('previews')!;
  const tilt = document.getElementById('tilt')!;
  const tabs = [...picker.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const N = tabs.length;
  const mq = matchMedia('(min-width: 900px)');

  /* ---------- Rotation rules ----------
     • Runs only until the visitor makes a choice; after that it stays off for the session.
     • Holds while the pointer is over, focus is inside, or a finger is on the project area.
     • Runs only on screen, in a visible tab, with motion on; Pause keeps the elapsed time. */
  let chosen = false;
  try { chosen = sessionStorage.getItem('jsh-chosen') === '1'; } catch { /* ignore */ }
  let rotating = !chosen && !motion.reduced;
  let elapsed = 0, last = 0, raf = 0;
  let pointerIn = false, focusIn = false;
  const hold = () => pointerIn || focusIn;
  const syncRotatingAttr = () => (picker.dataset.rotating = rotating ? 'on' : 'off');
  syncRotatingAttr();

  function stopRotation() {
    if (!rotating) return;
    rotating = false; syncRotatingAttr();
    tabs.forEach((t) => t.style.removeProperty('--p'));
    try { sessionStorage.setItem('jsh-chosen', '1'); } catch { /* ignore */ }
  }

  // Any explicit choice made elsewhere (e.g. the optional Spatial view) also ends rotation.
  document.addEventListener('jsh:user-choice', stopRotation);

  function choose(i: number, by: 'user' | 'auto') {
    i = ((i % N) + N) % N;
    if (by === 'user') stopRotation();
    if (i === sel.get()) return;
    tabs[sel.get()].style.removeProperty('--p');
    sel.render(i);
    elapsed = 0;
    if (by === 'user') syncCarousel(i, true);
  }

  function tick(now: number) {
    const dt = last ? Math.min(100, now - last) : 0; last = now;
    if (rotating) {
      if (!hold()) elapsed += dt;
      tabs[sel.get()].style.setProperty('--p', String(Math.min(1, elapsed / DWELL)));
      if (elapsed >= DWELL) choose(sel.get() + 1, 'auto');
    }
    raf = requestAnimationFrame(tick);
  }
  whileVisible(picker, () => { last = 0; raf = requestAnimationFrame(tick); }, () => cancelAnimationFrame(raf));

  // While the visitor works with the projects, the supporting layers' drift pauses in place (no jump).
  const settle = () => previews.classList.toggle('is-settled', hold());
  picker.addEventListener('pointerenter', () => { pointerIn = true; settle(); });
  picker.addEventListener('pointerleave', () => { pointerIn = false; settle(); });
  picker.addEventListener('focusin', () => { focusIn = true; settle(); });
  picker.addEventListener('focusout', (e) => { focusIn = picker.contains(e.relatedTarget as Node); settle(); });

  /* ---------- Input: click/tap, keyboard, touch swipe on the previews ---------- */
  tabs.forEach((t, i) => t.addEventListener('click', () => choose(i, 'user')));
  picker.querySelector('[role="tablist"]')!.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[ev.key];
    let to: number | null = step ? sel.get() + step : null;
    if (ev.key === 'Home') to = 0;
    if (ev.key === 'End') to = N - 1;
    if (to === null) return;
    ev.preventDefault();
    choose(to, 'user');
    tabs[sel.get()].focus();
  });
  let sx: number | null = null, sy = 0;
  previews.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
  previews.addEventListener('pointercancel', () => (sx = null));
  previews.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) choose(sel.get() + (dx < 0 ? 1 : -1), 'user');
  });

  /* ---------- Depth: supporting layers drift; the scene leans slightly toward the pointer ---------- */
  whileVisible(previews, () => previews.classList.add('is-live'), () => previews.classList.remove('is-live'));
  if (matchMedia('(pointer: fine)').matches) {
    let tx = 0, ty = 0, cx = 0, cy = 0, praf = 0;
    const loop = () => {
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
      tilt.style.setProperty('--px', cx.toFixed(3)); tilt.style.setProperty('--py', cy.toFixed(3));
      praf = Math.abs(tx - cx) > 0.005 || Math.abs(ty - cy) > 0.005 ? requestAnimationFrame(loop) : 0;
    };
    previews.addEventListener('pointermove', (e) => {
      if (!motion.active) return;
      const r = previews.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 4; // at most ±2°
      ty = -((e.clientY - r.top) / r.height - 0.5) * 3;
      if (!praf) praf = requestAnimationFrame(loop);
    });
    previews.addEventListener('pointerleave', () => { tx = 0; ty = 0; if (!praf) praf = requestAnimationFrame(loop); });
    motion.on(() => {
      if (motion.active) return;
      cancelAnimationFrame(praf); praf = 0; tx = ty = cx = cy = 0;
      tilt.style.removeProperty('--px'); tilt.style.removeProperty('--py');
    });
  }

  /* ---------- Phone: native scroll-snap cards; pills jump, scrolling selects ---------- */
  const track = document.getElementById('mtrack')!;
  const cards = [...track.querySelectorAll<HTMLElement>('.mcard')];
  const pills = [...document.querySelectorAll<HTMLButtonElement>('.mwork__pill')];
  let programmatic = 0;
  function syncCarousel(i: number, animate: boolean) {
    if (mq.matches) return;
    const left = cards[i].offsetLeft - parseFloat(getComputedStyle(track).paddingLeft);
    programmatic = performance.now();
    track.scrollTo({ left, behavior: animate && !motion.reduced ? 'smooth' : 'auto' });
  }
  pills.forEach((p, i) => p.addEventListener('click', () => choose(i, 'user')));
  // The card that is mostly in view is the selected project, so pills, card and storage always agree.
  const ratios = new Map<Element, number>();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
    if (mq.matches) return;
    let best = -1, bestR = 0;
    cards.forEach((c, i) => { const r = ratios.get(c) || 0; if (r > bestR) { bestR = r; best = i; } });
    if (best < 0 || bestR < 0.6 || best === sel.get()) return;
    // During a pill-triggered smooth scroll, cards passing through must not steal the selection.
    if (performance.now() - programmatic < 700) return;
    stopRotation();
    sel.render(best);
  }, { root: track, threshold: [0, 0.6, 0.9, 1] });
  cards.forEach((c) => io.observe(c));
  syncCarousel(sel.get(), false); // a returning visitor sees their card
  mq.addEventListener('change', () => syncCarousel(sel.get(), false));

  /* ---------- Opening sequence (≤1.2 s; nothing waits on it) ----------
     0–520ms    masthead letters rise from the baseline, 34 ms apart
     160ms      introduction fades in
     220–370ms  index rows slide in 12 px, 50 ms apart
     300ms      previews rise 80 px into their tilt (900 ms)
     Skipped for reduced motion, when returning from a case study, or when the page opens scrolled. */
  const ref = document.referrer ? new URL(document.referrer) : null;
  const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const returning = navEntry?.type === 'back_forward' || (!!ref && ref.origin === location.origin && ref.pathname.startsWith('/work/'));
  // Also skipped when the page loads hidden (e.g. a background tab): animations can stall there while
  // timers keep running, so there is nothing to see and nothing to get out of step.
  if (!motion.reduced && !returning && scrollY < 40 && !document.hidden) {
    const ease = 'cubic-bezier(.22,1,.36,1)';
    const mast = document.querySelector<HTMLElement>('.mast__word')!;
    mast.style.overflow = 'hidden';
    const letters = [...mast.querySelectorAll('.ch')].map((c, k) => c.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 760, delay: k * 34, easing: ease, fill: 'backwards' }));
    // Unclip only when the letters have actually arrived, never on a timer that can outrun a paused animation.
    Promise.all(letters.map((a) => a.finished)).then(() => (mast.style.overflow = ''), () => (mast.style.overflow = ''));
    document.querySelector('[data-enter="lead"]')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 160, fill: 'backwards' });
    tabs.forEach((t, k) => t.animate([{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 220 + k * 50, easing: ease, fill: 'backwards' }));
    picker.querySelector('.previews__enter')?.animate([{ opacity: 0, transform: 'translateY(80px)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 300, easing: ease, fill: 'backwards' });
    document.getElementById('mwork')?.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 260, easing: ease, fill: 'backwards' });
  }

  /* ---------- Selected Work: screens flatten as they arrive; the index follows the reader ---------- */
  const shots = [...document.querySelectorAll<HTMLElement>('.panel__shot .frame')];
  const panels = [...document.querySelectorAll<HTMLElement>('.panel')];
  const asideLinks = [...document.querySelectorAll<HTMLAnchorElement>('.work__aside a')];
  let sraf = 0;
  function onScroll() {
    sraf = 0;
    const vh = innerHeight;
    for (const f of shots) {
      const r = f.parentElement!.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue;
      const p = motion.reduced ? 1 : Math.max(0, Math.min(1, (vh - r.top) / (vh * 0.7)));
      const e = 1 - Math.pow(1 - p, 3);
      f.style.transform = `rotateX(${((1 - e) * 20).toFixed(2)}deg) translateY(${((1 - e) * 36).toFixed(1)}px) scale(${(0.94 + 0.06 * e).toFixed(4)})`;
      f.style.opacity = (0.4 + 0.6 * e).toFixed(3);
    }
    const cur = panels.findIndex((el) => { const r = el.getBoundingClientRect(); return r.top < vh * 0.5 && r.bottom > vh * 0.5; });
    asideLinks.forEach((a, k) => a.toggleAttribute('aria-current', k === cur));
  }
  addEventListener('scroll', () => { if (!sraf) sraf = requestAnimationFrame(onScroll); }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();
}
