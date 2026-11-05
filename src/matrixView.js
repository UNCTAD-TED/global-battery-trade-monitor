import * as d3 from 'd3';
import { STATE, fmtMetric, tickFmt } from './config.js';
import { DataLoader } from './dataLoader.js';
import { motionOn, MS } from './motion.js';
import { EASE_CSS } from './transitions.js';

// OD matrix (spec 7.3). Rows = exporters, columns = importers. Built in the browser from the
// directed flows and the reporting status (spec 6: no separate matrix file).
//
// Cell states (decided 2026-11-03, docs/DECISIONS.md):
//   value        flow > 0                                  -> shade (log scale)
//   zero         exporter reported that year, no record    -> white
//   zero-dagger  exporter did not report, importer did, no record -> white + hatching
//   nodata       neither side reported                     -> grey
//   dagger       importer's report used: single pair = any; group cell = share >= threshold
//   group-diag   within EU27 / within RoW                  -> not shown ("—"), not in totals
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Legend steps with distinct labels only (a repeated label, e.g. two "<1 t", is shown once)
function rampLegend(ts, label) {
    const seen = new Set();
    return ts.map(t => [t, label(t)]).filter(([, l]) => { if (seen.has(l)) return false; seen.add(l); return true; });
}

export const MatrixView = {
    el: null,
    _cells: null,

    init(el) {
        this.el = el;
        // re-fit when the space changes (header wrap, fonts, window size)
        let h = 0;
        new ResizeObserver(() => {
            const nh = Math.round(el.clientHeight);
            if (Math.abs(nh - h) < 4 || el.classList.contains('hidden') || !this._lastFlows) { h = nh; return; }
            h = nh;
            cancelAnimationFrame(this._roRaf);
            this._roRaf = requestAnimationFrame(() => this.render(this._lastFlows));
        }).observe(el);
    },

    order() {
        const named = STATE.meta.matrix.order;
        if (STATE.preset === 'SAS') {
            const m = STATE.meta.presets.SAS.members;
            return [...m, ...['CHN', 'JPN', 'KOR', 'USA', 'EU27', 'RoW'].filter(x => !m.includes(x))];
        }
        return named;
    },

    members(g, named) {
        if (g === 'EU27') return STATE.meta.groups.EU27;
        if (g === 'RoW') {
            const eu = new Set(STATE.meta.groups.EU27);
            return Object.keys(STATE.eco).filter(iso => !named.has(iso) && !eu.has(iso));
        }
        return [g];
    },

    compute(flows) {
        const order = this.order();
        const named = new Set(order.filter(g => g !== 'EU27' && g !== 'RoW'));
        const year = STATE.year;
        const fmap = new Map(flows.map(d => [`${d.e}|${d.i}`, d]));
        const thr = STATE.buildInfo?.matrix?.dagger_hatch_share ?? 0.10;
        const showDiag = STATE.buildInfo?.matrix?.show_group_diagonal ?? false;
        const mem = Object.fromEntries(order.map(g => [g, this.members(g, named)]));
        const cells = [];
        order.forEach((ga, a) => order.forEach((gb, b) => {
            const single = named.has(ga) && named.has(gb);
            const c = { a, b, ga, gb, single, v: 0, vDag: 0, vEst: 0, nFlows: 0, nNoData: 0, nNoWeight: 0, parts: [] };
            if (ga === gb && single) { c.state = 'self'; cells.push(c); return; }
            if (ga === gb && !showDiag) { c.state = 'group-diag'; cells.push(c); return; }
            let hasData = false, zeroDagger = false;
            for (const e of mem[ga]) {
                for (const i of mem[gb]) {
                    if (e === i) continue;
                    const d = fmap.get(`${e}|${i}`);
                    if (d) {
                        hasData = true;
                        const v = DataLoader.val(d);
                        if (v == null) { c.nNoWeight++; continue; }
                        if (v > 0) {
                            c.v += v; c.nFlows++;
                            if (d.src === 'm') c.vDag += v;
                            if (DataLoader.isEst(d)) c.vEst += v;
                            c.parts.push(d);
                        }
                    } else if (DataLoader.reported(e, year, 'X')) {
                        hasData = true;
                    } else if (DataLoader.reported(i, year, 'M')) {
                        hasData = true;
                        if (single) zeroDagger = true;
                    } else {
                        c.nNoData++;
                    }
                }
            }
            c.partial = hasData && c.nNoData > 0;
            if (!hasData) c.state = 'nodata';
            else if (c.v > 0) c.state = (single ? c.vDag > 0 : c.vDag / c.v >= thr) ? 'dagger' : 'value';
            else c.state = zeroDagger ? 'zero-dagger' : 'zero';
            c.parts.sort((x, y) => DataLoader.val(y) - DataLoader.val(x));
            cells.push(c);
        }));
        this._cells = cells;
        return { order, cells };
    },

    render(flows) {
        if (!this.el) return;
        const a = document.activeElement;
        const keep = a && this.el.contains(a) && a.dataset?.cell ? a.dataset.cell : null;
        this._render(flows);
        if (keep) {
            const c = this.el.querySelector(`.mx-cell[data-cell="${keep}"]`);
            if (c) { this.el.querySelectorAll('.mx-cell[tabindex="0"]').forEach(e => e.setAttribute('tabindex', -1)); c.setAttribute('tabindex', 0); c.focus({ preventScroll: true }); }
        }
    },

    _render(flows) {
        this._lastFlows = flows;
        const { order, cells } = this.compute(flows);
        const n = order.length;
        const box = this.el.getBoundingClientRect();
        // Wide screens: legend beside the matrix; otherwise below it.
        const side = box.width >= 1100;
        const legendH = side ? 70 : 150, legendW = side ? 300 : 0;   // includes the container and card padding
        const left = 52, top = 58, totW = 64, totH = 52;
        const cs = Math.max(18, Math.min((box.width - left - totW - 16 - legendW) / n, (box.height - top - totH - legendH) / n));
        const W = left + cs * n + totW, H = top + cs * n + totH;

        // Log shade between the existing blue tokens (spec 0.3, 7.3).
        const pos = cells.filter(c => c.v > 0 && !['self', 'group-diag'].includes(c.state)).map(c => c.v);
        const lo = Math.log(Math.max(d3.min(pos) || 1, 1e-3)), hi = Math.log(Math.max(d3.max(pos) || 1, 1e-3));
        const tOf = v => (hi > lo ? Math.min(1, Math.max(0, (Math.log(v) - lo) / (hi - lo))) : 0.7);
        cells.forEach(c => { c.t = c.v > 0 ? tOf(c.v) : 0; });
        const ramp = d3.interpolateRgbBasis([css('--unblue-bg'), css('--un-blue-light'),
            css('--un-blue'), css('--un-blue-dark')]);
        const fill = c => {
            if (c.state === 'nodata') return css('--grey-bg');
            if (c.state === 'value' || c.state === 'dagger') return ramp(c.t);
            return 'white';
        };

        // the same cell keeps its identity across a change of year, product or measure: its shade moves to the new one
        // (docs/design/MOTION_V6.md)
        const was = new Map();
        if (motionOn() && this.el.offsetParent) this.el.querySelectorAll('.mx-cell').forEach(g => { const r = g.querySelector('rect.mx-rect'); if (r) was.set(g.dataset.cell, r.getAttribute('fill')); });
        this.el.innerHTML = '';
        const wrap = d3.select(this.el).append('div').attr('class', `mx-wrap${side ? ' side' : ''}`);
        const svg = wrap.append('svg').attr('class', 'mx-svg').attr('width', W).attr('height', H)
            .attr('role', 'group').attr('aria-label', 'Origin-destination matrix');
        const defs = svg.append('defs');
        const pat = defs.append('pattern').attr('id', 'mx-hatch').attr('patternUnits', 'userSpaceOnUse')
            .attr('width', 5).attr('height', 5).attr('patternTransform', 'rotate(45)');
        pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5)
            .attr('stroke', css('--grey-text')).attr('stroke-width', 1).attr('stroke-opacity', 0.55);

        const g = svg.append('g');
        // column / row labels
        g.selectAll('.mx-col').data(order).enter().append('text').attr('class', 'mx-lab mx-col')
            .attr('transform', (d, k) => `translate(${left + cs * k + cs / 2},${top - 6}) rotate(-60)`)
            .text(d => d);
        g.selectAll('.mx-row').data(order).enter().append('text').attr('class', 'mx-lab mx-row')
            .attr('x', left - 6).attr('y', (d, k) => top + cs * k + cs / 2 + 3).attr('text-anchor', 'end').text(d => d);
        g.append('text').attr('class', 'mx-axis').attr('x', left + cs * n / 2).attr('y', 11).attr('text-anchor', 'middle').text('Importer →');
        g.append('text').attr('class', 'mx-axis').attr('transform', `translate(11,${top + cs * n / 2}) rotate(-90)`).attr('text-anchor', 'middle').text('Exporter →');

        const cell = g.selectAll('.mx-cell').data(cells).enter().append('g').attr('class', c => `mx-cell st-${c.state}`).attr('data-cell', c => `${c.ga}-${c.gb}`)
            .attr('transform', c => `translate(${left + cs * c.b},${top + cs * c.a})`);
        cell.append('rect').attr('width', cs).attr('height', cs).attr('fill', fill).attr('class', 'mx-rect');
        cell.filter(c => c.state === 'dagger' || c.state === 'zero-dagger')
            .append('rect').attr('width', cs).attr('height', cs).attr('fill', 'url(#mx-hatch)').style('pointer-events', 'none');
        // Estimated mode: cells that include model estimates get a dotted inner frame.
        cell.filter(c => c.vEst > 0).append('rect').attr('class', 'mx-est')
            .attr('x', 2).attr('y', 2).attr('width', Math.max(0, cs - 4)).attr('height', Math.max(0, cs - 4)).style('pointer-events', 'none');
        cell.filter(c => c.state === 'self').append('line').attr('x1', 0).attr('y1', 0).attr('x2', cs).attr('y2', cs).attr('class', 'mx-self');
        cell.filter(c => c.state === 'group-diag').append('text').attr('x', cs / 2).attr('y', cs / 2 + 3)
            .attr('text-anchor', 'middle').attr('class', 'mx-dash').text('—');
        cell.filter(c => c.partial).append('path').attr('class', 'mx-partial')
            .attr('d', `M${cs},0 L${cs * 0.7},0 L${cs},${cs * 0.3} Z`);
        if (cs >= 30) {
            cell.filter(c => c.state === 'value' || c.state === 'dagger').append('text')
                .attr('x', cs / 2).attr('y', cs / 2 + 3).attr('text-anchor', 'middle')
                .attr('class', c => `mx-val ${c.t > 0.6 ? 'dark' : ''}`)
                .text(c => fmtMetric(c.v).replace('$', ''));
        }
        // totals (exclude self / group-diag / nodata)
        const counted = c => !['self', 'group-diag', 'nodata'].includes(c.state);
        const rowT = order.map((_, a) => d3.sum(cells.filter(c => c.a === a && counted(c)), c => c.v));
        const colT = order.map((_, b) => d3.sum(cells.filter(c => c.b === b && counted(c)), c => c.v));
        g.selectAll('.mx-rt').data(rowT).enter().append('text').attr('class', 'mx-tot')
            .attr('x', left + cs * n + 6).attr('y', (d, k) => top + cs * k + cs / 2 + 3).text(d => fmtMetric(d));
        g.selectAll('.mx-ct').data(colT).enter().append('text').attr('class', 'mx-tot')
            .attr('transform', (d, k) => `translate(${left + cs * k + cs / 2},${top + cs * n + 8}) rotate(60)`)
            .text(d => fmtMetric(d));
        g.append('text').attr('class', 'mx-axis').attr('x', left + cs * n + 6).attr('y', top - 6).text('Total');

        if (was.size) {
            cell.select('rect.mx-rect').each(function (c) {
                const f0 = was.get(`${c.ga}-${c.gb}`), f1 = this.getAttribute('fill');
                if (f0 && f0 !== f1 && !f0.startsWith('url') && !f1.startsWith('url')) this.animate([{ fill: f0 }, { fill: f1 }], { duration: MS.ui + 140, easing: EASE_CSS.inOut });
            });
        }
        cell.on('mouseover mousemove', (event, c) => document.dispatchEvent(new CustomEvent('bm:matrix-hover', { detail: { event, cell: c } })))
            .on('mouseout', () => document.dispatchEvent(new CustomEvent('bm:hoverend')))
            .on('click', (event, c) => {
                if (c.single && !['self', 'group-diag'].includes(c.state)) {
                    document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e: c.ga, i: c.gb } }));
                }
            });

        // Keyboard: one tab stop for the grid; arrow keys move between cells; Enter opens the pair history;
        // the cell's description (same as the tooltip) is its accessible name (P1-6).
        const plain = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        cell.attr('tabindex', c => (c.a === 0 && c.b === 1 ? 0 : -1))
            .attr('role', 'button')
            .attr('aria-label', c => plain(this.describe(c)) || `${c.ga} to ${c.gb}`)
            .on('focus', (event, c) => {
                const r = event.currentTarget.getBoundingClientRect();
                document.dispatchEvent(new CustomEvent('bm:matrix-hover', { detail: { event: { clientX: r.right, clientY: r.bottom }, cell: c } }));
            })
            .on('blur', () => document.dispatchEvent(new CustomEvent('bm:hoverend')))
            .on('keydown', (event, c) => {
                const mv = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[event.key];
                if (mv) {
                    event.preventDefault();
                    const a = Math.max(0, Math.min(n - 1, c.a + mv[0])), b = Math.max(0, Math.min(n - 1, c.b + mv[1]));
                    const next = cell.filter(q => q.a === a && q.b === b).node();
                    if (next) { cell.attr('tabindex', -1); next.setAttribute('tabindex', 0); next.focus(); }
                } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (c.single && !['self', 'group-diag'].includes(c.state)) {
                        document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e: c.ga, i: c.gb } }));
                    }
                }
            });

        const thr = STATE.buildInfo?.matrix?.dagger_hatch_share ?? 0.10;
        wrap.append('div').attr('class', 'mx-legend').html(`
            <span class="mx-key mx-ramp" aria-label="Shade scale">${rampLegend([0, 0.25, 0.5, 0.75, 1], t => (hi > lo ? tickFmt(Math.exp(lo + t * (hi - lo))) : '')).map(([t, l]) => `<span><i class="sw" style="background:${ramp(t)}"></i>${l}</span>`).join('')}<em>${STATE.metric === 'weight' ? 'Weight' : 'Value'}, log scale</em></span>
            <span class="mx-key"><i class="sw sw-zero"></i>No trade recorded (the exporter reported for this year)</span>
            <span class="mx-key"><i class="sw sw-nodata"></i>No data (neither side reported for this year)</span>
            <span class="mx-key"><i class="sw sw-dagger"></i>† Importer’s report used (group cells: ≥${Math.round(thr * 100)}% of the cell)</span>
            <span class="mx-key"><i class="sw sw-partial"></i>Group cell: some pairs have no data</span>
            ${STATE.basis === 'estimated' ? '<span class="mx-key"><i class="sw sw-est"></i>Includes experimental estimates</span>' : ''}
            <span class="mx-note">EU27 = UNCTADstat group 3412. Trade within groups is not shown (—) and is not in the totals. Select a cell between two economies for its history.</span>`);
        // The first render can happen before the header has its final height: fit once more if it overflows.
        if (!this._refit && this.el.scrollHeight > this.el.clientHeight + 4) {
            this._refit = true;
            requestAnimationFrame(() => { this.render(flows); this._refit = false; });   // keeps the focus (render)
        }
    },

    describe(c) {
        const name = g => STATE.countryNames[g] || (g === 'RoW' ? 'Rest of world' : g);
        const lines = [];
        const s = {
            value: 'Exporter’s report', dagger: c.single ? '† Reported by the importer (the exporter did not report for this year)' : `Includes importer’s reports († ${Math.round(100 * c.vDag / c.v)}% of the cell)`,
            zero: 'No trade recorded (the exporter reported for this year)',
            'zero-dagger': 'The exporter did not report for this year; the importer recorded no imports from it.',
            nodata: 'No data: neither side reported for this year',
            self: 'Within the same economy (not shown)', 'group-diag': 'Trade within the group is not shown',
        }[c.state];
        lines.push(`<div class="tt-title">${name(c.ga)} → ${name(c.gb)}</div>`);
        if (c.v > 0) lines.push(`<div class="tt-big">${fmtMetric(c.v)}</div>`);
        if (s) lines.push(`<div class="tt-note">${s}</div>`);
        if (!c.single && c.v > 0 && c.vDag > 0 && c.state !== 'dagger') lines.push(`<div class="tt-note">† share: ${(100 * c.vDag / c.v).toFixed(1)}%</div>`);
        if (c.partial) lines.push(`<div class="tt-note">${c.nNoData} pair(s) with no data</div>`);
        if (c.vEst > 0) lines.push(`<div class="tt-note">Estimated: ${(100 * c.vEst / c.v).toFixed(0)}% of the cell (experimental estimates; see Methodology)</div>`);
        if (c.nNoWeight) lines.push(`<div class="tt-note">${c.nNoWeight} flow(s) reported without weight (not counted)</div>`);
        if (!c.single && c.parts.length) {
            lines.push('<div class="tt-sub">Largest flows</div>' + c.parts.slice(0, 4).map(d =>
                `<div class="tt-row"><span>${d.e} → ${d.i}${d.src === 'm' ? ' †' : ''}</span><span>${fmtMetric(DataLoader.val(d))}</span></div>`).join(''));
        }
        return lines.join('');
    },
};
