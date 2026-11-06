import * as d3 from 'd3';
import { STATE, METRIC_FORMAT, isProvisional, tickFmt } from './config.js';
import { DataLoader } from './dataLoader.js';
import { MatrixView } from './matrixView.js';
import { cssVar } from './baseMap.js';
import { POLICY_TIMELINE, SOURCES } from './storyData.js';
import { Calc, usd, tonnes, pct, yr } from './storyFindings.js';
import { motionOn, MS } from './motion.js';
import { EASE_CSS, hold } from './transitions.js';

// Charts for the story stage (docs/design/STORY_V5.md). Data come from public/data only, through the same
// calculations as the chapter text (src/storyFindings.js Calc), so a chart shows what its text says; the
// economies the text names are marked. Text from documents appears only in the policy time line (storyData.js).
// Colours are CSS classes (src/styles/style.css) or CSS tokens read at run time.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Log-axis ticks: powers of ten, plus 2 and 5 when the range is short.
export function logTicks(x) {
    const all = x.ticks();
    const lead = v => +v.toExponential().split('e')[0];
    let t = all.filter(v => lead(v) === 1);
    if (t.length < 3) t = all.filter(v => [1, 2, 5].includes(lead(v)));
    if (t.length > 7) t = t.filter((v, k) => k % 2 === 0);
    return t;
}
// Economy names: the UNCTADstat names from meta.json, unchanged (no home-made short forms)
export const shortName = iso => STATE.countryNames[iso] || iso;
const P = y => `${y}${isProvisional(y) ? 'ᵖ' : ''}`;

// Tiny tooltip inside the stage
function tip(stage) {
    let t = stage.querySelector('.st-tip');
    if (!t) { t = document.createElement('div'); t.className = 'st-tip'; stage.appendChild(t); }
    return {
        show(ev, html) {
            t.innerHTML = html; t.style.display = 'block';
            const r = stage.getBoundingClientRect(), b = t.getBoundingClientRect();
            let x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
            if (x + b.width > r.width - 8) x = ev.clientX - r.left - b.width - 14;
            if (y + b.height > r.height - 8) y = r.height - b.height - 8;
            t.style.left = x + 'px'; t.style.top = y + 'px';
        },
        hide() { t.style.display = 'none'; },
    };
}

// Marks grow from their baseline the first time a chart is drawn (opts.grow: a chapter reached with Next / Back, a
// question page); on a direct link, with reduced motion or with motion off a chart appears at once. Only transform
// and opacity are animated (Web Animations); `order(el, k)` gives each mark its place in the stagger.
export function grow(nodes, axis, { base = 0, delay = 0, step = 0, ms = MS.data, order = (el, k) => k } = {}) {
    if (!motionOn()) return;
    [...nodes].forEach((el, k) => {
        if (!el.animate) return;
        if (axis === 'y') { el.style.transformBox = 'fill-box'; el.style.transformOrigin = `50% ${Math.max(0, base - (+el.getAttribute('y') || 0))}px`; }
        else el.style.transformOrigin = 'left center';
        hold(el.animate([{ transform: axis === 'y' ? 'scaleY(0)' : 'scaleX(0)' }, { transform: 'none' }], { duration: ms, delay: delay + order(el, k) * step, easing: EASE_CSS.out, fill: 'backwards' }));
    });
}
export function fadeIn(nodes, { delay = 0, step = 0, ms = MS.ui, order = (el, k) => k } = {}) {
    if (!motionOn()) return;
    [...nodes].forEach((el, k) => hold(el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: ms, delay: delay + order(el, k) * step, easing: EASE_CSS.out, fill: 'backwards' })));
}
// a line drawn on from its start (the exporter's report) to its end (the importer's)
function drawOn(nodes, { delay = 0, step = 0, ms = MS.data } = {}) {
    if (!motionOn()) return;
    [...nodes].forEach((el, k) => {
        const L = Math.abs((+el.getAttribute('x2') || 0) - (+el.getAttribute('x1') || 0)) + Math.abs((+el.getAttribute('y2') || 0) - (+el.getAttribute('y1') || 0));
        if (!L || !el.animate) return;
        el.style.strokeDasharray = `${L} ${L}`;
        const a = hold(el.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: ms, delay: delay + k * step, easing: EASE_CSS.out, fill: 'backwards' }));
        a.finished.then(() => { el.style.strokeDasharray = ''; }, () => {});
    });
}

function frame(el, { kicker, title, sub, note, foot }) {
    el.innerHTML = `<div class="stc">
        <div class="stc-head">${kicker ? `<div class="stc-kicker">${esc(kicker)}</div>` : ''}
          <div class="stc-title">${esc(title)}</div>${sub ? `<div class="stc-sub">${sub}</div>` : ''}</div>
        <div class="stc-body"></div>
        <div class="stc-foot">${foot != null ? esc(foot) : `${note ? esc(note) + ' ' : ''}Source: UN Comtrade; UNCTAD calculations.`}</div>
      </div>`;
    return el.querySelector('.stc-body');
}
const REGION_ORDER = ['5300', '5400', '5200', '5100', '5500'];

