import * as d3 from 'd3';
import { STATE, METRIC_FORMAT, MAP_DISCLAIMER } from './config.js';
import { DataLoader } from './dataLoader.js';
import { POLICY_TIMELINE } from './storyData.js';
import { Findings, name as prose, pct as fpct, longDate, twoReportsNote } from './storyFindings.js';
import { StoryCharts, shortName, grow, fadeIn } from './storyCharts.js';
import { createStoryMap } from './storyMap.js';
import { MatrixView } from './matrixView.js';
import { cssVar, ISO_MAP } from './baseMap.js';
import { noteBlocks, itemsHtml, sourcesHtml } from './storyCards.js';
import { chapterNo } from './storyMode.js';

// Layers 1 and 2 (docs/design/LAYERS_V3.md): the entry page (#home) with five questions, and one page per
// question (#q=<id>). Every answer is computed from public/data when the page runs (no report figures here);
// the notes of the matching story chapter (src/storyData.js, verbatim and sourced) follow, set apart:
// "From the SMEP reports (IS)" and "Notes on the HS codes (WCO)", each only where it has content.
// Layer 3 is the explorer (src/main.js); "Explore in detail" links open it in the matching state.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nm = iso => shortName(iso);
const pct = v => fpct(v);   // whole per cent, one decimal below 10% (as in the story)
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const lc = t => t.charAt(0).toLowerCase() + t.slice(1);   // first letter only: codes such as HS stay in capitals
const Y = 2024;
const prov = 'ᵖ';
// products as phrases in running text (the list labels, such as "Lead-acid (8507.10 + 8507.20)", are not phrases)
const PHRASE = { BAT_ALL: 'batteries (HS 8507)', BAT_LIION: 'lithium-ion batteries (8507.60)', BAT_LA: 'lead-acid batteries (8507.10, 8507.20)', SPENT_11: 'spent lead-acid batteries (8549.11)', SPENT_ALL: 'spent batteries of all chemistries' };
const phrase = p => PHRASE[p.id] || lc(p.label);
const reported = (iso, y) => (STATE.meta.reporting[iso]?.[String(y)] || '').length > 0;
const explorerHash = (s, q) => '#' + new URLSearchParams({ p: s.product, y: s.year || Y, m: s.metric, v: s.view || 'map', s: s.preset || 'GLOBAL', q, ...(s.hs ? { hs: '1' } : {}) }).toString();

// ── computations (shared by the entry and the question pages)
async function exporters(product, metric) {
    const sum = await DataLoader.loadSummary(product);
    const isW = metric === 'weight', y = String(Y);
    const tot = isW ? sum.world[y].xw : sum.world[y].x;
    const list = Object.entries(sum.economies).map(([iso, ys]) => {
        const r = ys[y];
        if (!r || r.xs !== 'own' || (isW && r.xflag)) return null;
        const v = isW ? r.xw : r.x;
        return v > 0 ? { iso, v } : null;
    }).filter(Boolean).sort((a, b) => b.v - a.v);
    const k = isW ? 'xw' : 'x';
    return { tot, list, v0: sum.world['2016']?.[k], v1: sum.world[y][k], n0: sum.world['2016']?.nx, n1: sum.world[y]?.nx };
}
async function importers(product, metric) {
    const sum = await DataLoader.loadSummary(product);
    const isW = metric === 'weight', y = String(Y);
    const tot = isW ? sum.world[y].mw : sum.world[y].m;
    const list = Object.entries(sum.economies).map(([iso, ys]) => {
        const r = ys[y];
        if (!r || r.ms !== 'own' || (isW && r.mflag)) return null;
        const v = isW ? r.mw : r.m;
        return v > 0 ? { iso, v } : null;
    }).filter(Boolean).sort((a, b) => b.v - a.v);
    return { tot, list, xw: sum.world[y].xw, x: sum.world[y].x };
}
async function corridors(product) {
    const f = (await DataLoader.loadFlows(product, Y)).filter(d => d.src !== 'e' && d.w > 0);
    const vals = f.map(d => d.w).sort((a, b) => b - a);
    const tot = d3.sum(vals);
    let acc = 0, n = 0;
    while (n < vals.length && acc < tot / 2) acc += vals[n++];
    return { n, all: vals.length, flows: f, tot };
}
async function twoReports(product, metric) {
    const f = (await DataLoader.loadFlows(product, Y)).filter(d => d.src !== 'e');
    const xk = metric === 'weight' ? 'xw' : 'xv', mk = metric === 'weight' ? 'mw' : 'mv';
    const big = d => Math.max(d[xk] || 0, d[mk] || 0);
    const top = f.filter(d => big(d) > 0).sort((a, b) => big(b) - big(a)).slice(0, 12);
    const one = top.filter(d => !(d[xk] > 0 && d[mk] > 0)).length;
    const k = top.filter(d => d[xk] > 0 && d[mk] > 0 && Math.abs(d[mk] / d[xk] - 1) > 0.25).length;
    const both = f.filter(d => d[xk] > 0 && d[mk] > 0);
    const sx = d3.sum(both, d => d[xk]), sm = d3.sum(both, d => d[mk]);
    return { top, one, k, n: top.length, both: both.length, diff: sx ? sm / sx - 1 : 0, xk, mk };
}
const signed = d => `${d >= 0 ? '+' : '−'}${Math.abs(d) < 0.1 ? (Math.abs(d) * 100).toFixed(1) : Math.round(Math.abs(d) * 100)}%`;

