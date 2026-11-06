import * as d3 from 'd3';
import { STATE, METRIC_FORMAT, isProvisional, CONFIG, tickFmt } from './config.js';
import { DataLoader } from './dataLoader.js';
import { logTicks, shortName } from './storyCharts.js';
import { motionOn, MS } from './motion.js';
import { EASE_CSS } from './transitions.js';
import { twoReportsNote } from './storyFindings.js';
// a signed difference with a true minus: whole per cent from 10%, one decimal below (as on the question pages)
const signedPct = p => `${p >= 0 ? '+' : '−'}${Math.abs(p) < 10 ? Math.abs(p).toFixed(1) : Math.round(Math.abs(p))}%`;

// "Two reports" view: for the largest flows in the current selection, the exporter's report
// (filled dot) and the importer's report (open dot) side by side on a log scale.
// Neutral wording (spec 0.4): a gap is a "difference between reports"; the text lists the usual
// technical reasons and says that these statistics do not show which applies.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nm = iso => STATE.countryNames[iso] || iso;

export const GapView = {
    el: null,
    sort: 'flows',

    init(el) {
        this.el = el;
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const r = e.target.closest('[data-pair]');
            if (!r) return;
            e.preventDefault();
            const [a, b] = r.dataset.pair.split('|');
            document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e: a, i: b } }));
        });
        el.addEventListener('click', (e) => {
            const s = e.target.closest('[data-gsort]');
            if (s) { this.sort = s.dataset.gsort; this.render(); this.el.querySelector(`[data-gsort="${this.sort}"]`)?.focus({ preventScroll: true }); return; }
            const r = e.target.closest('[data-pair]');
            if (r) {
                const [a, b] = r.dataset.pair.split('|');
                document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e: a, i: b } }));
            }
        });
    },

    // The exporter reported for the year but has no record of this flow, while the importer does:
    // the exporter-first rule (spec 5.3) gives 0, so the flow is not on the map.
    notOnMap(d) {
        const { x, m } = this.keys();
        if (d.oi !== undefined && d.oi !== null) return !!d.oi && d.src === 'x' && d[m] > 0;   // DATA_CONTRACT v1.3 flag
        return d.src === 'x' && !(d[x] > 0) && d[m] > 0;                                          // fallback: inferred
    },

    keys(metric = STATE.metric) {
        return metric === 'weight' ? { x: 'xw', m: 'mw' } : { x: 'xv', m: 'mv' };
    },

    rows() {
        const { x, m } = this.keys();
        // All flow categories (the map's category chips do not apply here); reports only.
        const scope = (STATE.scopeFlows || []).filter(d => d.src !== 'e');
        let rows = scope.filter(d => (d[x] || 0) > 0 || (d[m] || 0) > 0);
        if (this.sort === 'diff') {
            rows = rows.filter(d => d[x] > 0 && d[m] > 0).sort((a, b) => Math.abs(b[m] - b[x]) - Math.abs(a[m] - a[x]));
        } else {
            rows = rows.sort((a, b) => Math.max(b[x] || 0, b[m] || 0) - Math.max(a[x] || 0, a[m] || 0));
        }
        return rows.slice(0, STATE.topN);
    },

    summary() {
        const { x, m } = this.keys();
        const both = (STATE.scopeFlows || []).filter(d => d[x] > 0 && d[m] > 0);
        const sx = d3.sum(both, d => d[x]), sm = d3.sum(both, d => d[m]);
        const onlyX = (STATE.scopeFlows || []).filter(d => d[x] > 0 && !(d[m] > 0)).length;
        const onlyMRows = (STATE.scopeFlows || []).filter(d => d[m] > 0 && !(d[x] > 0));
        const onlyM = onlyMRows.length;
        const onlyMDag = onlyMRows.filter(d => d.src === 'm').length;     // used on the map (†)
        const onlyMOff = onlyMRows.filter(d => this.notOnMap(d)).length;  // not on the map (exporter reported for the year)
        const onlyMOther = onlyM - onlyMDag - onlyMOff;                   // e.g. the exporter's record has a value but no weight
        return { n: both.length, sx, sm, onlyX, onlyM, onlyMDag, onlyMOff, onlyMOther };
    },

    render() {
        if (!this.el) return;
        const a = document.activeElement;
        const keep = a && this.el.contains(a) ? (a.dataset?.pair ? `[data-pair="${a.dataset.pair}"]` : a.dataset?.gsort ? `[data-gsort="${a.dataset.gsort}"]` : null) : null;
        this._render();
        if (keep) this.el.querySelector(keep)?.focus({ preventScroll: true });
    },

    _render() {
        const fmt = METRIC_FORMAT[STATE.metric].fmt;
        const { x: xk, m: mk } = this.keys();
        const p = DataLoader.product();
        const rows = this.rows();
        const s = this.summary();
        const pct = s.sx ? 100 * (s.sm - s.sx) / s.sx : 0;
        const sumTxt = s.n
            ? `For the <b>${d3.format(',')(s.n)}</b> flows in this selection that both sides reported, importers’ reports add up to <b>${fmt(s.sm)}</b> and exporters’ reports to <b>${fmt(s.sx)}</b> (${signedPct(pct)}).`
            : 'No flow in this selection was reported by both sides.';
        const f = d3.format(',');
        const oneSide = `${f(s.onlyX)} flows have only the exporter’s report. ${f(s.onlyM)} have only the importer’s report: ${f(s.onlyMDag)} are used on the map (†, the exporter did not report for the year) and ${f(s.onlyMOff)} are not on the map (the exporter reported for the year, but not this flow)${s.onlyMOther > 0 ? `; ${f(s.onlyMOther)} have an exporter\u2019s record without a ${STATE.metric}` : ''}.`;
        // rows keep their identity across a change of year, product or measure (docs/design/MOTION_V6.md): where each
        // row and its two dots were, measured before the redraw
        const was = new Map();
        if (motionOn() && this.el.offsetParent) this.el.querySelectorAll('.db-row[data-pair]').forEach(r => {
            const y = +(/translate\(0,([-\d.]+)\)/.exec(r.getAttribute('transform') || '') || [])[1];
            was.set(r.dataset.pair, { y, x: +r.querySelector('circle.db-x')?.getAttribute('cx'), m: +r.querySelector('circle.db-m')?.getAttribute('cx') });
        });
        this.el.innerHTML = `<div class="gv">
            <div class="gv-head">
              <div>
                <p class="gv-kicker">Two reports of the same trade</p>
                <h2 class="gv-title">${esc(p.label)} &middot; ${STATE.year}${isProvisional(STATE.year) ? ' (provisional)' : ''} &middot; ${METRIC_FORMAT[STATE.metric].label.toLowerCase()}</h2>
                ${document.documentElement.classList.contains('phone') ? `<details class="gv-more"><summary>About these figures</summary><p class="gv-sum">${sumTxt} ${oneSide}</p></details>` : `<p class="gv-sum">${sumTxt} ${oneSide}</p>`}
                <p class="gv-rule">${this.sort === 'diff'
                    ? `Order: the largest gap first, in ${STATE.metric === 'weight' ? 'tonnes' : 'US dollars'} (the “Gap” column: importer’s report minus exporter’s); only flows that both sides reported. The line between the dots shows the ratio on a log scale, so a long line can rank low when the flow is small.`
                    : 'Order: the largest flow first, by the larger of its two reports. The line between the dots shows how far apart the two reports are (log scale).'}</p>
              </div>
              <div class="gv-tools">
                <div class="tb-seg gv-sort" role="group" aria-label="Order the rows by"><span class="gv-sortcap">Order by</span>
                  <button class="btn-toggle ${this.sort === 'flows' ? 'active' : ''}" type="button" data-gsort="flows" aria-pressed="${this.sort === 'flows'}" title="Largest flow first (the larger of its two reports)">Flow size</button>
                  <button class="btn-toggle ${this.sort === 'diff' ? 'active' : ''}" type="button" data-gsort="diff" aria-pressed="${this.sort === 'diff'}" title="Largest gap between the two reports first (importer’s minus exporter’s)">Gap size</button>
                </div>
                <div class="tb-seg gv-sort" role="group" aria-label="Rows">${CONFIG.topN.options.map(n => `<button class="btn-toggle ${STATE.topN === n ? 'active' : ''}" type="button" data-ctl="topn" data-val="${n}">${n} rows</button>`).join('')}</div>
              </div>
            </div>
            <div class="stc-legend gv-legend"><span><i class="dot db-x"></i>Exporter’s report</span><span><i class="dot db-m"></i>Importer’s report</span>
              <span><b class="dag">†</b> the exporter did not report for the year (the map uses the importer’s report)</span>
              <span><i class="gv-tag-key">not on map</i> the exporter reported for the year but has no record of this flow, so the map shows 0</span>
              ${DataLoader.estActive() ? '<span><i class="dot db-e-key"></i>Experimental estimate with 90% interval (see Methodology)</span>' : ''}<span>Log scale</span></div>
            <div class="gv-chart"></div>
            <p class="gv-note">${twoReportsNote(STATE.metric)} Select a row (or press Enter on it) for the pair’s history.</p>
          </div>`;
        const box = this.el.querySelector('.gv-chart');
        if (!rows.length) { box.innerHTML = '<p class="cl-empty">No flows with data in this selection.</p>'; return; }
        const W = Math.max(300, box.clientWidth || 800);
        const narrow = W < 640;
        const codes = W < 1000;   // the centre column: ISO codes as on the ranked list; full names in the tooltip and the label for screen readers
        // on a phone only the gap is shown, and only when the rows are ordered by it (so the order can be read)
        const gapOnly = narrow && this.sort === 'diff';
        const rowH = 24, m = { t: 24, r: narrow ? (gapOnly ? 74 : 8) : 296, b: 8, l: narrow ? 136 : codes ? 196 : 380 };
        // the number columns: exporter's report, importer's report, the gap (importer's minus exporter's), the ratio;
        // the column the rows are ordered by is marked
        const COL = { x: 64, m: 140, gap: 222, ratio: 276 };
        const gapTxt = d => (d[xk] > 0 && d[mk] > 0 ? `${d[mk] >= d[xk] ? '+' : '−'}${fmt(Math.abs(d[mk] - d[xk]))}` : '—');
        const H = m.t + rowH * rows.length + m.b;
        const est = DataLoader.estActive();
        const ests = rows.map(d => (est && DataLoader.isEst(d) ? { v: DataLoader.val(d), iv: DataLoader.interval(d) } : null));
        const vals = rows.flatMap((d, k) => [d[xk], d[mk], ests[k]?.v, ...(ests[k]?.iv || [])]).filter(v => v > 0);
        const x = d3.scaleLog().domain([d3.min(vals) / 1.5, d3.max(vals) * 1.3]).range([m.l, W - m.r]).clamp(true);
        const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('class', 'stc-svg gv-svg')
            .attr('role', 'group').attr('aria-label', 'Exporter and importer reports for the largest flows');
        svg.append('g').attr('class', 'stc-grid').attr('transform', `translate(0,${m.t - 6})`)
            .call(d3.axisTop(x).tickValues(logTicks(x)).tickSize(-(H - m.t)).tickFormat(v => tickFmt(v)))
            .call(g => g.select('.domain').remove());
        if (!narrow) {
            const hx = W - m.r + 12;
            const byFlow = this.sort !== 'diff';
            svg.append('text').attr('class', 'gv-colh').attr('x', hx + COL.x).attr('y', 12).attr('text-anchor', 'end').text('Exporter');
            svg.append('text').attr('class', 'gv-colh').attr('x', hx + COL.m).attr('y', 12).attr('text-anchor', 'end').text('Importer');
            svg.append('text').attr('class', `gv-colh${byFlow ? '' : ' on'}`).attr('x', hx + COL.gap).attr('y', 12).attr('text-anchor', 'end').text(byFlow ? 'Gap' : 'Gap ▾');
            svg.append('text').attr('class', 'gv-colh').attr('x', hx + COL.ratio).attr('y', 12).attr('text-anchor', 'end').text('Ratio');
        }
        const g = svg.append('g').selectAll('g').data(rows).enter().append('g')
            .attr('class', d => `db-row ${d.src === 'm' ? 'is-dagger' : ''} ${this.notOnMap(d) ? 'is-offmap' : ''}`)
            .attr('data-pair', d => `${d.e}|${d.i}`)
            .attr('role', 'button').attr('tabindex', 0)
            .attr('aria-label', d => `${nm(d.e)} to ${nm(d.i)}: exporter's report ${d[xk] == null ? 'no record' : fmt(d[xk])}, importer's report ${d[mk] == null ? 'no record' : fmt(d[mk])}${d.src === 'm' ? ', importer report used on the map' : ''}${this.notOnMap(d) ? ', not on the map' : ''}. Open the pair history.`)
            .attr('transform', (d, k) => `translate(0,${m.t + k * rowH + rowH / 2})`);
        g.append('rect').attr('class', 'stc-hit').attr('x', 0).attr('y', -rowH / 2).attr('width', W).attr('height', rowH);
        if (!narrow) g.append('text').attr('class', 'gv-rank').attr('x', 18).attr('y', 4).attr('text-anchor', 'end').text((d, k) => k + 1);
        const lab = g.append('text').attr('class', 'db-lab').attr('x', m.l - 10).attr('y', 4).attr('text-anchor', 'end');
        lab.filter(d => this.notOnMap(d)).append('tspan').attr('class', 'gv-tag').text(narrow ? 'off map ' : 'not on map  ');
        lab.append('tspan').text(d => codes ? `${d.e} → ${d.i}` : `${short(shortName(d.e))} → ${short(shortName(d.i))}`);
        lab.filter(d => d.src === 'm').append('tspan').attr('class', 'db-dag').text(' †');
        g.filter(d => d[xk] > 0 && d[mk] > 0).append('line').attr('class', 'db-link').attr('x1', d => x(d[xk])).attr('x2', d => x(d[mk]));
        g.filter(d => d[mk] > 0).append('circle').attr('class', 'db-m').attr('r', 4.5).attr('cx', d => x(d[mk]));
        g.filter(d => d[xk] > 0).append('circle').attr('class', 'db-x').attr('r', 4.5).attr('cx', d => x(d[xk]));
        if (est) {
            // estimate (diamond) with its 90% interval, just below the two reports
            const ge = g.filter((d, k) => ests[k] && ests[k].v > 0);
            ge.append('line').attr('class', 'db-iv').attr('y1', 7).attr('y2', 7)
                .attr('x1', d => { const e = ests[rows.indexOf(d)]; return x(Math.max(x.domain()[0], e.iv ? e.iv[0] || x.domain()[0] : e.v)); })
                .attr('x2', d => { const e = ests[rows.indexOf(d)]; return x(e.iv ? e.iv[1] : e.v); });
            ge.append('path').attr('class', 'db-e').attr('d', 'M0,-4L4,0L0,4L-4,0Z')
                .attr('transform', d => `translate(${x(ests[rows.indexOf(d)].v)},7)`);
        }
        if (!narrow) {
            const hx = W - m.r + 12;
            g.append('text').attr('class', 'gv-num').attr('x', hx + COL.x).attr('y', 4).attr('text-anchor', 'end').text(d => d[xk] == null ? (d.src === 'm' ? 'did not report' : 'no record') : fmt(d[xk]));
            g.append('text').attr('class', 'gv-num').attr('x', hx + COL.m).attr('y', 4).attr('text-anchor', 'end').text(d => d[mk] == null ? 'no record' : fmt(d[mk]));
            g.append('text').attr('class', `gv-num gv-gap${this.sort === 'diff' ? ' on' : ''}`).attr('x', hx + COL.gap).attr('y', 4).attr('text-anchor', 'end').text(gapTxt);
            g.append('text').attr('class', 'gv-num gv-ratio').attr('x', hx + COL.ratio).attr('y', 4).attr('text-anchor', 'end')
                .text(d => (d[xk] > 0 && d[mk] > 0) ? `×${ratioTxt(d[mk] / d[xk])}` : '—');
        }
        if (gapOnly) {
            svg.append('text').attr('class', 'gv-colh on').attr('x', W - 4).attr('y', 12).attr('text-anchor', 'end').text('Gap ▾');
            g.append('text').attr('class', 'gv-num gv-gap on').attr('x', W - 4).attr('y', 4).attr('text-anchor', 'end').text(gapTxt);
        }
        if (was.size) this.morph(g, was);
        g.on('mousemove', (ev, d) => document.dispatchEvent(new CustomEvent('bm:gap-hover', { detail: { event: ev, html: this.describe(d) } })))
            .on('mouseleave', () => document.dispatchEvent(new CustomEvent('bm:hoverend')));
    },

    // A row that stays moves to its new rank and its dots slide to their new values; the line between them follows
    // (it fades back in once the dots have arrived); a row that is new fades in. Transform and opacity only.
    morph(g, was) {
        const ms = MS.ui + 140;
        g.each(function () {
            const o = was.get(this.dataset.pair);
            const y = +(/translate\(0,([-\d.]+)\)/.exec(this.getAttribute('transform') || '') || [])[1];
            if (!o) { this.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MS.ui, delay: MS.micro, easing: EASE_CSS.out, fill: 'backwards' }); return; }
            const dy = (o.y || 0) - (y || 0);
            [...this.children].forEach(el => {
                let dx = 0;
                if (el.matches('circle.db-x') && o.x) dx = o.x - +el.getAttribute('cx');
                if (el.matches('circle.db-m') && o.m) dx = o.m - +el.getAttribute('cx');
                if (el.matches('line.db-link, line.db-iv, path.db-e')) { el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], { duration: ms, easing: 'linear' }); if (!dy) return; }
                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
                if (el.matches('path.db-e')) return;   // the estimate's diamond has its own transform attribute
                el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: ms, easing: EASE_CSS.inOut });
            });
        });
    },

    describe(d) {
        const fmt = METRIC_FORMAT[STATE.metric].fmt;
        const { x, m } = this.keys();
        const r = d[x] > 0 && d[m] > 0 ? d[m] / d[x] : null;
        return `<div class="tt-title">${esc(nm(d.e))} → ${esc(nm(d.i))}${d.src === 'm' ? ' †' : ''}</div>
            <div class="tt-row"><span><i class="dot db-x"></i> Exporter’s report</span><span>${d[x] == null ? 'no record' : fmt(d[x])}</span></div>
            <div class="tt-row"><span><i class="dot db-m"></i> Importer’s report</span><span>${d[m] == null ? 'no record' : fmt(d[m])}</span></div>
            ${r ? `<div class="tt-row"><span>Gap (importer − exporter)</span><span>${d[m] >= d[x] ? '+' : '−'}${fmt(Math.abs(d[m] - d[x]))}</span></div>
            <div class="tt-row"><span>Importer ÷ exporter</span><span>×${ratioTxt(r)}</span></div><div class="tt-note">${ratioWords(r)}</div>` : ''}
            ${DataLoader.isEst(d) ? `<div class="tt-row"><span><i class="dot db-e-key"></i> Estimate</span><span>${fmt(DataLoader.val(d))}${DataLoader.interval(d) ? ` (${fmt(DataLoader.interval(d)[0])} – ${fmt(DataLoader.interval(d)[1])})` : ''}</span></div>` : ''}
            ${d.src === 'm' ? `<div class="tt-note">${CONFIG.daggerNote}</div>` : ''}
            ${this.notOnMap(d) ? '<div class="tt-note">Not on the map: the exporter reported for this year but has no record of this flow. The map uses the exporter’s report, so it shows 0.</div>' : ''}
            <div class="tt-sub">${CONFIG.flowLabels[d.fc] || ''} · click for the pair’s history</div>`;
    },
};

function short(s) { return s.length > 30 ? s.slice(0, 29) + '…' : s; }
function ratioWords(r) {
    if (r >= 0.95 && r <= 1.05) return 'The two reports are within 5% of each other.';
    if (r > 1) return `The importer’s report is ${ratioTxt(r)} times the exporter’s.`;
    return `The importer’s report is ${Math.round(r * 100)}% of the exporter’s.`;
}
function ratioTxt(r) { return r >= 10 ? d3.format(',.0f')(r) : r >= 0.01 ? r.toFixed(2) : r.toExponential(1); }
