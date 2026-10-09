// Turns a stream of wheel events (mouse wheel or trackpad, including macOS momentum) into
// "one project per intentional swipe", without any time-based lock.
//
// Browsers do not expose whether a wheel event comes from fingers or from momentum, so gestures are
// segmented from the stream itself:
//   • a new gesture starts after a pause, on a firm reversal of direction, or when deltas rise again
//     after having decayed (fingers re-engaging during the previous swipe's momentum tail);
//   • each gesture can step at most once, as soon as it has moved far enough;
//   • everything else in that gesture (its momentum tail) is discarded, with a stated reason.
// Pure and DOM-free so it can be tested directly against recorded or modelled event traces.

export type WheelDecision = {
  t: number;
  d: number;            // normalised delta along the dominant axis (px)
  gesture: number;      // gesture id this event was assigned to
  action: 'step' | 'ignore';
  dir: number;          // +1 / −1 when action is 'step'
  reason: string;
};

export const WHEEL_TUNING = {
  GAP_MS: 140,      // silence that ends a gesture
  STEP_PX: 24,      // distance a gesture must travel before it steps
  NOISE_PX: 4,      // smaller deltas never start or reverse a gesture (sensor jitter, momentum dregs)
  REVERSE_PX: 6,    // a reversal must be at least this firm
  DECAYED: 0.5,     // momentum is "decaying" once below this fraction of the gesture's peak…
  RISE: 2,          // …and fingers have re-engaged when deltas climb to this multiple of the low point
  RISE_MIN_PX: 10,  // …and are at least this large
};

export function normaliseDelta(deltaX: number, deltaY: number, deltaMode: number, pageHeight = 800) {
  const k = deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
  const x = deltaX * k, y = deltaY * k;
  return Math.abs(x) > Math.abs(y) ? x : y;
}

export function createWheelGestures(tuning = WHEEL_TUNING) {
  let id = 0, dir = 0, acc = 0, consumed = false, lastT = -Infinity, peak = 0, low = Infinity;

  function start(t: number, d: number) {
    id += 1; dir = Math.sign(d); acc = 0; consumed = false; lastT = t; peak = Math.abs(d); low = Infinity;
  }

  return {
    reset() { id += 1; dir = 0; acc = 0; consumed = false; lastT = -Infinity; peak = 0; low = Infinity; },
    classify(t: number, d: number): WheelDecision {
      const mag = Math.abs(d), sign = Math.sign(d);
      const out = (action: WheelDecision['action'], reason: string, stepDir = 0): WheelDecision => ({ t, d, gesture: id, action, dir: stepDir, reason });
      if (!sign) return out('ignore', 'zero delta');

      // ----- segmentation -----
      let began = '';
      if (t - lastT > tuning.GAP_MS) { if (mag < tuning.NOISE_PX && dir !== 0 && sign !== dir) return out('ignore', 'jitter after a pause'); began = 'new gesture after a pause'; }
      else if (sign !== dir && mag >= tuning.REVERSE_PX) began = 'new gesture: direction reversed';
      else if (consumed && sign === dir && low <= peak * tuning.DECAYED && mag >= tuning.RISE_MIN_PX && mag >= low * tuning.RISE) began = 'new gesture: fingers re-engaged during momentum';
      if (began) start(t, d);
      else {
        lastT = t;
        if (sign !== dir) return out('ignore', 'opposite jitter below reversal threshold');
        if (mag > peak && low === Infinity) peak = mag;           // still accelerating
        else if (mag < peak) low = Math.min(low, mag);            // decaying (momentum)
      }

      // ----- stepping -----
      if (consumed) return out('ignore', `momentum of gesture #${id} (already stepped)`);
      acc += mag;
      if (acc < tuning.STEP_PX) return out('ignore', `${began ? began + '; ' : ''}building ${Math.round(acc)}/${tuning.STEP_PX}px`);
      consumed = true; peak = mag; low = Infinity;
      return out('step', began || 'gesture travelled far enough', sign);
    },
  };
}
