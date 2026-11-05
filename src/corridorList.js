import { CONFIG, STATE, fmtMetric, flowVal } from './config.js';
import { DataLoader } from './dataLoader.js';
import { motionOn, MS } from './motion.js';
import { EASE_CSS } from './transitions.js';
import { Timeline } from './timeline.js';

// Ranked corridor list beside the map, in the right column (spec 7.2; v2 look: rows with the bar behind the words): the same top-N directed flows as the map,
// drawn as bars so that sizes can be read more precisely than from line widths.
// Hover or click a row to highlight its arc; the "details" button opens the pair history.
// Motion (docs/design/MOTION_V6.md): on a change of year, product or measure a corridor keeps its row: the row moves
// to its new rank and its bar takes its new length; corridors that join the list fade in.
export const CorridorList = {
    el: null,

    init(el) {
        this.el = el;
        el.addEventListener('click', (ev) => {
            if (ev.target.closest('.cl-fold-btn')) {
                this._open = !this._open;
                this.render();
                el.querySelector('.cl-fold-btn')?.focus({ preventScroll: true });
                return;
            }
            const more = ev.target.closest('[data-detail]');
            if (more) {
                const [e, i] = more.dataset.detail.split('|');
                document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e, i } }));
                return;
            }
            const row = ev.target.closest('.cl-row');
            if (!row) return;
            const key = row.dataset.key;
            const hadFocus = !!ev.target.closest('.cl-main') && ev.detail === 0;   // keyboard activation
            STATE.highlightPair = STATE.highlightPair === key ? null : key;
            document.dispatchEvent(new CustomEvent('bm:highlight', { detail: STATE.highlightPair }));
            // the list is drawn again: keep the focus on the same row's button
            if (hadFocus || document.activeElement === document.body) el.querySelector(`.cl-row[data-key="${key}"] .cl-main`)?.focus({ preventScroll: true });
        });
        el.addEventListener('mouseover', (ev) => {
            const row = ev.target.closest('.cl-row');
            if (row && !STATE.highlightPair) {
                document.dispatchEvent(new CustomEvent('bm:highlight-preview', { detail: row.dataset.key }));
            }
        });
        el.addEventListener('mouseleave', () => {
            if (!STATE.highlightPair) document.dispatchEvent(new CustomEvent('bm:highlight-preview', { detail: null }));
        });
    },

    render() {
        if (!this.el) return;
        const flows = STATE.filteredData || [];
        const val = d => flowVal(d);
        const ivs = flows.map(d => DataLoader.interval(d));
        const max = Math.max(flows.length ? val(flows[0]) : 1, ...ivs.filter(Boolean).map(v => v[1]));
        const name = iso => STATE.countryNames[iso] || iso;
        const unit = STATE.metric === 'weight' ? 'tonnes' : 'USD';
        const topn = CONFIG.topN.options.map(n => `<button class="btn-toggle ${STATE.topN === n ? 'active' : ''}" data-ctl="topn" data-val="${n}" type="button" aria-pressed="${STATE.topN === n}" aria-label="Show ${n} flows">${n}</button>`).join('');
        const sel = STATE.selectedCountry;
        // with an economy open, the list starts folded under the economy panel (user, 2026-11-05: the partners were
        // listed three times); one click opens it, and the choice is kept while the page is open
        const folded = !!sel && !this._open;
        const titleTxt = `${flows.length ? `${flows.length} largest flows` : 'No flows'}${sel ? ` touching ${name(sel)}` : ''}`;
        this.el.classList.toggle('cl-folded', folded);
        const head = `<div class="cl-head">
              <div><h3 class="cl-title">${sel ? `<button class="cl-fold-btn" type="button" aria-expanded="${!folded}" aria-controls="cl-rows">${titleTxt}</button>` : titleTxt}</h3>
              <span class="cl-sub">${unit} &middot; exporter &rarr; importer (ISO codes; point for names) &middot; on the map</span></div>
              <div class="tb-seg cl-topn" role="group" aria-label="Number of flows">${topn}</div>
            </div>`;
        if (!flows.length) {
            this.el.innerHTML = head + '<div class="cl-empty">No flows with data in this selection. Try another year, product or region.</div>';
            return;
        }
        const rows = flows.map((d, k) => {
            const key = `${d.e}|${d.i}`;
            const pct = Math.max(1.5, 100 * val(d) / max);
            const dag = d.src === 'm';
            const est = DataLoader.isEst(d);
            const iv = ivs[k];
            const cls = ['cl-row', dag && !est ? 'dagger' : '', est ? 'est' : '', STATE.highlightPair === key ? 'active' : ''].join(' ');
            const whisker = iv ? `<span class="cl-iv" style="left:${(100 * iv[0] / max).toFixed(1)}%;width:${Math.max(0.5, 100 * (iv[1] - iv[0]) / max).toFixed(1)}%"></span>` : '';
            return `<div class="${cls}" data-key="${key}" role="listitem" title="${name(d.e)} → ${name(d.i)}${dag ? ' — ' + CONFIG.daggerNote : ''}${est ? ' — estimate' : ''}">
                <button class="cl-main" type="button" aria-pressed="${STATE.highlightPair === key}" aria-label="${k + 1}. ${name(d.e)} to ${name(d.i)}, ${fmtMetric(val(d))}${dag ? ', reported by the importer' : ''}${est ? ', estimate' : ''}. Highlight on the map">
                  <span class="cl-rank">${k + 1}</span>
                  <span class="cl-pair"><b>${d.e}</b> &rarr; <b>${d.i}</b>${dag ? '<sup class="dag">†</sup>' : ''}${est ? '<sup class="est-badge est-mini" title="Estimate (see Methodology)">est</sup>' : ''}</span>
                  <span class="cl-bar-wrap"><span class="cl-bar fc-${d.fc}" style="width:${pct.toFixed(1)}%"></span>${whisker}</span>
                  <span class="cl-val">${est ? '≈' : ''}${fmtMetric(val(d))}</span>
                </button>
                <button class="cl-more" type="button" data-detail="${key}" title="Pair history and both sides’ reports" aria-label="Open the history of ${name(d.e)} to ${name(d.i)}">&rsaquo;</button>
            </div>`;
        }).join('');
        const nDag = flows.filter(d => d.src === 'm').length;
        const nEst = flows.filter(d => DataLoader.isEst(d)).length;
        const twin = STATE.view === 'map' && STATE.basis !== 'estimated' ? '<div class="cl-foot">Select a flow to draw its importer’s report beside it on the map (outlined, when the two reports differ by more than 10%); › opens its history.</div>' : '';
        const foot = twin + (nDag ? `<div class="cl-foot"><sup class="dag">†</sup> ${CONFIG.daggerNote}.</div>` : '')
            + (nEst ? `<div class="cl-foot"><span class="est-badge">est.</span> Experimental estimate; the line marks the 90% interval. See Methodology.</div>` : '');
        const prev = this._pct || new Map(), prevRank = this._rank || new Map();
        this._pct = new Map(flows.map(d => [`${d.e}|${d.i}`, Math.max(1.5, 100 * val(d) / max)]));
        this._rank = new Map(flows.map((d, k) => [`${d.e}|${d.i}`, k]));
        this.el.innerHTML = head + `<div class="cl-fold-body"${folded ? ' hidden' : ''}><div class="cl-rows" id="cl-rows" role="list" aria-label="Largest flows">${rows}</div>${foot}</div>`;
        if (folded) return;
        // No motion while the years play (a step every 1.2 s), while the list is not on view, or without motion
        // (perf review P1): nothing is measured or animated then.
        const side = document.getElementById('side');
        if (!motionOn() || Timeline._timer || !prev.size || document.body.dataset.layer !== 'explore'
            || side?.classList.contains('closed') || side?.classList.contains('sheet-peek')) return;
        // FLIP by rank: rows are one height, so a row's old place is its old rank (one measurement, kept)
        const els = this.el.querySelectorAll('.cl-row');
        if (!els.length) return;
        this._rowH = this._rowH || els[0].offsetHeight || 28;
        let fresh = 0;
        els.forEach((r, k) => {
            const key = r.dataset.key, r0 = prevRank.get(key);
            if (r0 == null) { r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MS.ui, delay: MS.micro + 12 * fresh++, easing: EASE_CSS.out, fill: 'backwards' }); return; }
            const dy = (r0 - k) * this._rowH;
            if (dy) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: MS.ui + 60, easing: EASE_CSS.inOut });
            // a bar that stays grows or shrinks to its new length (transform only)
            const p0 = prev.get(key), p1 = this._pct.get(key);
            if (p0 == null || !p1 || Math.abs(p0 - p1) < 0.3) return;
            const bar = r.querySelector('.cl-bar');
            bar.style.transformOrigin = 'left center';
            bar.animate([{ transform: `scaleX(${(p0 / p1).toFixed(4)})` }, { transform: 'none' }], { duration: MS.ui + 140, easing: EASE_CSS.inOut });
        });
    },
};
