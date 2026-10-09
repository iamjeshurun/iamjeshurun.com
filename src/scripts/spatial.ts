// Spatial view controller: the single owner of the active project, pointer interaction, camera position,
// entering/leaving the mode and opening a project.
//
// States
//   closed   — dialog shut; no listeners, timers or frames exist
//   idle     — camera at rest; CSS positions the world (no inline transform)
//   pressed  — pointer down, under the drag threshold (may still become a click)
//   dragging — pointer captured; camera follows the pointer (rubber-banded at the edges)
//   settling — spring carries the camera to the active project; any input interrupts it in place
//   opening  — navigating to a case study; input ignored, camera frozen
//
// Ownership: the camera transform on #sp-world belongs to this file (inline while moving, CSS at rest).
// Card emphasis, entrance and drift are CSS/WAAPI on other elements, so no property has two writers.
// Self-contained on purpose: importing shared modules would make Vite split a chained chunk (see site.ts).

import { createWheelGestures, normaliseDelta } from './wheel-gestures';

type State = 'closed' | 'idle' | 'pressed' | 'dragging' | 'settling' | 'opening';
type Vec = { x: number; y: number };
declare global { interface Window { __jshSel?: { render(i: number): void; get(): number } } }

const DRAG_THRESHOLD = { mouse: 6, pen: 6, touch: 10 } as Record<string, number>;
const STIFFNESS = 140;
const DAMPING = 2 * 0.92 * Math.sqrt(STIFFNESS); // slightly under-damped: settles without visible bounce
const RUBBER = 0.35;
// Limits keep long journeys and mid-flight retargets smooth: the spring decides direction, these decide feel.
const MAX_ACCEL = 14000; // px/s²
const MAX_SPEED = 3600;  // px/s

