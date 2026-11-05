// Editions. The normal build ("full") shows everything, and this module does nothing in it.
// The "basel" edition, made with `vite --mode basel`, is for sharing with the whole Basel Convention
// meeting (user, 2026-11-05). It temporarily hides content that is specific to Japan or to one region,
// and the guided story:
//   - the question "Japan, ASEAN and India: who trades with whom?" (#q=jai), on the entry and in previous / next;
//   - the groups Japan–ASEAN–India (JAI) and South Asia (SAS) in the explorer's "Economies shown";
//   - the "South Asia and Bangladesh" section under the spent-batteries question;
//   - the guided story (#story, #story=N): the header link and every link into it;
//   - the explorer's Matrix view, whose rows are the Japan–ASEAN–India economies (v=matrix opens the map).
// Links to hidden parts land on the entry (#home), and explorer links with s=JAI or s=SAS show all economies.
// This script is loaded before src/main.js (index.html), so its link checks run before the app's own.
// To show everything again, use the normal build (npm run dev / npm run build).
import { QUESTIONS, Pages } from './pages.js';
import './styles/edition.css';   // its rules apply only under .ed-basel

export const EDITION = import.meta.env.MODE === 'basel' ? 'basel' : 'full';

const HIDE_Q = ['jai'];
const HIDE_GROUPS = ['JAI', 'SAS'];
const HIDE_VIEWS = ['matrix'];   // its rows are Japan, ASEAN, India, China, Korea, USA, EU27 (meta.json matrix.order)

// The entry describes the explorer: no "matrix" while it is hidden
function fixText() {
    const s = document.querySelector('#home-explore > span');
    if (s && /matrix/.test(s.textContent)) s.textContent = 'Map, the two reports compared, a table; every product and year; CSV downloads';
}

function fixLink() {
    const h = location.hash;
    let n = null;
    if (/^#story\b/.test(h)) n = '#home';
    else if (h.length > 1) {
        const p = new URLSearchParams(h.slice(1));
        if (p.has('p')) {
            // explorer link: no hidden group, and no "back to question" into a hidden question
            let changed = false;
            if (HIDE_GROUPS.includes(p.get('s'))) { p.set('s', 'GLOBAL'); changed = true; }
            if (HIDE_Q.includes(p.get('q'))) { p.delete('q'); changed = true; }
            if (HIDE_VIEWS.includes(p.get('v'))) { p.set('v', 'map'); changed = true; }
            if (changed) n = '#' + p.toString();
        } else if (HIDE_Q.includes(p.get('q'))) n = '#home';
    }
    if (n && n !== h) history.replaceState(null, '', n);
}

// The groups leave both lists: "Economies shown" (#scope-sel) and the HS code panel's scope (#vp-scope)
function pruneGroups() {
    document.querySelectorAll('#scope-sel, #vp-scope').forEach(sel => {
        sel.querySelectorAll(HIDE_GROUPS.map(g => `option[value="${g}"]`).join(',')).forEach(o => o.remove());
        sel.querySelectorAll('optgroup').forEach(g => { if (!g.children.length) g.remove(); });
    });
    // no groups are left, so the hint speaks of regions only
    const sc = document.getElementById('scope-sel');
    if (sc && sc.title !== 'A region: flows with both ends in it') sc.title = 'A region: flows with both ends in it';
}

if (EDITION === 'basel') {
    document.documentElement.classList.add('ed-basel');
    // Layers 1–2: the Japan–ASEAN–India question leaves the entry grid and the previous / next links.
    for (let k = QUESTIONS.length - 1; k >= 0; k--) if (HIDE_Q.includes(QUESTIONS[k].id)) QUESTIONS.splice(k, 1);
    // The hidden "South Asia and Bangladesh" section is not built at all (it loaded 9 years of flows, about 1.3 MB)
    Pages.extraSouthAsia = async function () { const el = this.el?.querySelector('#qp-extra'); if (el) el.innerHTML = ''; };
    // Links: checked now, and on every move. These listeners are added before the app's, so they run first.
    fixLink();
    window.addEventListener('popstate', fixLink);
    window.addEventListener('hashchange', fixLink);
    // Explorer: the two groups leave "Economies shown" whenever the list is (re)drawn.
    const start = () => {
        pruneGroups();
        const sel = document.getElementById('scope-sel');
        if (sel) new MutationObserver(() => pruneGroups()).observe(sel, { childList: true, subtree: true });
        const vb = document.getElementById('visibility-body');   // the HS code panel is redrawn on each open
        if (vb) new MutationObserver(() => pruneGroups()).observe(vb, { childList: true, subtree: true });
        const pages = document.getElementById('pages') || document.body;
        fixText();
        new MutationObserver(() => fixText()).observe(pages, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