export const StoryCharts = {
    _summaries: {},
    summary(kind) { return this._summaries[kind] || ''; },

    // ── Chapter 1: world exports of lead-acid and lithium-ion batteries, 2016-2024 (exporters' own reports, value).
    // setYear(y) shows the years up to y (the chapter plays through the years).
    async boom(el, stage, opts = {}) {
        const c = await Calc.boom();
        const years = c.years, rows = c.rows;
        const series = [
            { key: 'li', label: 'Lithium-ion (8507.60)' },
            { key: 'la', label: 'Lead-acid (8507.10, 8507.20)' },
        ];
        const fmt = v => usd(v);
        const r0 = rows[0], r1 = rows[rows.length - 1];
        const liShare = r1.t > r0.t ? (r1.li - r0.li) / (r1.t - r0.t) : null;
        const body = frame(el, {
            kicker: `UN Comtrade data · world exports, US dollars, ${r0.y}–${P(r1.y)}`,
            title: liShare != null && liShare > 0.5
                ? `Lithium-ion batteries account for ${Math.round(liShare * 100)}% of the growth in lead-acid and lithium-ion battery exports since ${r0.y}`
                : `World exports of lead-acid and lithium-ion batteries, ${r0.y}–${r1.y}`,
            note: `Sum of exporters’ own reports. ${r1.y} is provisional (${r1.n} reporters).`,
        });
        const legend = d3.select(body).append('div').attr('class', 'stc-legend');
        const legItems = series.map(s => legend.append('span').html(`<i class="sw bc-${s.key}"></i>${esc(s.label)}`));
        const W = body.clientWidth || 600;
        const narrow = W < 520;
        const H = Math.max(180, Math.min((body.clientHeight || 300) - legend.node().offsetHeight - 8, narrow ? 260 : 9999));
        const m = { t: 26, r: narrow ? 10 : 150, b: 24, l: narrow ? 46 : 54 };
        const x = d3.scaleBand().domain(years).range([m.l, W - m.r]).paddingInner(0.28).paddingOuter(0.1);
        const y = d3.scaleLinear().domain([0, d3.max(rows, r => r.t) * 1.12]).nice().range([H - m.b, m.t]);
        const svg = d3.select(body).append('svg').attr('width', W).attr('height', H).attr('class', 'stc-svg')
            .attr('role', 'img').attr('aria-label', `Column chart: world exports of lead-acid and lithium-ion batteries by value, ${r0.y} to ${r1.y}`);
        svg.append('g').attr('class', 'stc-grid').attr('transform', `translate(${m.l},0)`)
            .call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(v => tickFmt(v, 'value')))
            .call(g => g.select('.domain').remove());
        svg.append('g').attr('class', 'stc-axis').attr('transform', `translate(0,${H - m.b})`)
            .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat(y0 => (narrow ? `’${String(y0).slice(2)}` : String(y0)) + (isProvisional(y0) ? 'ᵖ' : '')))
            .call(g => g.select('.domain').remove());
        const bw = Math.min(30, x.bandwidth());
        const cols = svg.append('g').selectAll('g').data(rows).enter().append('g')
            .attr('class', 'stc-col').attr('transform', r => `translate(${x(r.y) + (x.bandwidth() - bw) / 2},0)`);
        series.forEach((s, n) => {
            const below = r => series.slice(0, n).reduce((a, q) => a + r[q.key], 0);
            cols.append('rect').attr('class', `bc-${s.key}`).attr('x', 0).attr('width', bw)
                .attr('y', r => y(below(r) + r[s.key]))
                .attr('height', r => Math.max(0, y(below(r)) - y(below(r) + r[s.key]) - (n ? 2 : 0)))
                .attr('rx', n === series.length - 1 ? 2 : 0);
        });
        // annotations: the first column's total, the current column's total, the year lithium-ion overtook lead-acid
        const ann = svg.append('g').attr('class', 'stc-ann');
        const totLab = (r, cls) => ann.append('text').attr('class', cls).attr('x', x(r.y) + x.bandwidth() / 2).attr('y', y(r.t) - 6).attr('text-anchor', 'middle').text(narrow ? usd(r.t).replace('USD ', '') : usd(r.t));
        totLab(r0, 'stc-tot');
        if (c.over && c.over > r0.y) {
            const ro = rows.find(r => r.y === c.over);
            ann.append('text').attr('class', 'stc-note-t').attr('x', x(ro.y) + x.bandwidth() / 2).attr('y', y(ro.t) - 20).attr('text-anchor', 'middle').text('lithium-ion ahead');
        }
        const curLab = ann.append('text').attr('class', 'stc-tot now').attr('text-anchor', 'middle');
        const T = tip(stage);
        cols.append('rect').attr('class', 'stc-hit').attr('x', -4).attr('width', bw + 8).attr('y', m.t).attr('height', H - m.t - m.b)
            .on('mousemove', (ev, r) => T.show(ev, `<b>${r.y}${isProvisional(r.y) ? ' (provisional)' : ''}</b>${series.map(s =>
                `<div class="st-tip-row"><i class="sw bc-${s.key}"></i>${esc(s.label)}<span>${fmt(r[s.key])}</span></div>`).join('')}
                <div class="st-tip-row tot">Total<span>${fmt(r.t)}</span></div>`))
            .on('mouseleave', () => T.hide());
        const lab = svg.append('g').attr('class', 'stc-labels');
        this._summaries.boom = `Chart, UN Comtrade data: world exports of lithium-ion and lead-acid batteries by value. `
            + series.map(s => `${s.label.split(' (')[0]}: ${fmt(r0[s.key])} in ${r0.y}, ${fmt(r1[s.key])} in ${r1.y}.`).join(' ');
        const api = {
            setYear: (yy) => {
                const idx = Math.max(0, years.indexOf(+yy));
                cols.classed('is-future', (r, n) => n > idx).classed('is-now', (r, n) => n === idx);
                const r = rows[idx];
                curLab.attr('x', x(r.y) + x.bandwidth() / 2).attr('y', y(r.t) - 6).text(idx ? (narrow ? usd(r.t).replace('USD ', '') : usd(r.t)) : '');
                if (narrow) legItems.forEach((li, k) => li.html(`<i class="sw bc-${series[k].key}"></i>${esc(series[k].label.split(' (')[0])} ${fmt(r[series[k].key])}`));
                lab.selectAll('*').remove();
                if (narrow) return;
                let acc = 0;
                const xx = x(r.y) + (x.bandwidth() + bw) / 2 + 8;
                const placed = [];
                series.forEach(s => {
                    const mid = y(acc + r[s.key] / 2); acc += r[s.key];
                    if (!r[s.key]) return;
                    let yy = mid;
                    placed.forEach(q => { if (Math.abs(q - yy) < 13) yy = q - 13; });
                    placed.push(yy);
                    lab.append('text').attr('x', xx).attr('y', yy + 4).text(`${s.label.split(' (')[0]} ${fmt(r[s.key])}`);
                });
            },
        };
        api.setYear(opts.year ?? opts0(years));
        if (opts.grow) {
            grow(cols.selectAll('rect:not(.stc-hit)').nodes(), 'y', { base: y(0), step: 45, order: el => years.indexOf(d3.select(el).datum()?.y) });
            fadeIn(svg.selectAll('.stc-ann, .stc-labels').nodes(), { delay: MS.data + 45 * years.length * 0.6 });
        }
        return api;
    },

    // ── Chapter 2: the same batteries by weight: 2016 and 2024, and the exporters' regions in 2024
    async weight(el, stage, opts = {}) {
        const c = await Calc.weight();
        const sides = [c.la, c.li];
        const max = d3.max(sides, s => Math.max(s.w0, s.w1)) || 1;
        const body = frame(el, {
            kicker: `UN Comtrade data · world exports, tonnes`,
            title: 'By weight, lead-acid still leads; lithium-ion comes mostly from Asia',
            sub: `Exporters’ own reports, ${c.y0} and ${P(c.y1)}. Weights flagged as unreliable are left out.`,
        });
        const regs = REGION_ORDER.filter(r => sides.some(s => s.regions.some(x => x.r === r)));
        const bar = (s) => `<div class="wt-row"><span class="wt-lab">${esc(s.label)}</span>
              <span class="wt-pair">
                <span class="wt-bar"><i class="wt-b0 bc-${s.key}" style="width:${(72 * s.w0 / max).toFixed(2)}%"></i><em>${c.y0}: ${esc(tonnes(s.w0))}</em></span>
                <span class="wt-bar"><i class="wt-b1 bc-${s.key}" style="width:${(72 * s.w1 / max).toFixed(2)}%"></i><em>${P(c.y1)}: ${esc(tonnes(s.w1))}</em></span>
              </span></div>`;
        const stack = (s) => `<div class="wt-row"><span class="wt-lab">${esc(s.label)}</span><span class="wt-stack">${regs.map(r => {
            const x = s.regions.find(q => q.r === r);
            if (!x || x.s <= 0) return '';
            return `<span class="wt-seg rg-${r}${x.s < 0.2 ? ' sm' : ''}" style="flex-basis:${(100 * x.s).toFixed(2)}%" title="${esc(x.name)}: ${pct(x.s)}">${x.s >= 0.1 ? `${esc(x.name)} ${pct(x.s)}` : ''}</span>`;
        }).join('')}</span></div>`;
        body.innerHTML = `<div class="wt-chart" role="img" aria-label="Bars: weight of lead-acid and lithium-ion battery exports, and the regions they came from">
              <div class="wt-h">Weight of world exports</div>${sides.map(bar).join('')}
              <div class="wt-h">Where the weight came from, ${P(c.y1)} (region of the exporter)</div>${sides.map(stack).join('')}
            </div>
            <div class="stc-legend">${regs.map(r => `<span><i class="sw rg-${r}"></i>${esc(STATE.meta.regions[r] || r)}</span>`).join('')}</div>`;
        if (opts.grow) {
            grow(body.querySelectorAll('.wt-bar i'), 'x', { step: 70 });
            grow(body.querySelectorAll('.wt-stack'), 'x', { delay: 200, step: 90, ms: MS.data + 100 });
            fadeIn(body.querySelectorAll('.wt-bar em, .wt-seg'), { delay: MS.data });
        }
        this._summaries.weight = 'Chart, UN Comtrade data: weight of battery exports. ' + sides.map(s => `${s.label}: ${tonnes(s.w0)} in ${c.y0}, ${tonnes(s.w1)} in ${c.y1}; `
            + s.regions.slice(0, 3).map(x => `${x.name} ${pct(x.s)}`).join(', ') + '.').join(' ');
        return {};
    },

    // ── Chapter 3: the largest corridors of spent lead-acid batteries and the point where they reach half the weight
    async conc(el, stage, opts = {}) {
        const c = await Calc.spent();
        const N = Math.max(10, c.n + 4);
        const top = c.flows.slice(0, N);
        const fmt = METRIC_FORMAT.weight.fmt;
        const named = new Set(opts.named || []);
        const body = frame(el, {
            kicker: 'UN Comtrade data',
            title: `${c.n} flows carry half of the recorded weight of spent lead-acid batteries`,
            sub: `Spent lead-acid batteries (8549.11), ${P(c.y1)}, largest ${top.length} of ${c.flows.length.toLocaleString('en-US')} directed flows by weight.`,
            note: '† the importer’s report (the exporter did not report for the year).',
        });
        const max = top[0]?.w || 1;
        let cum = 0;
        const T = tip(stage);
        body.innerHTML = `<div class="cn-chart" role="img" aria-label="Ranked bars: largest flows of spent lead-acid batteries by weight, with the share of the world total they add up to">
            <div class="cn-row cn-head"><span></span><span>Exporter → importer</span><span class="ar">Weight</span><span class="ar">Running share</span></div>
            ${top.map((d, k) => {
                cum += d.w;
                const s = cum / c.tot;
                const isNamed = named.has(d.e) && (named.has(d.i) || k === 0);
                return `<div class="cn-row${k < c.n ? ' in' : ''}${isNamed ? ' is-named' : ''}" data-k="${k}"><span class="cn-rank">${k + 1}</span>
                  <span class="cn-pair"><i class="cn-bar" style="width:${(100 * d.w / max).toFixed(2)}%"></i><span class="cn-nm">${esc(shortName(d.e))} → ${esc(shortName(d.i))}${d.src === 'm' ? ' <b class="dag">†</b>' : ''}</span></span>
                  <span class="cn-v">${fmt(d.w)}</span><span class="cn-s">${pct(s)}</span></div>${k === c.n - 1 ? `<div class="cn-half"><span>Half of the recorded weight is reached here: ${c.n} of ${c.flows.length.toLocaleString('en-US')} flows</span></div>` : ''}`;
            }).join('')}</div>`;
        if (opts.grow) {
            grow(body.querySelectorAll('.cn-bar'), 'x', { step: 28 });
            fadeIn(body.querySelectorAll('.cn-half'), { delay: MS.data + 28 * c.n });
        }
        body.querySelectorAll('.cn-row[data-k]').forEach(r => {
            const d = top[+r.dataset.k];
            r.addEventListener('mousemove', ev => T.show(ev, `<b>${esc(shortName(d.e))} → ${esc(shortName(d.i))}</b>
                <div class="st-tip-row">${d.src === 'm' ? 'Importer’s report' : 'Exporter’s report'}<span>${fmt(d.w)}</span></div>
                <div class="st-tip-row">Share of the recorded weight<span>${pct(d.w / c.tot)}</span></div>`));
            r.addEventListener('mouseleave', () => T.hide());
        });
        this._summaries.conc = `Chart, UN Comtrade data: the ${top.length} largest flows of spent lead-acid batteries by weight, ${c.y1}. The first ${c.n} carry half of the weight. `
            + top.slice(0, c.n).map(d => `${shortName(d.e)} to ${shortName(d.i)}: ${fmt(d.w)}.`).join(' ');
        return {};
    },

    // ── Chapter 4: two reports of the same trade (dumbbell, log scale); the row the text names is marked
    async gap(el, stage, opts = {}) {
        const product = opts.product || 'SPENT_11', year = opts.year || 2024, metric = opts.metric || 'weight';
        const flows = await DataLoader.loadFlows(product, year);
        const xk = metric === 'weight' ? 'xw' : 'xv', mk = metric === 'weight' ? 'mw' : 'mv';
        // Same rule as the explorer's Two reports view: largest by the larger of the two reports.
        const big = d => Math.max(d[xk] || 0, d[mk] || 0);
        const top = flows.filter(d => d.src !== 'e' && big(d) > 0).sort((a, b) => big(b) - big(a)).slice(0, opts.n || 12);
        const fmt = METRIC_FORMAT[metric].fmt;
        const p = DataLoader.product(product);
        const mark = opts.mark ? `${opts.mark.e}|${opts.mark.i}` : null;
        const body = frame(el, {
            kicker: 'UN Comtrade data',
            title: 'The same flows, as reported by each side',
            sub: `${esc(p.label)}, ${year}${isProvisional(year) ? ' (provisional)' : ''}, ${metric}. Largest ${top.length} flows.`,
            note: 'Log scale. Ratio = importer’s report ÷ exporter’s report. † the exporter did not report for the year.',
        });
        const legend = d3.select(body).append('div').attr('class', 'stc-legend');
        legend.append('span').html('<i class="dot db-x"></i>Exporter’s report');
        legend.append('span').html('<i class="dot db-m"></i>Importer’s report');
        if (mark) legend.append('span').attr('class', 'db-mark-key').html('<i class="sw db-mark-sw"></i>Named in the text');
        const W = body.clientWidth || 600;
        const narrow = W < 520;   // phone: ISO codes instead of names
        const rowH = 26, m = { t: 22, r: narrow ? 96 : 116, b: 8, l: narrow ? 84 : Math.max(190, Math.min(320, W * 0.32)) };
        const H = m.t + rowH * top.length + m.b;
        const vals = top.flatMap(d => [d[xk], d[mk]]).filter(v => v > 0);
        const x = d3.scaleLog().domain([d3.min(vals) / 1.6, d3.max(vals) * 1.4]).range([m.l, W - m.r]);
        const svg = d3.select(body).append('svg').attr('width', W).attr('height', H).attr('class', 'stc-svg')
            .attr('role', 'img').attr('aria-label', 'Dumbbell chart comparing exporter and importer reports for the largest flows');
        svg.append('g').attr('class', 'stc-grid').attr('transform', `translate(0,${m.t - 6})`)
            .call(d3.axisTop(x).tickValues(logTicks(x)).tickSize(-(H - m.t)).tickFormat(v => tickFmt(v, metric)))
            .call(g => g.select('.domain').remove());
        this._summaries.gap = `Chart, UN Comtrade data: exporter's and importer's reports for the largest ${top.length} flows of ${p.label}, ${year}. `
            + top.slice(0, 5).map(d => `${shortName(d.e)} to ${shortName(d.i)}: exporter ${d[xk] == null ? 'no report' : fmt(d[xk])}, importer ${d[mk] == null ? 'no report' : fmt(d[mk])}.`).join(' ');
        const T = tip(stage);
        const g = svg.append('g').selectAll('g').data(top).enter().append('g')
            .attr('class', d => `db-row${mark === `${d.e}|${d.i}` ? ' is-named' : ''}`).attr('transform', (d, k) => `translate(0,${m.t + k * rowH + rowH / 2})`);
        g.append('rect').attr('class', 'stc-hit').attr('x', 0).attr('y', -rowH / 2).attr('width', W).attr('height', rowH);
        g.append('text').attr('class', 'db-lab').attr('x', m.l - 10).attr('y', 4).attr('text-anchor', 'end')
            .text(d => (narrow ? `${d.e} → ${d.i}` : `${shortName(d.e)} → ${shortName(d.i)}`) + (d.src === 'm' ? ' †' : ''));
        g.filter(d => d[xk] > 0 && d[mk] > 0).append('line').attr('class', 'db-link')
            .attr('x1', d => x(d[xk])).attr('x2', d => x(d[mk]));
        g.filter(d => d[mk] > 0).append('circle').attr('class', 'db-m').attr('r', 5).attr('cx', d => x(d[mk]));
        g.filter(d => d[xk] > 0).append('circle').attr('class', 'db-x').attr('r', 5).attr('cx', d => x(d[xk]));
        g.append('text').attr('class', 'db-ratio').attr('x', W - m.r + 8).attr('y', 4)
            .text(d => (d[xk] > 0 && d[mk] > 0) ? `×${(d[mk] / d[xk]).toFixed(d[mk] / d[xk] >= 10 ? 0 : 2)}` : (d[xk] > 0 ? 'exporter only' : d.src === 'm' ? 'importer only' : narrow ? 'importer only' : 'no exporter record'));   // no map on a question page: say why there is one report (short on a phone)
        if (opts.grow) {
            // each row: the exporter's report first, then the line to the importer's report, then that report
            fadeIn(g.selectAll('circle.db-x').nodes(), { step: 40, ms: MS.micro, order: el => top.indexOf(d3.select(el).datum()) });
            drawOn(g.selectAll('line.db-link').nodes(), { delay: 80, step: 40 });
            fadeIn(g.selectAll('circle.db-m').nodes(), { delay: MS.data * 0.8, step: 40, ms: MS.micro, order: el => top.indexOf(d3.select(el).datum()) });
            fadeIn(g.selectAll('text.db-ratio').nodes(), { delay: MS.data + 40 * top.length * 0.5 });
        }
        g.on('mousemove', (ev, d) => T.show(ev, `<b>${esc(STATE.countryNames[d.e] || d.e)} → ${esc(STATE.countryNames[d.i] || d.i)}</b>
              <div class="st-tip-row"><i class="dot db-x"></i>Exporter’s report<span>${d[xk] == null ? 'no record' : fmt(d[xk])}</span></div>
              <div class="st-tip-row"><i class="dot db-m"></i>Importer’s report<span>${d[mk] == null ? 'no record' : fmt(d[mk])}</span></div>
              ${d.src === 'm' ? '<div class="st-tip-note">† The exporter did not report for this year.</div>' : ''}`))
            .on('mouseleave', () => T.hide());
        return {};
    },

    // ── Chapter 5: what HS codes can see (stacked bars by HS 6-digit code); setYear(y) marks the year on the map
    async hs(el, stage, opts = {}) {
        const vis = await DataLoader.loadVisibility();
        const KEYS = [
            { k: '11', label: '8549.11 Lead-acid' },
            { k: '12', label: '8549.12 Other, containing lead, cadmium or mercury' },
            { k: '13', label: '8549.13 Sorted by chemical type, not containing lead, cadmium or mercury' },
            { k: '14', label: '8549.14 Unsorted, not containing lead, cadmium or mercury' },
            { k: '19', label: '8549.19 Other' },
            { k: 'h5', label: 'Reported in HS 2017 or earlier (8548.10, no breakdown)' },
        ];
        const data = vis.WORLD?.X || {};
        const years = ['2022', '2023', '2024'];
        const tot = y => d3.sum(KEYS, k => data[y]?.w?.[k.k] || 0);
        const max = d3.max(years, tot) || 1;
        const fmt = METRIC_FORMAT.weight.fmt;
        const s11 = years.map(y => (tot(y) ? (data[y]?.w?.['11'] || 0) / tot(y) : 0));
        const lo = Math.round(d3.min(s11) * 100), hi = Math.round(d3.max(s11) * 100);
        // the same share by value, 2024 (values are not affected by the weight checks)
        const v24 = data['2024']?.v || {}, vt = d3.sum(KEYS, k => v24[k.k] || 0), v11 = vt ? Math.round(100 * (v24['11'] || 0) / vt) : null;
        // the share is of the reported export weight recorded under 8549.11, not of all spent batteries (WORDING_REVIEW B01)
        const body = frame(el, {
            kicker: 'UN Comtrade data',
            title: `Spent lead-acid batteries (8549.11) were ${lo === hi ? lo : `${lo}–${hi}`}% of the reported export weight of spent batteries, 2022–2024ᵖ`,
            sub: 'Spent batteries by HS 6-digit code. World, exporters’ own reports, weight (tonnes), 2022–2024ᵖ.',
            note: `Economies with a weight that fails the checks, in any of these codes, are left out.${v11 != null ? ` By value, 8549.11 was ${v11}% in 2024ᵖ.` : ''}`,
        });
        const T = tip(stage);
        const rows = years.map(y => {
            const t = tot(y);
            const segs = KEYS.map(k => {
                const v = data[y]?.w?.[k.k] || 0;
                if (!v) return '';
                return `<span class="hs-seg vk-${k.k}" style="flex-basis:${(100 * v / max).toFixed(3)}%" data-k="${k.k}" data-y="${y}"></span>`;
            }).join('');
            const sh = t ? 100 * (data[y]?.w?.['11'] || 0) / t : 0;
            return `<div class="hs-row" data-y="${y}"><span class="hs-year">${y}${isProvisional(y) ? 'ᵖ' : ''}</span>
                <span class="hs-bar">${segs}</span><span class="hs-tot">${fmt(t)}<small>${sh.toFixed(0)}% lead-acid (8549.11)</small></span></div>`;
        }).join('');
        this._summaries.hs = 'Chart, UN Comtrade data: spent batteries exported by HS 6-digit code, world, weight. '
            + years.map(y => `${y}: ${fmt(tot(y))}, of which lead-acid (8549.11) ${tot(y) ? Math.round(100 * (data[y]?.w?.['11'] || 0) / tot(y)) : 0}%.`).join(' ');
        body.innerHTML = `<div class="hs-chart" role="img" aria-label="Stacked bars of spent battery exports by HS code, 2022 to 2024">${rows}</div>
            <div class="stc-legend hs-legend">${KEYS.map(k => `<span class="${opts.mark13 && k.k === '13' ? 'is-named' : ''}"><i class="sw vk-${k.k}"></i>${esc(k.label)}</span>`).join('')}</div>`;
        if (opts.grow) grow(body.querySelectorAll('.hs-bar'), 'x', { step: 90, ms: MS.data + 80 });
        body.querySelectorAll('.hs-seg').forEach(s => {
            s.addEventListener('mousemove', ev => {
                const k = KEYS.find(q => q.k === s.dataset.k), y = s.dataset.y, v = data[y].w[k.k];
                T.show(ev, `<b>${esc(k.label)}</b><div class="st-tip-row">${y}<span>${fmt(v)} · ${(100 * v / tot(y)).toFixed(1)}%</span></div>`);
            });
            s.addEventListener('mouseleave', () => T.hide());
        });
        return { setYear: (y) => body.querySelectorAll('.hs-row').forEach(r => r.classList.toggle('is-now', r.dataset.y === String(y))) };
    },

    // ── Chapter 6: Japan-ASEAN-India matrix in miniature; the corridor the text names is outlined
    async matrix(el, stage, opts = {}) {
        const flows = await DataLoader.loadFlows('SPENT_ALL', 2024);
        const saved = { preset: STATE.preset, metric: STATE.metric, year: STATE.year, basis: STATE.basis };
        Object.assign(STATE, { preset: 'JAI', metric: 'weight', year: 2024, basis: 'reported' });
        let res;
        try { res = MatrixView.compute(flows); } finally { Object.assign(STATE, saved); }
        const { order, cells } = res;
        const body = frame(el, {
            kicker: 'UN Comtrade data',
            title: 'Japan–ASEAN–India: spent batteries, 2024',
            sub: 'Rows export to columns. Weight (tonnes).',
            note: 'Grey = no data (neither side reported). White = no trade recorded. Hatched = importer’s report used (†).',
        });
        const n = order.length;
        const W = body.clientWidth || 420;
        const cs = Math.max(11, Math.min(24, (Math.min(W, 520) - 50) / n));
        const left = 44, top = 40;
        const svg = d3.select(body).append('svg').attr('width', left + cs * n + 4).attr('height', top + cs * n + 4)
            .attr('class', 'stc-svg mm').attr('role', 'img').attr('aria-label', 'Matrix of spent battery trade between Japan, ASEAN, India and partners');
        const pat = svg.append('defs').append('pattern').attr('id', 'mm-hatch').attr('patternUnits', 'userSpaceOnUse')
            .attr('width', 4).attr('height', 4).attr('patternTransform', 'rotate(45)');
        pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 4).attr('class', 'mm-hatch-line');
        const pos = cells.filter(c => c.v > 0 && (c.state === 'value' || c.state === 'dagger')).map(c => c.v);
        const lo = Math.log(d3.min(pos) || 1), hi = Math.log(d3.max(pos) || 1);
        const ramp = d3.interpolateRgbBasis([cssVar('--unblue-bg'), cssVar('--un-blue-light'), cssVar('--un-blue'), cssVar('--un-blue-dark')]);
        const fill = c => {
            if (c.state === 'nodata') return cssVar('--grey-bg');
            if (c.state === 'value' || c.state === 'dagger') return ramp(hi > lo ? (Math.log(c.v) - lo) / (hi - lo) : 0.7);
            return cssVar('--white');
        };
        const lab = o => (o === 'RoW' ? 'RoW' : o);
        const hl = new Set(opts.highlight || []);
        svg.selectAll('.mm-col').data(order).enter().append('text').attr('class', o => `mm-lab${hl.has(o) ? ' is-named' : ''}`)
            .attr('transform', (d, k) => `translate(${left + cs * k + cs / 2 + 3},${top - 4}) rotate(-60)`).text(lab);
        svg.selectAll('.mm-row').data(order).enter().append('text').attr('class', o => `mm-lab${hl.has(o) ? ' is-named' : ''}`).attr('text-anchor', 'end')
            .attr('x', left - 4).attr('y', (d, k) => top + cs * k + cs / 2 + 3).text(lab);
        const T = tip(stage);
        const g = svg.selectAll('.mm-cell').data(cells).enter().append('g')
            .attr('transform', c => `translate(${left + c.b * cs},${top + c.a * cs})`);
        g.append('rect').attr('class', 'mm-rect').attr('width', cs - 1).attr('height', cs - 1).attr('fill', fill);
        g.filter(c => c.state === 'self').append('line').attr('class', 'mm-self').attr('x1', 0).attr('y1', 0).attr('x2', cs - 1).attr('y2', cs - 1);
        g.filter(c => c.state === 'group-diag').append('text').attr('class', 'mm-dash').attr('x', (cs - 1) / 2).attr('y', cs / 2 + 3).attr('text-anchor', 'middle').text('—');
        g.filter(c => c.state === 'dagger' || c.state === 'zero-dagger').append('rect')
            .attr('width', cs - 1).attr('height', cs - 1).attr('fill', 'url(#mm-hatch)').style('pointer-events', 'none');
        if (opts.highlight?.length === 2) {
            const [a, b] = opts.highlight.map(o => order.indexOf(o));
            if (a >= 0 && b >= 0) svg.append('rect').attr('class', 'mm-hl').attr('x', left + b * cs - 1).attr('y', top + a * cs - 1).attr('width', cs + 1).attr('height', cs + 1);
        }
        g.on('mousemove', (ev, c) => T.show(ev, MatrixView.describe(c))).on('mouseleave', () => T.hide());
        if (opts.grow) fadeIn(g.nodes(), { step: 14, order: el => d3.select(el).datum().a + d3.select(el).datum().b * 0.25 });
        return {};
    },

    // ── Chapter 7: Bangladesh: lead-acid batteries by value, 2016-2024; imports (partners' export reports) and
    // exports (Bangladesh's own report while it reported, then the importers' reports, hatched †)
    async bgd(el, stage, opts = {}) {
        const c = await Calc.bgd();
        const rows = c.rows;
        const body = frame(el, {
            kicker: 'UN Comtrade data · lead-acid batteries (8507.10, 8507.20), US dollars',
            title: 'Bangladesh, as its partners report it',
            sub: c.last ? `Bangladesh last reported its trade for ${c.last}; later years come from its partners’ reports.` : 'Bangladesh did not report in these years.',
            note: '† importers’ reports (Bangladesh did not report). Trade data do not show the effect of policy measures.',
        });
        const legend = d3.select(body).append('div').attr('class', 'stc-legend');
        legend.append('span').html('<i class="sw bg-m"></i>Exports to Bangladesh (exporters’ reports)');
        legend.append('span').html('<i class="sw bg-x"></i>Exports from Bangladesh');
        legend.append('span').html('<i class="sw bg-x bg-dag"></i>† as importers report them');
        const W = body.clientWidth || 600;
        const narrow = W < 520;
        const H = Math.max(170, Math.min((body.clientHeight || 260) - legend.node().offsetHeight - 8, narrow ? 240 : 320));
        const m = { t: 24, r: 10, b: 24, l: narrow ? 46 : 54 };
        const x = d3.scaleBand().domain(c.years).range([m.l, W - m.r]).paddingInner(0.25).paddingOuter(0.1);
        const xi = d3.scaleBand().domain(['m', 'x']).range([0, x.bandwidth()]).paddingInner(0.12);
        const y = d3.scaleLinear().domain([0, d3.max(rows, r => Math.max(r.m, r.x)) * 1.15 || 1]).nice().range([H - m.b, m.t]);
        const svg = d3.select(body).append('svg').attr('width', W).attr('height', H).attr('class', 'stc-svg')
            .attr('role', 'img').attr('aria-label', `Columns: Bangladesh's trade in lead-acid batteries by value, ${c.years[0]} to ${c.years[c.years.length - 1]}`);
        const defs = svg.append('defs');
        const pt = defs.append('pattern').attr('id', 'bg-hatch').attr('width', 5).attr('height', 5).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
        pt.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5).attr('class', 'bg-hatch-line');
        // the years Bangladesh did not report: a quiet band
        const gaps = rows.filter(r => !r.own);
        if (gaps.length) {
            const a = x(gaps[0].y) - x.step() * x.paddingInner() / 2, b = x(gaps[gaps.length - 1].y) + x.bandwidth() + x.step() * x.paddingInner() / 2;
            svg.append('rect').attr('class', 'bg-band').attr('x', a).attr('y', m.t - 14).attr('width', b - a).attr('height', H - m.b - m.t + 14);
            svg.append('text').attr('class', 'stc-note-t').attr('x', a + 4).attr('y', m.t - 4).text('Bangladesh did not report');
        }
        svg.append('g').attr('class', 'stc-grid').attr('transform', `translate(${m.l},0)`)
            .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(v => tickFmt(v, 'value')))
            .call(g => g.select('.domain').remove());
        svg.append('g').attr('class', 'stc-axis').attr('transform', `translate(0,${H - m.b})`)
            .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat(y0 => (narrow ? `’${String(y0).slice(2)}` : String(y0)) + (isProvisional(y0) ? 'ᵖ' : '')))
            .call(g => g.select('.domain').remove());
        const T = tip(stage);
        const col = svg.append('g').selectAll('g').data(rows).enter().append('g').attr('transform', r => `translate(${x(r.y)},0)`);
        col.append('rect').attr('class', 'bg-m').attr('x', xi('m')).attr('width', xi.bandwidth()).attr('y', r => y(r.m)).attr('height', r => y(0) - y(r.m));
        col.append('rect').attr('class', 'bg-x').attr('x', xi('x')).attr('width', xi.bandwidth()).attr('y', r => y(r.x)).attr('height', r => y(0) - y(r.x));
        col.filter(r => r.xDag > 0).append('rect').attr('class', 'bg-dagfill').attr('x', xi('x')).attr('width', xi.bandwidth()).attr('y', r => y(r.xDag)).attr('height', r => y(0) - y(r.xDag));
        [rows[0], rows[rows.length - 1]].forEach(r => svg.append('text').attr('class', 'stc-tot').attr('x', r === rows[0] ? x(r.y) + xi('m') : x(r.y) + x.bandwidth()).attr('y', y(Math.max(r.m, r.x)) - 5)
            .attr('text-anchor', r === rows[0] ? 'start' : 'end').text(`${narrow ? '' : 'to Bangladesh '}${usd(r.m)}`));
        col.append('rect').attr('class', 'stc-hit').attr('width', x.bandwidth()).attr('y', m.t).attr('height', H - m.t - m.b)
            .on('mousemove', (ev, r) => T.show(ev, `<b>${P(r.y)}</b><div class="st-tip-row"><i class="sw bg-m"></i>Exports to Bangladesh<span>${usd(r.m)}</span></div>
                <div class="st-tip-row"><i class="sw bg-x"></i>Exports from Bangladesh${r.own ? '' : ' †'}<span>${usd(r.x)}</span></div>
                ${r.own ? '' : '<div class="st-tip-note">† Bangladesh did not report for this year: importers’ reports.</div>'}`))
            .on('mouseleave', () => T.hide());
        if (opts.grow) {
            grow(col.selectAll('rect.bg-m, rect.bg-x, rect.bg-dagfill').nodes(), 'y', { base: y(0), step: 40, order: el => c.years.indexOf(d3.select(el).datum()?.y) });
            fadeIn(svg.selectAll('.stc-tot').nodes(), { delay: MS.data + 200 });
        }
        this._summaries.bgd = `Chart, UN Comtrade data: Bangladesh's trade in lead-acid batteries by value. `
            + rows.map(r => `${r.y}: exports to Bangladesh ${usd(r.m)}, exports from Bangladesh ${usd(r.x)}${r.own ? '' : ' (importers’ reports)'}.`).join(' ');
        return {};
    },

    // ── Chapter 8: where Asia's imports of spent lead-acid batteries go (importers' own reports), and the
    // Bangladesh policy time line (spec 8 policyTimeline, verbatim from storyData.js, with its sources)
    async policy(el, stage, opts = {}) {
        const c = await Calc.sasia();
        const a = c.years[0], z = c.years[c.years.length - 1];
        const tl = POLICY_TIMELINE.BGD || [];
        el.innerHTML = `<div class="stc">
            <div class="stc-head"><div class="stc-kicker">UN Comtrade data</div>
              <div class="stc-title">Asia’s imports of spent lead-acid batteries, ${a}–${P(z)}</div>
              <div class="stc-sub">Spent lead-acid batteries (8549.11), importers’ own reports, value in US dollars, by subregion of the importer.</div></div>
            <div class="sa-bar" role="img" aria-label="Bar: Asia's imports of spent lead-acid batteries by subregion">${c.sub.map(s => `<span class="sa-seg${s.s === '5320' ? ' is-named' : ''}" style="flex-basis:${(100 * s.sh).toFixed(2)}%" title="${esc(s.name)}: ${pct(s.sh)}">${s.sh >= 0.12 ? `${esc(s.name)} ${pct(s.sh)}` : ''}</span>`).join('')}</div>
            <div class="sa-legend">${c.sub.map(s => `<span${s.s === '5320' ? ' class="is-named"' : ''}>${esc(s.name)} ${pct(s.sh)}</span>`).join(' · ')} · total ${esc(usd(c.asia))}</div>
            <div class="stc-foot">Source: UN Comtrade; UNCTAD calculations.</div>
            <div class="stc-head tl-head"><div class="stc-kicker">From the SMEP reports (IS, BVC)</div>
              <div class="stc-title">Bangladesh: policy timeline</div>
              <div class="stc-sub">Shown for context; trade data do not show the effect of these measures.</div></div>
            <ol class="tl">${tl.map(t => `<li><span class="tl-y">${esc(t.year)}</span><span class="tl-t">${esc(t.text)}${t.note ? ` <em>${esc(t.note)}</em>` : ''} <span class="sc-cite">(${t.src} ${esc(t.page)})</span></span></li>`).join('')}</ol>
            <div class="stc-foot">Sources: IS: ${esc(SOURCES.IS)}; BVC: ${esc(SOURCES.BVC)}.</div>
          </div>`;
        if (opts.grow) {
            grow(el.querySelectorAll('.sa-bar'), 'x', { ms: MS.data + 100 });
            fadeIn(el.querySelectorAll('.tl li'), { delay: MS.ui, step: 70 });
        }
        this._summaries.policy = `Chart, UN Comtrade data: Asia's imports of spent lead-acid batteries, ${a} to ${z}, ${usd(c.asia)}: `
            + c.sub.map(s => `${s.name} ${pct(s.sh)}`).join(', ') + '. Bangladesh policy timeline: ' + tl.map(t => `${t.year}: ${t.text}`).join(' ');
        return {};
    },

    // ── The Bangladesh policy timeline alone (kept for other callers)
    async timeline(el) {
        const tl = POLICY_TIMELINE.BGD || [];
        const body = frame(el, {
            kicker: 'From the SMEP reports (IS, BVC)',
            title: 'Bangladesh: policy timeline',
            sub: 'Shown for context; trade data do not show the effect of these measures.',
            foot: `Sources: IS: ${SOURCES.IS}; BVC: ${SOURCES.BVC}.`,
        });
        body.innerHTML = `<ol class="tl">${tl.map(t => `<li><span class="tl-y">${esc(t.year)}</span><span class="tl-t">${esc(t.text)}${t.note ? ` <em>${esc(t.note)}</em>` : ''} <span class="sc-cite">(${t.src} ${esc(t.page)})</span></span></li>`).join('')}</ol>`;
        this._summaries.timeline = 'Bangladesh policy timeline: ' + tl.map(t => `${t.year}: ${t.text}`).join(' ');
        return {};
    },
};

// the last year of a chart's range (a chapter that plays starts from its first year itself)
function opts0(years) { return years[years.length - 1]; }
