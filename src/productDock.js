import * as d3 from 'd3';
import { STATE, fmtMetric, METRIC_FORMAT, isProvisional } from './config.js';
import { DataLoader } from './dataLoader.js';
import { cssVar } from './baseMap.js';

// Left column, "What": the product (spec 7.1, two steps: group, then detail), shown as text tabs for the group,
// a sunburst of the group and a slice table. After the "pizza" of the Non-plastic dashboard (UNCTAD,
// ../Non-plastic/dashboard/js/pizza.js and the .row lists of its style.css): the centre is the whole group,
// the ring its parts, a second ring splits lead-acid; for spent batteries the part reported without the
// HS 2022 split (HS 2017 or earlier) is hatched, so the blind spot is in the picture.
// Values: world exports, sum of the reporters' own reports (summary files), current measure and year.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TREE = {
    BAT: { root: 'BAT_ALL', ring: [{ id: 'BAT_LA', kids: ['BAT_LA_START', 'BAT_LA_OTHER'] }, { id: 'BAT_LIION' }, { id: 'BAT_OTHER' }] },
    SPENT: { root: 'SPENT_ALL', ring: [{ id: 'SPENT_11' }, { id: 'SPENT_12' }, { id: 'SPENT_13' }, { id: 'SPENT_14' }, { id: 'SPENT_19' }, { id: 'NOSPLIT' }] },
};
const COLOR = {
    BAT_LA: '--un-blue-dark', BAT_LA_START: '--un-blue-darkest', BAT_LA_OTHER: '--un-blue-text', BAT_LIION: '--un-blue', BAT_OTHER: '--grey',
    SPENT_11: '--hs-11', SPENT_12: '--hs-12', SPENT_13: '--hs-13', SPENT_14: '--hs-14', SPENT_19: '--hs-19',
};
// Short names for the table (the full label is the row's title and the KPI context)
const SHORT = {
    BAT_ALL: 'All batteries', BAT_LA: 'Lead-acid', BAT_LA_START: 'For starting engines (8507.10)', BAT_LA_OTHER: 'Other lead-acid (8507.20)',
    BAT_LIION: 'Lithium-ion (8507.60)', BAT_OTHER: 'Nickel-based and other',
    SPENT_ALL: 'All spent batteries', SPENT_11: 'Lead-acid (8549.11)', SPENT_12: 'Containing lead, cadmium or mercury (8549.12)',
    SPENT_13: 'Sorted by chemical type, no lead, cadmium or mercury (8549.13)', SPENT_14: 'Unsorted, no lead, cadmium or mercury (8549.14)', SPENT_19: 'Other (8549.19)',
};

// The hatched part is "all spent batteries" minus the five codes. By value that is the 8548.10 part (HS 2017 or earlier);
// by weight it also holds weights flagged as unreliable in one code but not in the all-codes total (WORDING_REVIEW B02,
// a data question, D7): the label says so.
const NOSPLIT_W = 'Not assigned to a code here (reported in HS 2017 or earlier, or a code’s weight flagged as unreliable)';
const NOSPLIT_W_NOTE = 'Hatched: weight not assigned to one of the five codes (reported in HS 2017 or earlier, or flagged as unreliable in one code).';

export const shortLabel = id => SHORT[id] || DataLoader.product(id)?.label || id;

