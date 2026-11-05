// Transitions between states of the page (docs/design/MOTION_V6.md). Tokens and the off switch: src/motion.js.
//
//   swap(update, opts)      a change of layer (home, a question, the story, the explorer) or of explorer view, as a
//                           same-document View Transition: the old page leaves, the new one arrives with a slight
//                           move; named elements (the header, a question's picture, the map) morph instead. Without
//                           the API, with reduced motion or with motion off, update() runs at once.
//   name(el, n) / unname()  give an element a view-transition-name for the next swap (a shared element)
//   leave(el, opts)         fade an element out where it is (a ghost of the old state) while the new state arrives
//   enter(el, opts)         fade (and lift) an element in
//   flip(box, sel, key, fn) the rows of a list move to their new places (object constancy); new rows fade in
//
// Interruptible: a new swap skips the running one (it jumps to its end); a click that lands while a View Transition
// runs (Chromium sends it to <html>) is delivered to what is under the pointer as soon as the transition is skipped.
import { motionOn, MS } from './motion.js';

export const EASE_CSS = { out: 'cubic-bezier(.2,.7,.2,1)', inOut: 'cubic-bezier(.45,0,.25,1)', in: 'cubic-bezier(.4,0,1,1)' };

let current = null;
const named = new Set();
const running = new WeakMap();   // the animation an element is running (cancelled by the next; no getAnimations())
export const supportsVT = () => typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
export const swapping = () => !!current;

/**
 * Run update() as a View Transition.
 * @param {Function} update  changes the DOM; may return a promise (the page is held, frozen, for at most `hold` ms
 *                           while it settles, so the new state is captured with its content; then it animates).
 * @param {{kind?: string, dir?: number, hold?: number}} o  kind: 'page' | 'deeper' | 'back' | 'side' | 'view';
 *                           dir: +1 forward (next), -1 back (previous), 0 none.
 * @returns {Promise<any>}   resolves with update()'s result once it has completed.
 */
export function swap(update, { kind = 'page', dir = 0, hold = 260 } = {}) {
    const root = document.documentElement;
    if (current) current.skipTransition();
    if (!motionOn() || !supportsVT() || document.visibilityState === 'hidden') {
        unname();
        try { return Promise.resolve(update()); } catch (e) { return Promise.reject(e); }
    }
    root.dataset.vt = kind;
    root.dataset.vtDir = dir > 0 ? 'fwd' : dir < 0 ? 'back' : 'none';
    let result;
    let vt;
    try {
        vt = document.startViewTransition(async () => {
            result = Promise.resolve().then(update);
            await Promise.race([result.catch(() => {}), new Promise(r => setTimeout(r, hold))]);
        });
    } catch {
        delete root.dataset.vt;
        return Promise.resolve(update());
    }
    current = vt;
    rescueClicks(vt);
    vt.ready.catch(() => {});
    const done = () => {
        if (current !== vt) return;
        current = null;
        delete root.dataset.vt;
        delete root.dataset.vtDir;
        unname();
    };
    vt.finished.then(done, done);
    return vt.updateCallbackDone.then(() => result, () => result);
}

/** Skip the running View Transition (it lands on its end state). */
export function skipSwap() { if (current) current.skipTransition(); }

/**
 * Resolves when the running swap's new page is on screen and animating (at once when none runs). While a swap holds
 * the old picture, the page is not painted, but clocks run: an animation started then would be half over when the
 * page appears. Animations of the new page start from here instead (see hold()).
 */
export function afterSwap() {
    return current ? current.ready.then(() => {}, () => {}) : Promise.resolve();
}
/** A Web Animation created while a swap is holding the old picture waits until the new page appears. */
export function hold(anim) {
    if (anim && current) { anim.pause(); afterSwap().then(() => anim.play()); }
    return anim;
}