const PRODUCTS = {
    sources: [['BAT_ALL', 'All batteries'], ['BAT_LIION', 'Lithium-ion'], ['BAT_LA', 'Lead-acid']],
    spent: [['SPENT_11', 'Spent lead-acid (8549.11)'], ['SPENT_ALL', 'All spent batteries']],
    reports: [['SPENT_11', 'Spent lead-acid (8549.11)'], ['BAT_ALL', 'All batteries (HS 8507)']],
};
const MEASURES = [['value', 'Value'], ['weight', 'Weight']];

export const QUESTIONS = [
    {
        id: 'sources', title: 'Where do batteries come from?', story: 'battery-boom',
        defaults: { pr: 'BAT_ALL', me: 'value' },
        async answer() {
            const e = await exporters('BAT_ALL', 'value');
            const a = e.list[0];
            const lead = cap(prose(a.iso));
            return { num: pct(a.v / e.tot), text: `${lead} accounted for ${pct(a.v / e.tot)} of world battery exports by value in 2024${prov} (its own report)`, lead };
        },
    },
    {
        id: 'spent', title: 'Where do spent batteries go?', story: 'where-spent-go',
        defaults: { pr: 'SPENT_11', me: 'weight' },
        async answer() { const h = await Findings['where-spent-go'](); return { num: h.num, text: h.text }; },
    },
    {
        id: 'reports', title: 'Do the two reports agree?', story: 'two-reports',
        defaults: { pr: 'SPENT_11', me: 'weight' },
        async answer() { const h = await Findings['two-reports'](); return { num: h.num, text: h.text }; },
    },
    {
        id: 'blind', title: 'What can’t the statistics see?', story: 'cannot-see',
        defaults: {},
        async answer() { const h = await Findings['cannot-see'](); return { num: h.num, text: h.text.split(';')[0] }; },
    },
    {
        id: 'jai', title: 'Japan, ASEAN and India: who trades with whom?', story: 'regional-rules',
        defaults: {},
        async answer() { const h = await Findings['regional-rules'](); return { num: h.num, text: h.text.split(':')[0] }; },
    },
];

// The notes of a story chapter, set apart from the computed text: "From the SMEP reports (IS)" and "Notes on the
// HS codes (WCO)", verbatim, with their sources. Nothing is shown where a chapter has no notes.
function reportsHtml(id, level = 2) {
    return noteBlocks(id).map(b => `<section class="qp-reports qp-notes-${b.kind}" aria-label="${esc(b.label)}">
        <h${level} class="qp-h2">${esc(b.head)}</h${level}>
        <p class="qp-rnote">${b.kind === 'report' ? 'Text from the SMEP project reports' : 'Notes on the HS nomenclature'}, not from the UN Comtrade data on this page.</p>
        ${itemsHtml(b.items)}${sourcesHtml(b.srcs)}
      </section>`).join('');
}
const numsHtml = nums => `<div class="qp-nums">${nums.map(([v, l]) => `<div class="qp-num"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
const tabs = (key, items, cur, label) => `<div class="tb-fld"><span class="tb-cap">${esc(label)}</span><div class="tb-seg" role="group" aria-label="${esc(label)}">${items.map(([v, l]) =>
    `<button class="btn-toggle ${v === cur ? 'active' : ''}" type="button" data-qsw="${key}" data-val="${v}" aria-pressed="${v === cur}">${esc(l)}</button>`).join('')}</div></div>`;