export const ProductDock = {
    _seq: 0,

    async totals(group, year, metric) {
        const ids = STATE.products.groups[group].order;
        const sums = await Promise.all(ids.map(id => DataLoader.loadSummary(id)));
        const k = metric === 'weight' ? 'xw' : 'x';
        const out = {};
        ids.forEach((id, n) => {
            const yrs = DataLoader.productYears(id);
            out[id] = yrs.includes(year) ? (sums[n].world?.[String(year)]?.[k] ?? null) : null;
        });
        return out;
    },

    async render() {
        const seq = ++this._seq;
        const p = DataLoader.product();
        const group = p.group;
        const year = STATE.year, metric = STATE.metric;
        const tabs = document.getElementById('group-tabs');
        tabs.innerHTML = [['BAT', 'Batteries', 'Batteries (HS 8507), new or used'], ['SPENT', 'Spent batteries', 'Spent batteries (HS 8549.1 / 8548.10)']]
            .map(([g, l, t]) => `<button class="btn-toggle ${g === group ? 'active' : ''}" data-ctl="group" data-val="${g}" type="button" aria-pressed="${g === group}" title="${esc(t)}">${l}</button>`).join('');
        const tot = await this.totals(group, year, metric);
        if (seq !== this._seq) return;
        const tree = TREE[group];
        const rootV = tot[tree.root] || 0;
        // ring values
        const ring = tree.ring.map(n => {
            if (n.id === 'NOSPLIT') {
                const split = d3.sum(tree.ring.filter(q => q.id !== 'NOSPLIT'), q => tot[q.id] || 0);
                return { id: 'NOSPLIT', v: Math.max(0, rootV - split), kids: [] };
            }
            return { id: n.id, v: tot[n.id] || 0, kids: (n.kids || []).map(c => ({ id: c, v: tot[c] || 0 })) };
        }).filter(n => n.v > 0);
        this.drawPizza(ring, rootV, group, p.id);
        this.renderRows(group, tot, rootV, p.id, year);
        const note = document.getElementById('dock-note');
        note.textContent = group === 'SPENT'
            ? (year < 2022 ? `Before 2022, spent batteries had one HS code (8548.10): no split by chemistry.` : (metric === 'weight' ? NOSPLIT_W_NOTE : 'Hatched: reported in HS 2017 or earlier (8548.10), with no split by chemistry.'))
            : 'HS 8507 also covers used batteries that can still be used or recharged.';
    },

    drawPizza(ring, rootV, group, cur) {
        const svg = d3.select('#pizza');
        svg.selectAll('*').remove();
        const defs = svg.append('defs');
        const pt = defs.append('pattern').attr('id', 'pz-hatch').attr('width', 6).attr('height', 6).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
        pt.append('rect').attr('width', 6).attr('height', 6).attr('fill', cssVar('--nodata'));
        pt.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).attr('stroke', cssVar('--nodata-line')).attr('stroke-width', 1.6);
        const R0 = 86, R1 = 150, R2 = 190;
        const sum = d3.sum(ring, d => d.v) || 1;
        const fmt = METRIC_FORMAT[STATE.metric].fmt;
        const label = id => (id === 'NOSPLIT' ? (STATE.metric === 'weight' ? NOSPLIT_W : 'Reported in HS 2017 or earlier (8548.10, no split)') : SHORT[id] || id);
        const note = document.getElementById('pizza-note');
        const say = (id, v) => { note.textContent = id ? `${label(id)}: ${fmt(v)} · ${(100 * v / (rootV || sum)).toFixed(rootV && v / rootV < 0.1 ? 1 : 0)}%` : 'Select a slice, or the centre for the whole group.'; };
        say(null);
        let a0 = 0;
        const arc = d3.arc().padAngle(0.004).padRadius(R1);
        const g = svg.append('g');
        const pieces = [];
        ring.forEach(n => {
            const a1 = a0 + 2 * Math.PI * n.v / sum;
            if (n.kids.length) {
                pieces.push({ id: n.id, v: n.v, r0: R0, r1: R1, a0, a1 });
                const ks = d3.sum(n.kids, c => c.v) || 1;
                let b0 = a0;
                n.kids.forEach(c => { const b1 = b0 + (a1 - a0) * c.v / ks; pieces.push({ id: c.id, v: c.v, r0: R1, r1: R2, a0: b0, a1: b1 }); b0 = b1; });
            } else {
                pieces.push({ id: n.id, v: n.v, r0: R0, r1: R2, a0, a1 });
            }
            a0 = a1;
        });
        const inPath = id => {
            const q = DataLoader.product(cur);
            if (id === cur) return true;
            return id === 'BAT_LA' && (cur === 'BAT_LA_START' || cur === 'BAT_LA_OTHER');
        };
        const anySel = pieces.some(q => q.id === cur);
        g.selectAll('path.arc').data(pieces).join('path')
            .attr('class', q => `arc ${q.id === cur ? 'sel' : ''} ${anySel && !inPath(q.id) ? 'dim' : ''}`)
            .attr('d', q => arc({ innerRadius: q.r0, outerRadius: q.r1, startAngle: q.a0, endAngle: q.a1 }))
            .attr('fill', q => (q.id === 'NOSPLIT' ? 'url(#pz-hatch)' : cssVar(COLOR[q.id] || '--grey')))
            .style('cursor', q => (q.id === 'NOSPLIT' ? 'default' : 'pointer'))
            .on('mouseenter', (ev, q) => say(q.id, q.v))
            .on('mouseleave', () => say(null))
            .on('click', (ev, q) => { if (q.id !== 'NOSPLIT') document.dispatchEvent(new CustomEvent('bm:product', { detail: q.id })); })
            .append('title').text(q => `${label(q.id)}: ${fmt(q.v)}`);
        // labels on slices large enough
        g.selectAll('text.sl').data(pieces.filter(q => (q.a1 - q.a0) * (q.r0 + q.r1) / 2 > 46 && q.r1 - q.r0 > 30)).join('text')
            .attr('class', q => `sl ${q.id === 'NOSPLIT' || q.id === 'SPENT_19' || q.id === 'BAT_OTHER' ? 'dark' : ''}`)
            .attr('transform', q => { const c = arc.centroid({ innerRadius: q.r0, outerRadius: q.r1, startAngle: q.a0, endAngle: q.a1 }); return `translate(${c[0]},${c[1]})`; })
            .text(q => `${Math.round(100 * q.v / sum)}%`);
        // centre: the whole group
        const c = svg.append('g').attr('class', 'center');
        c.append('circle').attr('class', 'hole').attr('r', R0 - 6);
        const all = STATE.products.groups[group].default;
        c.append('text').attr('class', 'c-eyebrow').attr('y', -24).text(group === 'BAT' ? 'All batteries' : 'All spent batteries');
        c.append('text').attr('class', 'c-big').attr('y', 4).text(fmt(rootV));
        c.append('text').attr('class', 'c-sub').attr('y', 28).text(`exports, ${STATE.year}${isProvisional(STATE.year) ? 'ᵖ' : ''}`);
        c.append('circle').attr('class', 'center-hit').attr('r', R0 - 6)
            .on('click', () => document.dispatchEvent(new CustomEvent('bm:product', { detail: all })))
            .append('title').text(`${group === 'BAT' ? 'All batteries' : 'All spent batteries'}: ${fmt(rootV)}`);
        if (cur === all) c.select('.hole').attr('stroke', cssVar('--grey-dark')).attr('stroke-width', 1.2);
        svg.attr('aria-label', `${group === 'BAT' ? 'Batteries' : 'Spent batteries'}: world exports ${fmt(rootV)} in ${STATE.year}, by product. `
            + pieces.map(q => `${label(q.id)} ${Math.round(100 * q.v / sum)}%`).join(', '));
    },

    renderRows(group, tot, rootV, cur, year) {
        const el = document.getElementById('slice-list');
        const ids = STATE.products.groups[group].order;
        const max = Math.max(...ids.map(id => tot[id] || 0), 1);
        const head = `<div class="group-h">${group === 'BAT' ? 'Batteries (HS 8507)' : 'Spent batteries (HS 8549.1 / 8548.10)'} <span>${METRIC_FORMAT[STATE.metric].unit === 'USD' ? 'US$' : 't'}, ${year}${isProvisional(year) ? 'ᵖ' : ''}</span></div>`;
        el.innerHTML = head + ids.map(id => {
            const q = DataLoader.product(id);
            const v = tot[id];
            const on = id === cur;
            const sub = id === 'BAT_LA_START' || id === 'BAT_LA_OTHER';
            const share = rootV && v != null ? 100 * v / rootV : null;
            const vtxt = v == null ? `<abbr title="This code exists from 2022 (HS 2022)">from 2022</abbr>` : `${fmtMetric(v)}${id !== STATE.products.groups[group].default && share != null ? ` · ${share < 10 ? share.toFixed(1) : Math.round(share)}%` : ''}`;
            const col = COLOR[id] ? `var(${COLOR[id]})` : 'var(--grey-text)';
            return `<button class="row ${on ? 'on' : ''} ${sub ? 'sub' : ''} ${v == null ? 'dim' : ''}" type="button" data-ctl="product" data-val="${id}" aria-pressed="${on}" title="${esc(q.label)}" style="--c:${col}">
                <span class="sw" style="background:${COLOR[id] ? col : 'transparent'}"></span><span class="nm">${esc(SHORT[id] || q.label)}</span><span class="vl">${vtxt}</span>
                <span class="bar" aria-hidden="true"><i style="width:${v ? (100 * v / max).toFixed(1) : 0}%"></i></span></button>`;
        }).join('');
    },
};