export function initSpatial() {
  const dlg = document.getElementById('spatial') as HTMLDialogElement | null;
  if (!dlg) return;
  const stage = dlg.querySelector<HTMLElement>('#sp-stage')!;
  const world = dlg.querySelector<HTMLElement>('#sp-world')!;
  const clusters = [...world.querySelectorAll<HTMLElement>('.sp-cluster')];
  const picks = [...dlg.querySelectorAll<HTMLButtonElement>('.sp-pick')];
  const openLink = dlg.querySelector<HTMLAnchorElement>('#sp-open')!;
  const demoLink = dlg.querySelector<HTMLAnchorElement>('#sp-demo')!;
  const nowName = dlg.querySelector<HTMLElement>('#sp-now')!;
  const launch = document.getElementById('spatial-launch') as HTMLButtonElement | null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const N = clusters.length;

  let state: State = 'closed';
  let active = 0, entry = 0;
  let centers: Vec[] = [];
  let bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let cam: Vec = { x: 0, y: 0 }, vel: Vec = { x: 0, y: 0 }, target: Vec = { x: 0, y: 0 };
  let inline = false;           // is the camera currently JS-positioned?
  let raf = 0, gen = 0;         // spring loop + generation token (bumped to invalidate loops/callbacks)
  let writeRaf = 0;             // batched camera write while dragging
  let session: AbortController | null = null;
  let timers: number[] = [];
  let press: { id: number; type: string; x0: number; y0: number; cam0: Vec; samples: { t: number; x: number; y: number }[] } | null = null;
  let suppressClick = false;
  const gestures = createWheelGestures();
  // Input log: every wheel/key/pointer decision with its reason (ring buffer; ?debug=input shows it on screen).
  type Entry = { t: number; kind: string; d?: number; action: string; reason: string; gesture?: number; active: number };
  const inputLog: Entry[] = [];
  const debug = new URLSearchParams(location.search).get('debug') === 'input';
  let debugPanel: HTMLElement | null = null;
  function record(e: Omit<Entry, 'active'>) {
    const entry = { ...e, t: Math.round(e.t), active };
    inputLog.push(entry); if (inputLog.length > 800) inputLog.shift();
    if (debugPanel) renderDebug();
  }
  let savedScroll = 0;
  let exitAnim: Animation | null = null;

  const setState = (s: State) => { state = s; dlg.dataset.state = s; };
  // Opt-in instrumentation: tests set window.__spTrace = [] to record the spring's own steps.
  let trace: number[][] | undefined;
  Object.defineProperty(window, '__spTrace', { configurable: true, set: (v) => { trace = v; }, get: () => trace });
  const later = (fn: () => void, ms: number) => { const g = gen; const t = window.setTimeout(() => { if (g === gen) fn(); }, ms); timers.push(t); return t; };

  /* ---------- Geometry (measured only on open and resize, never per pointer move) ---------- */
  function measure() {
    centers = clusters.map((c) => ({ x: c.offsetLeft, y: c.offsetTop })); // left/top are the card centres
    const w = stage.clientWidth, h = stage.clientHeight;
    const xs = centers.map((c) => c.x), ys = centers.map((c) => c.y);
    bounds = { minX: Math.min(...xs) - w * 0.3, maxX: Math.max(...xs) + w * 0.3, minY: Math.min(...ys) - h * 0.3, maxY: Math.max(...ys) + h * 0.3 };
  }
  const rub = (v: number, lo: number, hi: number) => (v < lo ? lo - (lo - v) * RUBBER : v > hi ? hi + (v - hi) * RUBBER : v);

  /* ---------- Camera: the only writer of #sp-world's transform ---------- */
  function writeCam() { inline = true; world.style.transform = `translate3d(${(-cam.x).toFixed(2)}px, ${(-cam.y).toFixed(2)}px, 0)`; }
  function restCam() {
    // Hand the camera back to CSS: identical position, but now resize-proof and script-free.
    world.style.setProperty('--ax', clusters[active].dataset.ux!);
    world.style.setProperty('--ay', clusters[active].dataset.uy!);
    world.style.removeProperty('transform');
    inline = false;
    cam = { ...centers[active] }; vel = { x: 0, y: 0 };
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    if (writeRaf) cancelAnimationFrame(writeRaf);
    raf = 0; writeRaf = 0; gen++;
  }
  function runSpring() {
    setState('settling');
    if (raf) return; // already running: the new target is picked up mid-flight, velocity preserved
    const g = gen;
    let last = performance.now();
    const step = (now: number) => {
      if (g !== gen) return; // an obsolete loop never writes
      const dt = Math.min(0.032, (now - last) / 1000); last = now;
      let ax = -STIFFNESS * (cam.x - target.x) - DAMPING * vel.x;
      let ay = -STIFFNESS * (cam.y - target.y) - DAMPING * vel.y;
      const am = Math.hypot(ax, ay);
      if (am > MAX_ACCEL) { ax *= MAX_ACCEL / am; ay *= MAX_ACCEL / am; }
      vel.x += ax * dt; vel.y += ay * dt;
      const vm = Math.hypot(vel.x, vel.y);
      if (vm > MAX_SPEED) { vel.x *= MAX_SPEED / vm; vel.y *= MAX_SPEED / vm; }
      cam.x += vel.x * dt; cam.y += vel.y * dt;
      writeCam();
      trace?.push([now, cam.x, cam.y, dt]); // opt-in test instrumentation (see spatial-check.mjs)
      if (Math.hypot(cam.x - target.x, cam.y - target.y) < 0.4 && Math.hypot(vel.x, vel.y) < 6) {
        raf = 0; restCam(); setState('idle'); return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /* ---------- Selection: every visible statement of "which project" is updated here, together ---------- */
  function select(i: number, how: 'instant' | 'animate', fling?: Vec) {
    if (state === 'opening' || state === 'closed') return;
    i = Math.max(0, Math.min(N - 1, i));
    const from = active;
    active = i;
    clusters.forEach((c, k) => c.classList.toggle('is-active', k === i));
    picks.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    const p = picks[i];
    openLink.href = `/work/${p.dataset.slug}/`;
    demoLink.href = p.dataset.demo!;
    nowName.textContent = p.dataset.name!;
    world.style.setProperty('--ax', clusters[i].dataset.ux!);
    world.style.setProperty('--ay', clusters[i].dataset.uy!);
    target = { ...centers[i] };
    // Hidden documents get no animation frames: move instantly rather than leave a spring that never runs.
    if (how === 'instant' || reduced.matches || document.hidden) { stopLoop(); restCam(); setState('idle'); return; }
    if (!inline) { cam = { ...centers[from] }; vel = { x: 0, y: 0 }; writeCam(); }
    if (fling) vel = { ...fling };
    runSpring();
  }

  /* ---------- Pointer: click vs drag, capture, cancellation ---------- */
  function endPress() {
    if (!press) return;
    try { if (stage.hasPointerCapture(press.id)) stage.releasePointerCapture(press.id); } catch { /* already released */ }
    press = null;
    stage.classList.remove('is-dragging');
  }
  function nearest(p: Vec) {
    let best = 0, d = Infinity;
    centers.forEach((c, k) => { const dd = Math.hypot(c.x - p.x, c.y - p.y); if (dd < d) { d = dd; best = k; } });
    return best;
  }
  function releaseVelocity(): Vec {
    if (!press) return { x: 0, y: 0 };
    const s = press.samples, now = s[s.length - 1];
    const old = s.find((q) => now.t - q.t <= 90) || s[0];
    const dt = (now.t - old.t) / 1000;
    if (dt <= 0.008) return { x: 0, y: 0 };
    return { x: (now.x - old.x) / dt, y: (now.y - old.y) / dt };
  }
  function onPointerDown(e: PointerEvent) {
    if (state === 'opening' || state === 'closed' || press) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressClick = false;
    if (state === 'settling') { stopLoop(); vel = { x: 0, y: 0 }; } // catch the moving camera where it is
    press = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, cam0: { ...cam }, samples: [{ t: e.timeStamp, x: cam.x, y: cam.y }] };
    setState('pressed');
  }
  function onPointerMove(e: PointerEvent) {
    if (press && state === 'pressed' && e.pointerType === 'mouse') clearStalePress(e, 'pointer moved');
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x0, dy = e.clientY - press.y0;
    if (state === 'pressed') {
      if (Math.hypot(dx, dy) < (DRAG_THRESHOLD[press.type] ?? 6)) return;
      setState('dragging');
      stage.classList.add('is-dragging');
      try { stage.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      if (!inline) writeCam();
    }
    if (state !== 'dragging') return;
    cam = { x: rub(press.cam0.x - dx, bounds.minX, bounds.maxX), y: rub(press.cam0.y - dy, bounds.minY, bounds.maxY) };
    press.samples.push({ t: e.timeStamp, x: cam.x, y: cam.y });
    if (press.samples.length > 12) press.samples.shift();
    if (!writeRaf) { const g = gen; writeRaf = requestAnimationFrame(() => { writeRaf = 0; if (g === gen && state === 'dragging') writeCam(); }); }
  }
  function onPointerUp(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    if (state === 'dragging') {
      const v = releaseVelocity();
      endPress();
      suppressClick = true; // the click that follows a real drag must not open or select anything
      const projected = { x: cam.x + v.x * 0.18, y: cam.y + v.y * 0.18 };
      const to = nearest(projected);
      select(to, 'animate', reduced.matches ? undefined : { x: v.x * 0.6, y: v.y * 0.6 });
      record({ t: e.timeStamp, kind: 'pointer', action: 'step', reason: `drag released → nearest project 0${to + 1}` });
      return;
    }
    // A click (under threshold). The click handler decides; if the camera was caught mid-flight, finish the move.
    endPress();
    setState(inline ? 'settling' : 'idle');
    if (inline) runSpring();
  }
  function onPointerAbort(e: PointerEvent) {
    // pointercancel, or capture lost without a pointerup (e.g. the OS took the gesture).
    if (!press || e.pointerId !== press.id) return;
    const dragging = state === 'dragging';
    endPress();
    if (dragging) { suppressClick = true; select(nearest(cam), 'animate'); }
    else if (inline) runSpring(); else setState('idle');
  }

  /* ---------- Clicks: front card opens, other cards come to the front ---------- */
  function beginOpening(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab/window: stay put
    stopLoop();
    setState('opening');
    clusters.forEach((c) => c.querySelector<HTMLElement>('.sp-card .frame')!.style.viewTransitionName = '');
    clusters[active].querySelector<HTMLElement>('.sp-card .frame')!.style.viewTransitionName = 'shot';
    history.replaceState({ ...(history.state || {}), spatial: { open: true, sel: active } }, '');
    // If navigation never happens (blocked, offline), become usable again rather than freezing.
    later(() => { if (state === 'opening' && !document.hidden) { setState('idle'); if (inline) runSpring(); } }, 4000);
  }
  function onClickCapture(e: MouseEvent) {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; return; }
    if (state === 'opening') { e.preventDefault(); return; }
    const hit = (e.target as Element).closest<HTMLAnchorElement>('.sp-card__hit');
    if (!hit) return;
    const i = Number(hit.dataset.i);
    if (i !== active) { e.preventDefault(); select(i, 'animate'); return; }
    beginOpening(e);
  }

  /* ---------- Keyboard, wheel, controls ---------- */
  function onKey(e: KeyboardEvent) {
    if (state === 'opening') return;
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    let to: number | null = step !== undefined ? active + step : null;
    if (e.key === 'Home') to = 0;
    if (e.key === 'End') to = N - 1;
    if (to === null) return;
    e.preventDefault();
    if (press) { record({ t: e.timeStamp, kind: 'key', action: 'ignore', reason: `${e.key}: pointer held down` }); return; } // keyboard does not fight an active pointer
    const clamped = Math.max(0, Math.min(N - 1, to));
    if (clamped === active) { nudge(Math.sign(to - active) || 0); record({ t: e.timeStamp, kind: 'key', action: 'boundary', reason: `${e.key}: already at the ${to < 0 ? 'first' : 'last'} project` }); return; }
    select(to, 'animate');
    record({ t: e.timeStamp, kind: 'key', action: 'step', reason: `${e.key} → 0${active + 1}` });
    if ((document.activeElement as HTMLElement)?.classList.contains('sp-pick')) picks[active].focus();
  }
  function clearStalePress(e: { buttons: number }, why: string) {
    // A press whose release never reached us (button let go outside the window) must not block input.
    if (!press || e.buttons !== 0 || press.type === 'touch') return;
    record({ t: performance.now(), kind: 'pointer', action: 'reset', reason: `stale press cleared (${why}, no button down)` });
    endPress();
    if (inline) runSpring(); else setState('idle');
  }
  function nudge(dir: number) {
    // At the first/last project: a short bounce instead of silence, so the input visibly registered.
    if (reduced.matches || document.hidden) return;
    if (!inline) { cam = { ...centers[active] }; writeCam(); }
    vel = { x: vel.x + dir * 650, y: vel.y };
    runSpring();
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault(); // also keeps horizontal swipes from triggering browser back/forward
    const d = normaliseDelta(e.deltaX, e.deltaY, e.deltaMode, stage.clientHeight);
    clearStalePress(e, 'wheel');
    if (press) { record({ t: e.timeStamp, kind: 'wheel', d, action: 'ignore', reason: 'pointer held down (dragging)' }); return; }
    if (state === 'opening') { record({ t: e.timeStamp, kind: 'wheel', d, action: 'ignore', reason: 'opening a project' }); return; }
    const r = gestures.classify(e.timeStamp, d);
    if (r.action === 'step') {
      const to = active + r.dir;
      if (to < 0 || to >= N) { nudge(r.dir); record({ t: r.t, kind: 'wheel', d, gesture: r.gesture, action: 'boundary', reason: `already at the ${to < 0 ? 'first' : 'last'} project` }); return; }
      // No lock: the target moves now; a camera already in motion continues from where it is.
      select(to, 'animate');
      record({ t: r.t, kind: 'wheel', d, gesture: r.gesture, action: 'step', reason: `${r.reason} → 0${to + 1}` });
      return;
    }
    record({ t: r.t, kind: 'wheel', d, gesture: r.gesture, action: 'ignore', reason: r.reason });
  }
  function onResize() {
    if (press) { endPress(); suppressClick = true; } // the interrupted press must not become a click
    stopLoop();
    measure();
    restCam();
    setState('idle');
  }
  function onVisibility() {
    if (!document.hidden) return;
    // Leaving the tab: finish any movement instantly and drop the pointer, so nothing resumes mid-gesture.
    if (press) { endPress(); suppressClick = true; }
    if (state === 'settling' || state === 'pressed' || state === 'dragging') { stopLoop(); restCam(); setState('idle'); }
  }

  /* ---------- Entering and leaving ---------- */
  function open(restoreIndex?: number, viaKeyboard = false) {
    if (state !== 'closed') return;
    if (exitAnim) { exitAnim.cancel(); exitAnim = null; }
    session = new AbortController();
    const signal = session.signal;
    savedScroll = scrollY;
    active = restoreIndex ?? window.__jshSel?.get() ?? 0;
    entry = active;
    if (!dlg.open) dlg.showModal();
    setState('idle');
    measure();
    select(active, 'instant');
    stage.addEventListener('pointerdown', onPointerDown, { signal });
    window.addEventListener('pointermove', onPointerMove, { signal });
    window.addEventListener('pointerup', onPointerUp, { signal });
    window.addEventListener('pointercancel', onPointerAbort, { signal });
    // Only the scene's own capture matters: touch pointers start implicitly captured by the card link they
    // land on, and that link's lostpointercapture bubbles up when the scene takes over.
    stage.addEventListener('lostpointercapture', (e) => { if (e.target === stage && state === 'dragging') onPointerAbort(e); }, { signal });
    stage.addEventListener('click', onClickCapture, { capture: true, signal });
    stage.addEventListener('dragstart', (e) => e.preventDefault(), { signal });
    dlg.addEventListener('keydown', onKey, { signal });
    dlg.addEventListener('wheel', onWheel, { passive: false, signal });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); }, { signal });
    dlg.addEventListener('close', () => { if (state !== 'closed') cleanup(); }, { signal });
    openLink.addEventListener('click', (e) => { if (state === 'opening') { e.preventDefault(); return; } beginOpening(e); }, { signal });
    picks.forEach((b, k) => b.addEventListener('click', () => select(k, 'animate'), { signal }));
    dlg.querySelector('#sp-recenter')!.addEventListener('click', () => select(entry, 'animate'), { signal });
    dlg.querySelector('#sp-exit')!.addEventListener('click', () => close(), { signal });
    let rraf = 0;
    window.addEventListener('resize', () => { cancelAnimationFrame(rraf); rraf = requestAnimationFrame(onResize); }, { signal });
    document.addEventListener('visibilitychange', onVisibility, { signal });
    document.dispatchEvent(new CustomEvent('jsh:user-choice')); // B stops auto-advancing behind the dialog
    if (restoreIndex === undefined && !reduced.matches) {
      const ease = 'cubic-bezier(.22,1,.36,1)';
      stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'linear' });
      dlg.querySelectorAll('.sp-enter').forEach((el, k) => {
        const d = (k - active + N) % N; // the selected project lands first
        el.animate([{ opacity: 0, transform: 'translateY(36px) scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: 60 + d * 70, easing: ease, fill: 'backwards' });
      });
      dlg.querySelectorAll('.sp-top, .sp-bar').forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 220, fill: 'backwards' }));
    }
    gestures.reset();
    if (debug) mountDebug();
    delete dlg.dataset.restore;
    // Keyboard users land on the active project button; pointer users get focus on the dialog itself,
    // so no focus ring appears beside the selection (Safari shows rings after programmatic focus).
    if (viaKeyboard) picks[active].focus({ preventScroll: true }); else dlg.focus({ preventScroll: true });
  }
  function cleanup() {
    endPress();
    stopLoop();
    timers.forEach(clearTimeout); timers = [];
    gestures.reset();
    debugPanel?.remove(); debugPanel = null;
    session?.abort(); session = null;
    clusters.forEach((c) => c.querySelector<HTMLElement>('.sp-card .frame')!.style.viewTransitionName = '');
    setState('closed');
  }
  function close() {
    if (state === 'closed') return;
    const keep = active;
    cleanup();
    window.__jshSel?.render(keep); // B shows the project chosen here
    const hs = { ...(history.state || {}) }; delete hs.spatial; history.replaceState(hs, '');
    const finish = () => {
      exitAnim = null;
      if (dlg.open) dlg.close();
      if (Math.abs(scrollY - savedScroll) > 1) scrollTo({ top: savedScroll, behavior: 'instant' as ScrollBehavior });
      (launch ?? document.querySelector<HTMLElement>('#picker [role="tab"][aria-selected="true"]'))?.focus({ preventScroll: true });
    };
    if (reduced.matches) { finish(); return; }
    exitAnim = dlg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'cubic-bezier(.55,0,1,.45)' });
    exitAnim.finished.then(finish, () => { /* cancelled by a re-open */ });
  }

  // The entry point appears only once this controller is ready; without it, visitors simply get B.
  if (launch) { launch.hidden = false; launch.addEventListener('click', (e) => open(undefined, e.detail === 0)); } // detail 0: Enter/Space
  // Back from a case study into the bfcache: the page was frozen mid-"opening"; make it usable again.
  addEventListener('pageshow', (e) => {
    if (!e.persisted || state !== 'opening') return;
    clusters.forEach((c) => c.querySelector<HTMLElement>('.sp-card .frame')!.style.viewTransitionName = '');
    setState('idle');
    restCam();
  });
  // The inline script reopened the dialog for a returning visitor; adopt it.
  if (dlg.open && dlg.dataset.restore !== undefined) {
    open(Number(dlg.dataset.restore)); // the inline script clears the card's transition name after the reveal
  }
  /* ---------- ?debug=input: on-screen log of accepted/ignored input, for physical-device testing ---------- */
  function mountDebug() {
    debugPanel = document.createElement('div');
    debugPanel.className = 'sp-debug';
    debugPanel.setAttribute('aria-hidden', 'true');
    debugPanel.innerHTML = '<div class="sp-debug__head"><b>Input log</b><span class="sp-debug__counts"></span><button type="button" data-copy>Copy log</button><button type="button" data-clear>Clear</button></div><ol class="sp-debug__rows"></ol>';
    debugPanel.querySelector('[data-copy]')!.addEventListener('click', () => { navigator.clipboard?.writeText(JSON.stringify(inputLog)).then(() => { (debugPanel!.querySelector('[data-copy]') as HTMLElement).textContent = 'Copied'; }); });
    debugPanel.querySelector('[data-clear]')!.addEventListener('click', () => { inputLog.length = 0; renderDebug(); });
    dlg.append(debugPanel);
    renderDebug();
  }
  let debugRaf = 0;
  function renderDebug() {
    if (debugRaf) return;
    debugRaf = requestAnimationFrame(() => {
      debugRaf = 0;
      if (!debugPanel) return;
      const wheel = inputLog.filter((x) => x.kind === 'wheel');
      debugPanel.querySelector('.sp-debug__counts')!.textContent = `wheel events ${wheel.length} · steps ${wheel.filter((x) => x.action === 'step').length} · boundary ${wheel.filter((x) => x.action === 'boundary').length} · ignored ${wheel.filter((x) => x.action === 'ignore').length}`;
      // The decisions that matter (steps, boundaries, resets) stay in view; ignored events only as the latest few.
      const kept = inputLog.filter((x) => x.action !== 'ignore').slice(-9);
      const recentIgnores = inputLog.filter((x) => x.action === 'ignore').slice(-4);
      const rows = [...kept, ...recentIgnores].sort((a, b) => b.t - a.t);
      debugPanel.querySelector('.sp-debug__rows')!.innerHTML = rows.map((x) => `<li class="is-${x.action}"><span>${x.kind}</span><span>${x.d !== undefined ? Math.round(x.d) : ''}</span><span>${x.action}</span><span>${x.reason}</span></li>`).join('');
    });
  }
  (window as unknown as { __spatialInput: Entry[] }).__spatialInput = inputLog;

  // Testing hook (read-only): lets automated checks observe the controller without reaching into closures.
  (window as unknown as { __spatial: unknown }).__spatial = { get state() { return state; }, get active() { return active; }, get listening() { return !!session; } };
}