export const Pages = {
    el: null,
    cur: null,

    init(el, { onNavigate }) {
        this.el = el;
        this.onNavigate = onNavigate;
        el.innerHTML = `<section id="page-home" class="pg pg-home hidden" aria-labelledby="home-h"></section>
            <section id="page-q" class="pg pg-q hidden" aria-labelledby="q-h"></section>`;
        el.tabIndex = -1;
        el.addEventListener('click', (e) => {
            const sw = e.target.closest('[data-qsw]');
            if (sw) { this.setSwitch(sw.dataset.qsw, sw.dataset.val); }
        });
    },

    has(id) { return QUESTIONS.some(q => q.id === id); },
    isOpen() { return this.el && !this.el.classList.contains('hidden'); },
    hide() { this._nav = (this._nav || 0) + 1; if (this.el) this.el.classList.add('hidden'); document.body.classList.remove('pages-open'); },
    show() { this._nav = (this._nav || 0) + 1; this.el.classList.remove('hidden'); document.body.classList.add('pages-open'); this.el.scrollTop = 0; window.scrollTo(0, 0); },

    // ── Layer 1: the entry
    async showHome(explore) {
        this.show();
        this.cur = null;
        const h = this.el.querySelector('#page-home'), q = this.el.querySelector('#page-q');
        q.classList.add('hidden');
        h.classList.remove('hidden');
        if (!h.dataset.done) {
            h.dataset.done = '1';
            h.innerHTML = `<div class="pg-in">
                <h1 id="home-h" class="pg-h1" tabindex="-1">Batteries in global trade, 2016&ndash;2024</h1>
                <p class="pg-lede">Trade in batteries and spent batteries, as the exporting and the importing economies report it to UN&nbsp;Comtrade. Start with a question.</p>
                <ul class="q-grid">${QUESTIONS.map(qq => `<li class="q-item"><a class="q-block" href="#q=${qq.id}" data-q="${qq.id}">
                    <h2 class="q-title">${esc(qq.title)}</h2>
                    <p class="q-answer" id="qa-${qq.id}">&nbsp;</p>
                    <span class="q-thumb" id="qt-${qq.id}" aria-hidden="true"></span>
                    <span class="q-go">See the answer <span aria-hidden="true">&rarr;</span></span></a></li>`).join('')}</ul>
                <div class="pg-ways">
                  <a class="pg-way" href="#story"><b>Take the guided story <span aria-hidden="true">&rarr;</span></b><span>Eight short chapters, computed from the UN Comtrade data</span></a>
                  <a class="pg-way" id="home-explore" href="#p=SPENT_ALL&y=2024&m=weight&v=map&s=GLOBAL"><b>Explore all data <span aria-hidden="true">&rarr;</span></b><span>Map, matrix and both reports, every product and year, CSV</span></a>
                  <div class="pg-way pg-find"><label for="home-search"><b>Find an economy</b></label>
                    <div class="search"><input id="home-search" type="search" placeholder="Economy&hellip;" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="home-search-list"><ul id="home-search-list" class="search-list hidden" role="listbox" aria-label="Economies"></ul></div></div>
                </div>
                <p class="pg-src"><strong>Source:</strong> UN Comtrade; UNCTAD calculations; data extracted ${esc(longDate(STATE.buildInfo?.extracted))}. 2024 data are provisional. <strong>Map:</strong> ${MAP_DISCLAIMER}</p>
              </div>`;
            this.onNavigate?.('home-ready');
            this.fillHome();
        }
        if (explore) h.querySelector('#home-explore').setAttribute('href', explore);
    },

    // (perf R2) the answers first; then the pictures, one per idle moment, the map last, so each draws (and grows)
    // without a long task under the others
    async fillHome() {
        this._homeFilled = true;
        await Promise.all(QUESTIONS.map(async q => {
            try {
                const a = await q.answer();
                const el = this.el.querySelector(`#qa-${q.id}`);
                const t = a.text.startsWith(a.num) ? a.text.slice(a.num.length) : a.text;
                el.innerHTML = a.lead ? `<b>${esc(a.lead)}</b>${esc(a.text.slice(a.lead.length))}.` : `<b>${esc(a.num)}</b> ${esc(t.trim())}.`;
            } catch { /* an answer that cannot be computed is left blank */ }
        }));
        const order = [...QUESTIONS.filter(q => q.id !== 'spent'), ...QUESTIONS.filter(q => q.id === 'spent')];
        for (const q of order) {
            await new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 60)));
            const el = this.el.querySelector(`#qt-${q.id}`);
            if (!el || el.childElementCount) continue;
            try { await this.thumb(q.id, el); } catch { /* the thumbnail is decorative */ }
        }
    },

    // quiet visuals for the entry
    async thumb(id, el) {
        const W = 220, H = 74;
        if (id === 'spent') {
            el.classList.add('q-thumb-map');
            const m = createStoryMap(el);
            const { flows } = await corridors('SPENT_11');
            const col = cssVar('--un-blue-text');
            const top = flows.sort((a, b) => b.w - a.w).slice(0, 10).map(d => ({ e: d.e, i: d.i, a: STATE.countryCoords[d.e], b: STATE.countryCoords[d.i], v: d.w, dagger: d.src === 'm', color: col, metric: 'weight' })).filter(d => d.a && d.b);
            m.batch(() => { m.setFlows(top, {}); m.setView({ world: true, maxK: 1 }, 0); });   // the ten corridors draw on, once
            return;
        }
        const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H);
        if (id === 'sources') {
            const [la, li] = await Promise.all(['BAT_LA', 'BAT_LIION'].map(p => DataLoader.loadSummary(p)));
            const yrs = d3.range(2016, 2025);
            const rows = yrs.map(y => ({ y, la: la.world[y]?.x || 0, li: li.world[y]?.x || 0 }));
            const x = d3.scaleBand().domain(yrs).range([0, W]).paddingInner(0.3);
            const yy = d3.scaleLinear().domain([0, d3.max(rows, r => r.la + r.li)]).range([H - 12, 4]);
            const g = svg.selectAll('g').data(rows).join('g').attr('transform', r => `translate(${x(r.y)},0)`);
            g.append('rect').attr('width', x.bandwidth()).attr('y', r => yy(r.li)).attr('height', r => yy(0) - yy(r.li)).attr('fill', cssVar('--bc-li'));
            g.append('rect').attr('width', x.bandwidth()).attr('y', r => yy(r.li + r.la)).attr('height', r => yy(r.li) - yy(r.li + r.la) - 0.8).attr('fill', cssVar('--bc-la'));
            grow(g.selectAll('rect').nodes(), 'y', { base: yy(0), step: 40, order: el => yrs.indexOf(d3.select(el).datum()?.y) });
            svg.append('text').attr('class', 'q-tl').attr('x', 0).attr('y', H - 1).text('2016');
            svg.append('text').attr('class', 'q-tl').attr('x', W).attr('y', H - 1).attr('text-anchor', 'end').text('2024' + prov);
        } else if (id === 'reports') {
            const r = await twoReports('SPENT_11', 'weight');
            const rows = r.top.slice(0, 3);
            const vals = rows.flatMap(d => [d[r.xk], d[r.mk]]).filter(v => v > 0);
            const x = d3.scaleLog().domain([d3.min(vals) / 1.5, d3.max(vals) * 1.5]).range([70, W - 6]);
            const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, k) => `translate(0,${14 + k * 22})`);
            g.append('text').attr('class', 'q-tl').attr('x', 0).attr('y', 4).text(d => `${d.e} → ${d.i}`);
            g.filter(d => d[r.xk] > 0 && d[r.mk] > 0).append('line').attr('class', 'db-link').attr('x1', d => x(d[r.xk])).attr('x2', d => x(d[r.mk]));
            g.filter(d => d[r.mk] > 0).append('circle').attr('class', 'db-m').attr('r', 4).attr('cx', d => x(d[r.mk]));
            g.filter(d => d[r.xk] > 0).append('circle').attr('class', 'db-x').attr('r', 4).attr('cx', d => x(d[r.xk]));
            fadeIn(g.nodes(), { step: 90 });
        } else if (id === 'blind') {
            const vis = await DataLoader.loadVisibility();
            const w = vis.WORLD?.X?.['2024']?.w || {};
            const keys = ['11', '12', '13', '14', '19', 'h5'];
            const tot = d3.sum(keys, k => w[k] || 0) || 1;
            let x0 = 0;
            keys.forEach(k => {
                const ww = W * (w[k] || 0) / tot;
                svg.append('rect').attr('x', x0).attr('y', 22).attr('width', Math.max(0, ww - 1)).attr('height', 20)
                    .attr('fill', k === 'h5' ? 'url(#qt-hatch)' : cssVar(`--hs-${k}`));
                x0 += ww;
            });
            const pt = svg.append('defs').append('pattern').attr('id', 'qt-hatch').attr('width', 5).attr('height', 5).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
            pt.append('rect').attr('width', 5).attr('height', 5).attr('fill', cssVar('--nodata'));
            pt.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5).attr('stroke', cssVar('--nodata-line')).attr('stroke-width', 1.3);
            svg.append('text').attr('class', 'q-tl').attr('x', 0).attr('y', 14).text(`8549.11 (lead-acid): ${pct((w['11'] || 0) / tot)} of export weight, 2024${prov}`);
            svg.append('text').attr('class', 'q-tl').attr('x', 0).attr('y', 58).text('hatched = HS 2017 or earlier, no split');
            grow(svg.selectAll('rect:not(pattern rect)').nodes(), 'x', { step: 60 });
        } else if (id === 'jai') {
            const flows = await DataLoader.loadFlows('SPENT_ALL', Y);
            const saved = { preset: STATE.preset, metric: STATE.metric, year: STATE.year, basis: STATE.basis };
            Object.assign(STATE, { preset: 'JAI', metric: 'weight', year: Y, basis: 'reported' });
            let res;
            try { res = MatrixView.compute(flows); } finally { Object.assign(STATE, saved); }
            const n = res.order.length, cs = Math.min(3.2, (H - 4) / n - 0.6);
            const pos = res.cells.filter(c => c.v > 0 && (c.state === 'value' || c.state === 'dagger')).map(c => Math.log(c.v));
            const t = d3.scaleLinear().domain(d3.extent(pos)).range([0.15, 1]);
            const ramp = d3.interpolateRgb(cssVar('--un-blue-lightest'), cssVar('--un-blue-dark'));
            svg.selectAll('rect').data(res.cells).join('rect').attr('x', c => c.b * (cs + 0.6)).attr('y', c => 1 + c.a * (cs + 0.6))
                .attr('width', cs).attr('height', cs)
                .attr('fill', c => (c.state === 'nodata' ? cssVar('--grey-bg') : c.v > 0 ? ramp(t(Math.log(c.v))) : cssVar('--white')))
                .attr('stroke', c => (c.state === 'dagger' || c.state === 'zero-dagger' ? cssVar('--grey') : 'none')).attr('stroke-width', 0.5);
            svg.append('text').attr('class', 'q-tl').attr('x', n * (cs + 0.6) + 12).attr('y', 24).text('rows export to columns');
            svg.append('text').attr('class', 'q-tl').attr('x', n * (cs + 0.6) + 12).attr('y', 38).text('grey = no data');
            fadeIn(svg.selectAll('rect').nodes(), { step: 6, order: el => d3.select(el).datum()?.a ?? 0 });
        }
    },

    // ── Layer 2: one question
    async showQuestion(id, params = {}) {
        const q = QUESTIONS.find(x => x.id === id);
        this.show();
        this.cur = id;
        const home = this.el.querySelector('#page-home'), el = this.el.querySelector('#page-q');
        home.classList.add('hidden');
        el.classList.remove('hidden');
        const o = { ...q.defaults, ...Object.fromEntries(Object.entries(params).filter(([k, v]) => v && (k === 'pr' || k === 'me'))) };
        if (PRODUCTS[id] && !PRODUCTS[id].some(([v]) => v === o.pr)) o.pr = q.defaults.pr;
        if (o.me && !MEASURES.some(([v]) => v === o.me)) o.me = q.defaults.me;
        this._o = o;
        const k = QUESTIONS.indexOf(q), prev = QUESTIONS[(k + QUESTIONS.length - 1) % QUESTIONS.length], next = QUESTIONS[(k + 1) % QUESTIONS.length];
        const sw = [];
        if (PRODUCTS[id]) sw.push(tabs('pr', PRODUCTS[id], o.pr, 'Product'));
        if (id === 'sources' || id === 'reports') sw.push(tabs('me', MEASURES, o.me, 'Measure'));
        el.innerHTML = `<div class="qp">
            <div class="qp-main">
              <h1 id="q-h" class="qp-h1" tabindex="-1">${esc(q.title)}</h1>
              ${sw.length ? `<div class="qp-switches">${sw.join('')}</div>` : ''}
              <div class="qp-visual" id="qp-visual"><div class="qp-map" id="qp-map" aria-hidden="true"></div><div class="qp-chart" id="qp-chart"></div></div>
              <p class="qp-caption" id="qp-caption"></p>
            </div>
            <div class="qp-side">
              <div id="qp-nums" aria-live="polite"></div>
              <div class="qp-text" id="qp-text"></div>
              <p class="qp-go"><a class="btn-solid qp-explore" id="qp-explore" href="#">Explore in detail <span aria-hidden="true">&rarr;</span></a>
                 <a class="btn-line" href="#story=${chapterNo(q.story)}">In the guided story <span aria-hidden="true">&rarr;</span></a></p>
              <div class="qp-sidechart" id="qp-sidechart"></div>
              <div id="qp-reports"></div>
            </div>
          </div>
          <div id="qp-extra"></div>
          <nav class="qp-nav" aria-label="Questions">
            <a class="btn-line" href="#q=${prev.id}"><span aria-hidden="true">&larr;</span> ${esc(prev.title)}</a>
            <a class="btn-line" href="#home">All questions</a>
            <a class="btn-line" href="#q=${next.id}">${esc(next.title)} <span aria-hidden="true">&rarr;</span></a>
          </nav>`;
        if (!this.map) this.mapHost = null;
        // the map engine is created once per page render (its element is new)
        this.map = null;
        await this.renderQ(id, o);
    },

    async setSwitch(key, val) {
        if (!this.cur) return;
        const o = { ...this._o, [key]: val };
        const p = new URLSearchParams({ q: this.cur, ...(o.pr ? { pr: o.pr } : {}), ...(o.me ? { me: o.me } : {}) });
        history.replaceState(null, '', '#' + p.toString());
        this.onNavigate?.('replaced');
        const had = document.activeElement?.dataset?.qsw;
        this._o = o;
        this.el.querySelectorAll(`[data-qsw="${key}"]`).forEach(b => { const on = b.dataset.val === val; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
        await this.renderQ(this.cur, o);
        if (had) this.el.querySelector(`[data-qsw="${key}"][data-val="${val}"]`)?.focus({ preventScroll: true });
    },

    getMap() {
        if (!this.map) this.map = createStoryMap(this.el.querySelector('#qp-map'));
        return this.map;
    },
    useMap(on) {
        this.el.querySelector('#qp-map').classList.toggle('hidden', !on);
        this.el.querySelector('#qp-chart').classList.toggle('hidden', on);
        this.el.querySelector('#qp-caption').classList.toggle('hidden', !on);
        this.el.querySelector('#qp-visual').classList.toggle('is-chart', !on);
    },
    caption(t) { this.el.querySelector('#qp-caption').innerHTML = `${esc(t)} <strong>Source:</strong> UN Comtrade; UNCTAD calculations. <strong>Map:</strong> ${MAP_DISCLAIMER}`; },
    setExplore(state) { this.el.querySelector('#qp-explore').setAttribute('href', explorerHash(state, this.cur)); },
    setNums(nums) { this.el.querySelector('#qp-nums').innerHTML = numsHtml(nums); },
    setText(ps) { this.el.querySelector('#qp-text').innerHTML = ps.map(p => `<p>${p}</p>`).join(''); },

    async renderQ(id, o) {
        const seq = (this._seq = (this._seq || 0) + 1);
        const nav = this._nav;
        const left = () => seq !== this._seq || nav !== this._nav || this.cur !== id;   // another page or switch since
        const fmtOf = m => METRIC_FORMAT[m].fmt;
        const reportsEl = this.el.querySelector('#qp-reports');
        const side = this.el.querySelector('#qp-sidechart');
        const chart = this.el.querySelector('#qp-chart');
        side.innerHTML = '';
        if (id === 'sources') {
            const p = DataLoader.product(o.pr), fmt = fmtOf(o.me);
            const e = await exporters(o.pr, o.me);
            if (left()) return;
            this.useMap(true);
            const m = this.getMap();
            // one sequence: the spikes grow (or take their new height after a switch: the same economy keeps its spike)
            m.batch(() => {
                m.setFlows([], {}); m.setLabels([]); m.setLand('base');
                m.setSpikes({ items: e.list.slice(0, 60).map(d => ({ iso: d.iso, v: d.v, lonlat: STATE.countryCoords[d.iso], name: nm(d.iso) })), fmt, labels: 7, color: cssVar('--un-blue-dark') });
                m.setView({ world: true, maxK: 1 }, 0);
            });
            const [a, b, c] = e.list, top5 = d3.sum(e.list.slice(0, 5), d => d.v) / e.tot;
            this.setNums([[fmt(e.tot), `world exports of ${esc(phrase(p))}, 2024${prov}`], [pct(a.v / e.tot), `${esc(nm(a.iso))}, the largest exporter`], [pct(top5), 'the five largest exporters together']]);
            this.setText([
                `In 2024${prov}, <b>${esc(cap(prose(a.iso)))}</b> accounted for <b>${pct(a.v / e.tot)}</b> of world exports of ${esc(phrase(p))} by ${o.me} (its own report), followed by ${esc(prose(b.iso))} (${pct(b.v / e.tot)}) and ${esc(prose(c.iso))} (${pct(c.v / e.tot)}).`,
                // "World" is the sum of the economies that reported: fewer did for 2024, so the change is not like for like
                e.v0 ? `World exports went from ${fmt(e.v0)} in 2016 to <b>${fmt(e.v1)}</b> in 2024${prov}.${e.n0 && e.n1 ? ` 2024 data are provisional: ${e.n1} economies had reported their exports, against ${e.n0} for 2016.` : ' 2024 data are provisional.'}` : '',
                `Each spike is an economy’s own report of its exports${o.me === 'weight' ? '; weights flagged as unreliable are left out' : ''}. “World” is the sum of the reporting economies.`,
            ].filter(Boolean));
            this.caption(`${p.label}, exports by the exporter’s own report, ${o.me === 'weight' ? 'tonnes' : 'US$'}, 2024${prov}; spike height = exports.`);
            this.setExplore({ product: o.pr, metric: o.me, view: 'map', preset: 'GLOBAL' });
            reportsEl.innerHTML = reportsHtml('today-tomorrow');
        } else if (id === 'spent') {
            const p = DataLoader.product(o.pr), fmt = fmtOf('weight');
            const [c, im] = await Promise.all([corridors(o.pr), importers(o.pr, 'weight')]);
            if (left()) return;
            this.useMap(true);
            const m = this.getMap();
            const col = cssVar('--un-blue-text');
            const list = c.flows.sort((a, b) => b.w - a.w).slice(0, 20).map(d => ({ e: d.e, i: d.i, a: STATE.countryCoords[d.e], b: STATE.countryCoords[d.i], v: d.w, dagger: d.src === 'm', color: col, metric: 'weight' })).filter(d => d.a && d.b);
            const lab = new Map();
            list.slice(0, 8).forEach(f => [f.e, f.i].forEach(iso => { if (!lab.has(iso)) lab.set(iso, { text: nm(iso), lonlat: STATE.countryCoords[iso] }); }));
            // one sequence: the corridors draw on from exporter to importer, the largest first; then the names.
            // After a switch the corridors both products share keep their identity and take their new width.
            m.batch(() => {
                m.setSpikes(null); m.setLand('base');
                m.setFlows(list, {});
                m.setLabels([...lab.values()]);
                m.setView({ world: true }, 0);
            });
            const top = im.list[0];
            // one total for the first two tiles: the weight recorded in the flows (exporter's report, or the importer's †);
            // the importer's share is of world imports (importers' own reports)
            this.setNums([[String(c.n), `of the ${c.all.toLocaleString('en-US')} flows with a weight carry half of it`], [fmt(c.tot), `recorded in those flows, 2024${prov} (exporter’s report, † importer’s)`], [pct(top.v / im.tot), `${esc(nm(top.iso))}’s share of world imports (importers’ own reports)`]]);
            this.setText([
                `<b>${c.n}</b> of the ${c.all.toLocaleString('en-US')} exporter-to-importer flows with a weight carry half of the weight of ${esc(phrase(p))} recorded in 2024${prov} (${fmt(c.tot)} in all).`,
                `The largest importer by its own report was <b>${esc(prose(top.iso))}</b>, with ${pct(top.v / im.tot)} of world imports (the sum of importers’ own reports).`,
                'Each arrow runs from the exporter to the importer; a dashed arrow (†) is the importer’s report, used where the exporter did not report for the year.',
            ]);
            this.caption(`${p.label}, 2024${prov}, 20 largest directed flows by weight. Arrowheads point to the importer; dashed = the importer’s report (†).`);
            this.setExplore({ product: o.pr, metric: 'weight', view: 'map', preset: 'GLOBAL' });
            reportsEl.innerHTML = reportsHtml('where-spent-go');
            this.extraSouthAsia();
        } else if (id === 'reports') {
            const p = DataLoader.product(o.pr);
            const r = await twoReports(o.pr, o.me);
            if (left()) return;
            this.useMap(false);
            chart.innerHTML = '';
            await StoryCharts.gap(chart, chart, { product: o.pr, year: Y, metric: o.me, n: 12, grow: true });
            if (left()) return;
            this.setNums([[`${r.k + r.one} of ${r.n}`, 'largest flows: the reports differ by more than 25%, or only one side reported'],
                [signed(r.diff), `importers’ total against exporters’ total, same ${r.both.toLocaleString('en-US')} flows`], [r.both.toLocaleString('en-US'), 'flows reported by both sides']]);
            this.setText([
                `Of the ${r.n} largest flows of ${esc(phrase(p))} in 2024${prov} (by ${o.me}), the two reports differ by more than 25% for <b>${r.k}</b> flows${r.one ? `, and only one side reported the other <b>${r.one}</b>` : ''}.`,
                `On the ${r.both.toLocaleString('en-US')} flows that both sides reported, importers recorded <b>${fpct(Math.abs(r.diff))} ${r.diff >= 0 ? 'more' : 'less'}</b> in total than exporters (by ${o.me}).`,
                twoReportsNote(o.me),
            ]);
            this.setExplore({ product: o.pr, metric: o.me, view: 'gap', preset: 'GLOBAL' });
            reportsEl.innerHTML = '';
        } else if (id === 'blind') {
            const h = await Findings['cannot-see']();
            const vis = await DataLoader.loadVisibility();
            if (left()) return;
            this.useMap(true);
            const m = this.getMap();
            const blue = cssVar('--un-blue-light');
            m.batch(() => {
                m.setFlows([], {}); m.setSpikes(null); m.setLabels([]);
                m.setLand('hs2024', code => {
                    const e = ISO_MAP[parseInt(code, 10)];
                    if (!e || !reported(e, 2024)) return null;
                    return STATE.meta.hs_version[e]?.['2024'] === 'H6' ? blue : 'hatch';
                });
                m.setView({ world: true, maxK: 1.2 }, 0);
            });
            const ecos = STATE.meta.economies.map(e => e.iso);
            const notRep = ecos.filter(i => !reported(i, 2024)).length;
            const s11 = ['2022', '2023', '2024'].map(y => { const w = vis.WORLD?.X?.[y]?.w || {}; const t = d3.sum(Object.values(w)); return t ? (w['11'] || 0) / t : 0; });
            const lo = Math.round(d3.min(s11) * 100), hi = Math.round(d3.max(s11) * 100);
            const v24 = vis.WORLD?.X?.['2024']?.v || {}, v11 = d3.sum(Object.values(v24)) ? (v24['11'] || 0) / d3.sum(Object.values(v24)) : 0;   // the same share by value (no weight checks)
            this.setNums([[esc(h.num), 'economies reported 2024 in HS 2022, with the split of spent batteries'], [`${lo === hi ? lo : `${lo}–${hi}`}%`, `of the reported export weight of spent batteries was recorded under 8549.11 (lead-acid), 2022–2024${prov}: exporters’ own reports, economies whose weights pass the checks${v11 ? `; by value, ${pct(v11)} in 2024${prov}` : ''}`], [String(notRep), `economies had no 2024 data in UN Comtrade on ${esc(longDate(STATE.buildInfo?.extracted))}`]]);
            this.setText([`<b>${esc(h.num)}</b> ${esc(h.text)}.`, esc(h.note)]);   // the HS note itself is in the WCO block below
            this.caption('Reporting status for 2024. Blue = reported in HS 2022 (spent batteries split into 8549.11–8549.19); hatched = reported in an earlier HS version (no split); grey = no 2024 data in UN Comtrade.');
            this.setExplore({ product: 'SPENT_ALL', metric: 'weight', view: 'map', preset: 'GLOBAL', hs: true });
            side.innerHTML = '<div class="qp-hs"></div>';
            await StoryCharts.hs(side.firstChild, side, { grow: true });
            if (left()) return;
            reportsEl.innerHTML = reportsHtml('cannot-see');
        } else if (id === 'jai') {
            const h = await Findings['regional-rules']();
            const mem = new Set(STATE.meta.presets.JAI.members);
            const f = (await DataLoader.loadFlows('SPENT_ALL', Y)).filter(d => d.src !== 'e' && mem.has(d.e) && mem.has(d.i) && d.w > 0).sort((a, b) => b.w - a.w);
            if (left()) return;
            this.useMap(false);
            chart.innerHTML = '';
            await StoryCharts.matrix(chart, chart, { grow: true });
            if (left()) return;
            const fmt = fmtOf('weight'), tot = d3.sum(f, d => d.w), big = f[0];
            this.setNums([[esc(h.num), 'economies had no 2024 data in UN Comtrade'], [fmt(tot), `trade within the group, 2024${prov}, weight`],
                [big ? `${big.e} → ${big.i}` : '—', big ? `largest flow in the group (${fmt(big.w)})` : 'no flow in the group']]);
            this.setText([`<b>${esc(h.num)}</b> ${esc(h.text)}.`, esc(h.note), 'Rows export to columns. White = no trade recorded; grey = no data (neither side reported); hatched = the importer’s report is used (†).']);
            this.setExplore({ product: 'SPENT_ALL', metric: 'weight', view: 'matrix', preset: 'JAI' });
            reportsEl.innerHTML = reportsHtml('regional-rules');
        }
        if (id !== 'spent') this.el.querySelector('#qp-extra').innerHTML = '';
    },

    // On "Where do spent batteries go?": South Asia and Bangladesh (story chapters 6 and 7)
    async extraSouthAsia() {
        const el = this.el.querySelector('#qp-extra');
        if (el.dataset.done === 'spent' && el.innerHTML) return;
        el.dataset.done = 'spent';
        const [b, e] = await Promise.all([Findings.bangladesh(), Findings['evidence-policy']()]);
        const tl = POLICY_TIMELINE.BGD || [];
        const bgd = explorerHash({ product: 'BAT_LA', metric: 'value', view: 'map', preset: 'GLOBAL' }, 'spent') + '&c=BGD';
        const sas = explorerHash({ product: 'SPENT_ALL', metric: 'weight', view: 'map', preset: 'SAS' }, 'spent');
        el.innerHTML = `<section class="qp-extra" aria-labelledby="qx-h">
            <h2 id="qx-h" class="qp-h2 qp-xh">South Asia and Bangladesh</h2>
            <div class="qp-xcols">
              <div class="qp-xcol">
                <h3 class="qp-h3">When recycling goes wrong: Bangladesh</h3>
                ${b ? `<p class="qp-find"><b>${esc(b.num)}</b> ${esc(b.text)}.</p><p class="qp-fnote">${esc(b.note || '')} UN Comtrade data.</p>` : ''}
                ${reportsHtml('bangladesh', 4)}
                <h4 class="qp-h4">Policy timeline (IS, BVC)</h4>
                <ol class="tl">${tl.map(t => `<li><span class="tl-y">${esc(t.year)}</span><span class="tl-t">${esc(t.text)}${t.note ? ` <em>${esc(t.note)}</em>` : ''} <span class="sc-cite">(${t.src} ${esc(t.page)})</span></span></li>`).join('')}</ol>
                <p class="qp-go"><a class="btn-line" href="${bgd}">Bangladesh in the explorer <span aria-hidden="true">&rarr;</span></a> <a class="btn-line" href="#story=${chapterNo('bangladesh')}">Story chapter ${chapterNo('bangladesh')} <span aria-hidden="true">&rarr;</span></a></p>
              </div>
              <div class="qp-xcol">
                <h3 class="qp-h3">From evidence to policy</h3>
                ${e ? `<p class="qp-find"><b>${esc(e.num)}</b> ${esc(e.text)}.</p><p class="qp-fnote">${esc(e.note || '')} UN Comtrade data.</p>` : ''}
                ${reportsHtml('evidence-policy', 4)}
                <p class="qp-go"><a class="btn-line" href="${sas}">South Asia in the explorer <span aria-hidden="true">&rarr;</span></a> <a class="btn-line" href="#story=${chapterNo('evidence-policy')}">Story chapter ${chapterNo('evidence-policy')} <span aria-hidden="true">&rarr;</span></a></p>
              </div>
            </div>
          </section>`;
    },

    title() {
        const q = QUESTIONS.find(x => x.id === this.cur);
        return q ? q.title : null;
    },
};