// A click during a View Transition lands on <html> (the transition's pictures cover the page). Skip the transition
// and deliver the click to what is under the pointer once the real page is back: input is never lost.
function rescueClicks(vt) {
    const onClick = (e) => {
        if (e.target !== document.documentElement || !e.isTrusted) return;
        const { clientX: x, clientY: y } = e;
        vt.skipTransition();
        vt.finished.finally(() => requestAnimationFrame(() => {
            const t = document.elementFromPoint(x, y);
            if (t && t !== document.documentElement) t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window }));
        }));
    };
    document.addEventListener('click', onClick, true);
    const off = () => document.removeEventListener('click', onClick, true);
    vt.finished.then(off, off);
}

/** Give el a view-transition-name for the next swap (one element per name; the names are removed afterwards). */
export function name(el, n) {
    if (!el || !supportsVT()) return;
    document.querySelectorAll(`[data-vtn="${n}"]`).forEach(x => { if (x !== el) { x.style.viewTransitionName = ''; delete x.dataset.vtn; } });
    el.style.viewTransitionName = n;
    el.dataset.vtn = n;
    named.add(el);
}
export function unname(el) {
    const list = el ? [el] : [...named];
    list.forEach(x => { x.style.viewTransitionName = ''; delete x.dataset.vtn; named.delete(x); });
}

/**
 * Fade el out where it is, over the new state (a crossfade without a second copy in the reading order): el is taken
 * out of the flow at its current place, made inert and hidden from assistive technology, faded, then `done()`.
 * Returns a function that ends it at once (for an interruption).
 */
export function leave(el, { ms = MS.micro, done, box, rect } = {}) {
    if (!el) return () => {};
    let anim = null;
    const end = () => { anim?.cancel(); el.classList.remove('mo-leaving'); el.style.cssText = el.dataset.moCss || ''; delete el.dataset.moCss; el.inert = false; el.removeAttribute('aria-hidden'); done?.(); };
    if (!motionOn()) { end(); return () => {}; }
    // rect: the place, measured by the caller before it changed the DOM (no forced layout here)
    const b = rect || box_(el, box);
    el.dataset.moCss = el.style.cssText;
    Object.assign(el.style, { position: 'absolute', left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, margin: '0', pointerEvents: 'none', zIndex: '2' });
    el.classList.add('mo-leaving');
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: EASE_CSS.in, fill: 'forwards' });
    let ended = false;
    const finish = () => { if (ended) return; ended = true; end(); };
    anim.finished.then(finish, () => {});
    return finish;
}

/** Where el is, relative to box (or its offset parent): for leave(); call it before changing the DOM. */
export function box_(el, box) {
    const r = el.getBoundingClientRect(), p = (box || el.offsetParent || document.body).getBoundingClientRect();
    return { left: r.left - p.left, top: r.top - p.top, width: r.width, height: r.height };
}

/** Fade (and lift) el in. Cancels a running enter on the same element. */
export function enter(el, { ms = MS.ui, delay = 0, y = 6, x = 0, from = 0 } = {}) {
    if (!el || !motionOn() || !el.animate) return null;
    running.get(el)?.cancel();
    const a = el.animate([{ opacity: from, transform: `translate(${x}px,${y}px)` }, { opacity: 1, transform: 'none' }], { duration: ms, delay, easing: EASE_CSS.out, fill: 'backwards' });
    running.set(el, a);
    return hold(a);
}

/**
 * FLIP: rows keep their identity across a re-render. Measures the rows (sel inside box, keyed by key(el)), runs
 * mutate(), then moves each surviving row from its old place to its new one; new rows fade in.
 */
export function flip(box, sel, key, mutate, { ms = MS.ui, stagger = 0 } = {}) {
    if (!box || !motionOn()) { mutate(); return; }
    const before = new Map();
    box.querySelectorAll(sel).forEach(el => { running.get(el)?.cancel(); before.set(key(el), el.getBoundingClientRect().top); });
    mutate();
    if (!before.size) return;
    let k = 0;
    box.querySelectorAll(sel).forEach(el => {
        const t0 = before.get(key(el));
        const t1 = el.getBoundingClientRect().top;
        if (t0 == null) { running.set(el, el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MS.ui, delay: MS.micro + stagger * k++, easing: EASE_CSS.out, fill: 'backwards' })); return; }
        const dy = t0 - t1;
        if (Math.abs(dy) > 0.5) running.set(el, el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: ms, easing: EASE_CSS.inOut }));
    });
}
