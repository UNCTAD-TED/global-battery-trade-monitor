// ─────────────────────────────────────────────────────────────────────────────
// Motion: one small system for every transition (docs/design/MOTION_V6.md).
//
// Tokens (the same values are CSS custom properties in src/styles/motion.css):
//   MS.micro   150 ms  feedback: a hover, a press, a label fading in, something leaving
//   MS.ui      260 ms  panels, popovers, a page or a view crossfading, chapter text
//   MS.data    520 ms  marks taking their new value: a corridor drawing on, a bar growing
//   MS.camera  900 ms  the map camera (story: 700-1200 ms depending on the distance)
//   EASE.out   cubic-bezier(.2,.7,.2,1): fast start, long soft landing (things arriving)
//   EASE.inOut cubic-bezier(.45,0,.25,1): the camera and things that move from A to B
//   EASE.in    cubic-bezier(.4,0,1,1): things leaving
// Rules: one choreographed sequence per change (camera, then data, then labels and text); the same corridor,
// economy or bar moves to its new state (object constancy); every transition can be interrupted by the next
// change; no bounce, overshoot, parallax or glow; only transform, opacity and stroke-dashoffset are animated.
//
// Reduced motion: every state change still happens, at once (durations 0). CSS animations are switched off in
// src/styles/style.css and motion.css; this module covers the JavaScript-driven half.
// The off switch: MOTION_ON below (or localStorage 'bm.motion' = 'off' in a browser) turns all of it off at once.
// The query is evaluated live, so toggling the OS setting takes effect on the next change without a reload.
// ─────────────────────────────────────────────────────────────────────────────

/** The one flag: false = no transitions anywhere (every change lands at once). */
export const MOTION_ON = true;

const _mq = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

let _off = false;
try { _off = typeof localStorage !== 'undefined' && localStorage.getItem('bm.motion') === 'off'; } catch { /* no storage */ }
if (typeof document !== 'undefined' && (!MOTION_ON || _off)) document.documentElement.dataset.motion = 'off';

export function prefersReducedMotion() {
    return !!_mq?.matches;
}

/** True when transitions should run (the flag is on and the reader did not ask for reduced motion). */
export function motionOn() {
    return MOTION_ON && !_off && !prefersReducedMotion();
}

// D3 transition duration. Returns 0 under reduced motion (or with motion off) so the transition still runs
// (end-state styles, .remove() callbacks and text tweens all still fire) but lands immediately.
export function motionDuration(ms) {
    return motionOn() ? ms : 0;
}
export const md = motionDuration;

export const MS = { micro: 150, ui: 260, data: 520, camera: 900, cameraMin: 700, cameraMax: 1200, stagger: 35, staggerMax: 12 };

// Cubic Bézier easing, as CSS computes it (so the JS and CSS curves are the same).
export function bezier(x1, y1, x2, y2) {
    const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
    const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
    const X = t => ((ax * t + bx) * t + cx) * t, Y = t => ((ay * t + by) * t + cy) * t, dX = t => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let i = 0; i < 6; i++) { const d = dX(t); if (Math.abs(d) < 1e-6) break; const t2 = t - (X(t) - x) / d; if (Math.abs(t2 - t) < 1e-6) { t = t2; break; } t = t2; }
        if (t < 0 || t > 1) {   // Newton left the interval: bisect
            let lo = 0, hi = 1; t = x;
            for (let i = 0; i < 24; i++) { if (X(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
        }
        return Y(t);
    };
}
export const EASE = {
    out: bezier(0.2, 0.7, 0.2, 1),
    inOut: bezier(0.45, 0, 0.25, 1),
    in: bezier(0.4, 0, 1, 1),
};

/** Delay of the k-th of n staggered items (largest first), capped so a long list never waits long. */
export function stagger(k, step = MS.stagger, cap = MS.staggerMax) {
    return motionOn() ? Math.min(k, cap) * step : 0;
}
