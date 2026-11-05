import * as d3 from 'd3';
import { STATE, METRIC_FORMAT, MAP_DISCLAIMER } from './config.js';
import { DataLoader } from './dataLoader.js';
import { chapterHtml } from './storyCards.js';
import { StoryCharts, shortName, grow, fadeIn } from './storyCharts.js';
import { createStoryMap } from './storyMap.js';
import { Findings, Calc, findingText, usd, tonnes, pct, yr, longDate } from './storyFindings.js';
import { cssVar, ISO_MAP } from './baseMap.js';
import { prefersReducedMotion, motionOn, MS, EASE } from './motion.js';
import { leave, enter, box_ } from './transitions.js';

// The story (docs/design/STORY_V5.md; v2 look, docs/design/REDESIGN_V2.md). One chapter at a time, in the
// frame of the explorer, after the story of the Non-plastic dashboard (UNCTAD, ../Non-plastic/dashboard/js/story.js):
// a column with the chapter (a short title, two or three sentences computed from UN Comtrade with the key numbers
// in bold, then, set apart, any notes from the SMEP reports or the HS), the flat map of the chapter and a column
// (or a band under the map) for its chart. Map and chart are drawn from the same calculations as the text and mark
// the economies it names. Chapters where change over time is the point play through the years.
// Back / Next, the dashes, the arrow keys and #story=N move between chapters. Each chapter's button opens the
// explorer in the matching state; "Back to the story" returns to it.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LIION = { product: 'BAT_LIION', year: 2024, metric: 'weight', top: 30 };
const SPENT11 = { product: 'SPENT_11', year: 2024, metric: 'weight', top: 20 };
const WORLD = { world: true, lon: 10, lat: 8 };
const TWO_REPORTS_TEXT = [
    'Most flows are recorded twice: once by the exporting economy and once by the importing economy. Exports are valued FOB and imports usually CIF, so some difference is expected. Larger differences can come from classification, timing, transit, confidential data or one side not reporting. These statistics do not show which.',
    'The monitor uses the exporter’s report. Where the exporter did not report for the year, it uses the importer’s report and marks it with a dagger (†).',
];

// Chapters. `show` = the explorer state the chapter's button opens; `play` = the chapter steps through the years.
export const SCENES = [
    { id: 'intro', short: 'Opening', view: { world: true, lon: 10, lat: 8, maxK: 1 }, flows: LIION, labels: 4 },
    { id: 'battery-boom', title: 'Batteries boom', short: 'Battery boom', view: { world: true, maxK: 1 }, spikes: 'boom', chart: 'boom', mode: 'below', play: 'boom',
        show: { product: 'BAT_ALL', year: 2024, metric: 'value', preset: 'GLOBAL', view: 'map' } },
    { id: 'today-tomorrow', title: 'Today’s batteries, tomorrow’s spent batteries', short: 'Batteries by weight', view: { world: true, maxK: 1 }, spikes: 'liw', chart: 'weight', mode: 'below',
        show: { product: 'BAT_LIION', year: 2024, metric: 'weight', preset: 'GLOBAL', view: 'map' } },
    { id: 'where-spent-go', title: 'Spent batteries: a small, concentrated trade', short: 'Spent batteries', view: WORLD, flows: SPENT11, labels: 8, chart: 'conc', mode: 'inset',
        show: { product: 'SPENT_11', year: 2024, metric: 'weight', preset: 'GLOBAL', view: 'map' } },
    { id: 'two-reports', title: 'Two reports of the same trade', short: 'Two reports', extra: TWO_REPORTS_TEXT,
        views: [{ name: 'World', world: true }, { name: 'Americas', box: [[-128, 8], [-55, 60]], only: 'americas' }, { name: 'Europe', box: [[-11, 35], [33, 62]], only: 'europe' }],
        flows: { ...SPENT11, top: 12, twin: true }, chart: 'gap', mode: 'inset', labels: 12,
        show: { product: 'SPENT_11', year: 2024, metric: 'weight', preset: 'GLOBAL', view: 'gap' } },
    { id: 'cannot-see', title: 'What the codes cannot see', short: 'Blind spots', view: { world: true, maxK: 1.2 }, flows: null, land: 'hs', spikes: 'hs13', chart: 'hs', mode: 'below', play: 'hs',
        show: { visibility: true, scope: 'WORLD', flow: 'X' } },
    { id: 'regional-rules', title: 'Japan, ASEAN and India: who trades with whom', short: 'Japan–ASEAN–India', view: { box: [[68, -11], [146, 38]] }, flows: { product: 'SPENT_ALL', year: 2024, metric: 'weight', top: 20, preset: 'JAI', within: true }, chart: 'matrix', mode: 'inset', labels: 5,
        show: { product: 'SPENT_ALL', year: 2024, metric: 'weight', preset: 'JAI', view: 'matrix' } },
    { id: 'bangladesh', title: 'When recycling goes wrong: Bangladesh', short: 'Bangladesh', view: { box: [[34, -40], [152, 45]] }, flows: { product: 'BAT_LA', year: 2024, metric: 'value', top: 15, country: 'BGD' }, focus: 'BGD', labels: 4, chart: 'bgd', mode: 'below',
        show: { product: 'BAT_LA', year: 2024, metric: 'value', preset: 'GLOBAL', view: 'map', country: 'BGD' } },
    { id: 'evidence-policy', title: 'From evidence to policy', short: 'Evidence to policy', view: { box: [[-15, -30], [130, 58]] }, flows: { product: 'SPENT_11', year: 2024, metric: 'weight', top: 20, preset: 'SAS' }, labels: 4, chart: 'policy', mode: 'inset',
        show: { product: 'SPENT_ALL', year: 2024, metric: 'weight', preset: 'SAS', view: 'map' } },
    { id: 'explore', short: 'Explore', view: WORLD, flows: { product: 'SPENT_ALL', year: 2024, metric: 'weight', top: 20 }, labels: 6 },
];
export const chapterNo = id => SCENES.findIndex(s => s.id === id);
// an idle moment (requestIdleCallback where there is one)
const idle = () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 80)));
const PLAY_STEP = { boom: 520, hs: 1100 };

const EXPLORE_TILES = [
    { title: 'Map of flows', text: 'Directed flows with arrows, ranked list and economy panels.', show: { product: 'SPENT_ALL', year: 2024, metric: 'weight', preset: 'GLOBAL', view: 'map' } },
    { title: 'Japan–ASEAN–India matrix', text: 'Who trades with whom, and where data are missing.', show: { product: 'SPENT_ALL', year: 2024, metric: 'weight', preset: 'JAI', view: 'matrix' } },
    { title: 'Two reports', text: 'Exporter’s and importer’s reports of the same flows, side by side.', show: { product: 'SPENT_11', year: 2024, metric: 'weight', preset: 'GLOBAL', view: 'gap' } },
    { title: 'Spent batteries by HS code', text: 'Spent batteries by HS 6-digit code, 2022–2024ᵖ.', show: { visibility: true, scope: 'WORLD', flow: 'X' } },
    { title: 'Methodology', text: 'Sources, rules for choosing flows, weights and limits.', act: 'methodology' },
];

export const Story = {
    el: null,
    stage: null,
    stageEl: null,
    chartEl: null,
    active: -1,
    _chartApi: null,
    _flowsKey: null,
    _viewIdx: 0,
    _seq: 0,
    _found: {},

    init(el, { onShow, onAction, onOpen, layerSwap }) {
        this.el = el;
        this.onShow = onShow;
        this.onAction = onAction;
        this.onOpen = onOpen;
        // a change of layer (the story to the explorer and back) as one View Transition (src/main.js layerSwap)
        this.layerSwap = layerSwap || ((to, fn) => Promise.resolve(fn()));
        el.innerHTML = this.html();
        el.tabIndex = -1;
        this.stageEl = el.querySelector('.st-stage');
        this.mapEl = el.querySelector('.st-map');
        this.chartEl = el.querySelector('.st-chart');
        this.stepsEl = el.querySelector('.st-steps');
        this.yearEl = el.querySelector('.st-yearbar');
        this.scenes = [...el.querySelectorAll('.st-scene')];
        this.cells = [...el.querySelectorAll('.st-cell')];
        const lab = el.querySelector('.st-progress-label');
        const say = k => { if (lab) lab.textContent = k ? `${k} of ${SCENES.length - 1} · ${SCENES[k].short}` : 'Opening'; };
        this.cells.forEach((c, k) => {
            c.addEventListener('mouseenter', () => say(k));
            c.addEventListener('focus', () => say(k));
            c.addEventListener('mouseleave', () => say(this.active));
            c.addEventListener('blur', () => say(this.active));
        });

        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-card]');
            if (b) {
                const sc = SCENES.find(s => s.id === b.dataset.card);
                const from = this.active;
                this.layerSwap('explore', () => { this.close({ fromScene: from }); return this.onShow?.(sc.show); });
                return;
            }
            const t = e.target.closest('[data-tile]');
            if (t) {
                const tile = EXPLORE_TILES[+t.dataset.tile];
                if (tile.act) { this.close(); this.onAction?.(tile.act); return; }
                this.layerSwap('explore', () => { this.close(); return this.onShow?.(tile.show); });
                return;
            }
            const v = e.target.closest('[data-sview]');
            if (v) { this.setSubView(+v.dataset.sview); return; }
            if (e.target.closest('.st-play')) { this.togglePlay(); return; }
            if (e.target.closest('[data-next]')) { this.next(); return; }
            if (e.target.closest('[data-prev]')) { this.prev(); return; }
            const g = e.target.closest('[data-goto]');
            if (g) { this.goTo(+g.dataset.goto); return; }
            if (e.target.closest('[data-close-stories]')) { this.onAction?.('explore'); }   // the explorer closes the story (Back returns here)
        });
        // keys: → / PageDown next, ← / PageUp back (not while a field or the chart's own controls have the focus)
        el.addEventListener('keydown', (e) => {
            if (e.target.closest('input, select, textarea, .stc-toggle, .db-row')) return;
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const k = e.key;
            if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); this.next(); }
            else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); this.prev(); }
            else if (k === 'Home' && !e.target.closest('button')) { e.preventDefault(); this.goTo(0); }
            else if (k === 'End' && !e.target.closest('button')) { e.preventDefault(); this.goTo(SCENES.length - 1); }
        });
    },

    html() {
        const scene = (s, n) => {
            const inner = s.id === 'intro' ? this.introHtml() : s.id === 'explore' ? this.exploreHtml() : chapterHtml(s);
            const views = s.views ? `<div class="st-views tb-fld"><span class="tb-cap">Map</span><div class="tb-seg" role="group" aria-label="Part of the map">${s.views.map((v, k) => `<button class="btn-toggle ${k ? '' : 'active'}" type="button" data-sview="${k}" aria-pressed="${!k}">${esc(v.name)}</button>`).join('')}</div></div>` : '';
            return `<section class="st-scene st-${s.id}" data-scene="${n}" id="scene-${s.id}" aria-label="${esc(s.short)}">${inner}${views}</section>`;
        };
        return `
          <div class="st-stage" data-scene="intro" data-globe="2d">
            <div class="st-col">
              <div class="st-steps">
                <p class="st-step-label" aria-hidden="true"></p>
                ${SCENES.map(scene).join('')}
              </div>
              <div class="st-nav">
                <nav class="st-progress" aria-label="Story chapters">
                  <span class="st-progress-label" aria-hidden="true"></span>
                  <span class="st-battery">${SCENES.map((s, n) => `<button class="st-cell" type="button" data-goto="${n}" aria-label="${n ? `Chapter ${n} of ${SCENES.length - 1}: ${esc(s.short)}` : 'Opening'}" title="${n ? `${n} · ` : ''}${esc(s.short)}"><i></i></button>`).join('')}</span>
                </nav>
                <button class="btn-line" type="button" data-close-stories>Skip</button>
                <button class="btn-line" type="button" data-prev>Back</button>
                <button class="btn-solid" type="button" data-next>Next</button>
              </div>
            </div>
            <div class="st-mapcell">
              <div class="st-map"></div>
              <div class="st-yearbar" hidden><span class="st-year" aria-hidden="true"></span><button class="btn-line st-play" type="button"></button></div>
              <div class="st-cover-chart" aria-hidden="true"></div>
              <p class="st-caption"><span class="st-caption-data"></span>
                <strong>Source:</strong> UN Comtrade; UNCTAD calculations. <strong>Map:</strong> ${MAP_DISCLAIMER}</p>
            </div>
            <div class="st-chart"></div>
            <button class="st-edge" type="button" data-close-stories aria-label="Skip the story: explore the data" title="Explore the data"><span>Explore the data</span><b aria-hidden="true">&rarr;</b></button>
          </div>`;
    },

    introHtml() {
        return `<div class="st-hero">
            <h1 class="st-h1">Global Battery Trade Monitor</h1>
            <p class="st-lede">Most trade flows are recorded twice: by the exporting and by the importing economy. This monitor shows both reports.</p>
            <div class="st-ledger" role="table" aria-label="World totals for 2024 as reported by exporters and by importers"></div>
            <div class="st-cta">
              <button class="st-btn primary" type="button" data-goto="1">Start the story <span aria-hidden="true">&rarr;</span></button>
              <button class="st-btn" type="button" data-close-stories>Explore the data <span aria-hidden="true">&rarr;</span></button>
            </div>
            <p class="st-note"><strong>Source:</strong> UN Comtrade; UNCTAD calculations. Every number in the chapters, maps and charts is computed from UN Comtrade data extracted for this tool. Text from the SMEP project reports and notes on the HS codes are shown apart, with their sources.</p>
          </div>`;
    },

    exploreHtml() {
        return `<div class="st-explore-card">
            <h2 class="st-h2">Explore the data</h2>
            <p class="st-p">Choose a product, year and measure; open an economy for its partners, concentration and both sides’ reports; download what you see as CSV.</p>
            <div class="st-tiles">${EXPLORE_TILES.map((t, n) => `<button class="st-tile" type="button" data-tile="${n}"><b>${esc(t.title)}</b><span>${esc(t.text)}</span><i aria-hidden="true">&rarr;</i></button>`).join('')}</div>
          </div>`;
    },

    // The ledger on the opening: the same flows, reported by both sides, matched flow by flow (2024ᵖ).
    // Computed from the flow files; no report figures.
    async fillFacts() {
        const el = this.el.querySelector('.st-ledger');
        if (!el || el.dataset.done) return;
        el.dataset.done = '1';
        const bi = STATE.buildInfo || {};
        const y = bi.period?.[1] || 2024;
        const prov = (bi.provisional || []).map(String).includes(String(y)) ? 'ᵖ' : '';
        const [bat, sp] = await Promise.all([DataLoader.loadFlows('BAT_ALL', y), DataLoader.loadFlows('SPENT_ALL', y)]);
        const row = (lab, flows) => {
            const both = flows.filter(d => d.src !== 'e' && d.xv > 0 && d.mv > 0);
            const x = d3.sum(both, d => d.xv), m = d3.sum(both, d => d.mv), d = x ? m / x - 1 : 0;
            const diff = `${d >= 0 ? '+' : '−'}${Math.abs(d) < 0.1 ? (Math.abs(d) * 100).toFixed(1) : Math.round(Math.abs(d) * 100)}%`;
            return { lab, x, m, d, diff, n: both.length };
        };
        const rows = [row('All batteries (HS 8507)', bat), row('Spent batteries (HS 8549.1 / 8548.10)', sp)];
        el.innerHTML = `<div class="lg-row lg-head" role="row"><span role="columnheader">Same flows, ${y}${prov}</span><span role="columnheader">Exporters’ reports</span><span role="columnheader">Importers’ reports</span><span role="columnheader">Importers vs exporters</span></div>`
            + rows.map(r => `<div class="lg-row" role="row"><span role="rowheader">${esc(r.lab)}<small>${r.n.toLocaleString('en-US')} flows</small></span>
                <span role="cell" class="lg-num" data-v="${r.x}">${usd(r.x)}</span><span role="cell" class="lg-num" data-v="${r.m}">${usd(r.m)}</span>
                <span role="cell" class="lg-diff">${r.diff}</span></div>`).join('')
            + `<p class="lg-note">Directed flows that both the exporter and the importer reported, matched one by one, by value. + means the importers reported more. Imports are valued CIF and exports FOB, so importers’ reports are usually a few per cent higher; larger differences can have other causes, which these statistics do not show. ${y}${prov ? ' data are provisional' : ''}; UN Comtrade, extracted ${esc(longDate(bi.extracted))}.</p>`;
    },

    // The cover's mini time line: world exports of lead-acid and lithium-ion batteries by year (exporters' own
    // reports, value), the same data as chapter 1. Drawn once; the provisional year hatched.
    async drawCoverChart() {
        const el = this.el.querySelector('.st-cover-chart');
        if (!el || el.dataset.done || !el.clientWidth) return;
        el.dataset.done = '1';
        const c = await Calc.boom();
        if (el.clientWidth < 80 || el.clientHeight < 60) { delete el.dataset.done; return; }   // the cover was left meanwhile
        const years = c.years, rows = c.rows;
        const W = el.clientWidth - 36, H = el.clientHeight - 10, m = { t: 34, b: 16 };
        const x = d3.scaleBand().domain(years).range([0, W]).paddingInner(0.3);
        const y = d3.scaleLinear().domain([0, d3.max(rows, r => r.t) || 1]).range([H - m.b, m.t]);
        const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
        const pt = svg.append('defs').append('pattern').attr('id', 'cc-hatch').attr('width', 5).attr('height', 5).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
        pt.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5).attr('stroke', cssVar('--white')).attr('stroke-width', 1.5).attr('stroke-opacity', 0.8);
        const cap = svg.append('text').attr('class', 'cc-cap').attr('x', 0).attr('y', 11);
        cap.append('tspan').attr('class', 'b').text('World exports of lithium-ion and lead-acid batteries');
        cap.append('tspan').text(' · exporters’ reports, US$');
        const key = svg.append('text').attr('class', 'cc-key').attr('x', 0).attr('y', 26);
        key.append('tspan').attr('fill', cssVar('--bc-li')).text('■ ');
        key.append('tspan').text('lithium-ion   ');
        key.append('tspan').attr('fill', cssVar('--bc-la')).text('■ ');
        key.append('tspan').text('lead-acid');
        const last = years[years.length - 1];
        const g = svg.selectAll('g.cc').data(rows).join('g').attr('class', 'cc').attr('transform', r => `translate(${x(r.y)},0)`);
        g.append('rect').attr('width', x.bandwidth()).attr('y', r => y(r.li)).attr('height', r => y(0) - y(r.li)).attr('fill', cssVar('--bc-li'));
        g.append('rect').attr('width', x.bandwidth()).attr('y', r => y(r.t)).attr('height', r => y(r.li) - y(r.t) - 1).attr('fill', cssVar('--bc-la'));
        g.filter(r => r.y === last).append('rect').attr('class', 'pv').attr('width', x.bandwidth()).attr('y', r => y(r.t)).attr('height', r => y(0) - y(r.t));
        g.append('text').attr('class', r => `cc-lab${r.y === last ? ' prov' : ''}`).attr('x', x.bandwidth() / 2).attr('y', H - 3).text(r => yr(r.y));
        // the opening's one orchestrated moment: the years rise from the baseline, left to right
        grow(g.selectAll('rect').nodes(), 'y', { base: y(0), delay: 120, step: 55, order: el => years.indexOf(d3.select(el).datum()?.y) });
        fadeIn(g.selectAll('text.cc-val').nodes(), { delay: MS.data + 55 * years.length });
        g.filter((r, k) => k === 0 || k === rows.length - 1).append('text').attr('class', 'cc-val').attr('x', x.bandwidth() / 2).attr('y', r => y(r.t) - 4).text(r => usd(r.t).replace(/ /g, ' '));
    },

    async ensureStage() {
        if (this.stage) return this.stage;
        this.stage = createStoryMap(this.mapEl);
        this.stageEl.dataset.globe = this.stage.kind;
        this.stage.onHover?.((f, ev) => this.hoverFlow(f, ev));
        return this.stage;
    },

    // While the story is open, the explorer behind it is out of the tab and reading order
    setExplorerInert(on) {
        ['main', '#kpi-bar', '#map-footer', '#tabbar'].forEach(s => { const e = document.querySelector(s); if (e) e.inert = on; });
    },

    async open(at = null) {
        this.setExplorerInert(true);
        this.el.classList.remove('hidden');
        document.body.classList.add('story-open');
        this.onOpen?.();
        this.fillAllFindings();
        document.getElementById('story-return')?.classList.add('hidden');
        this.fillFacts();
        await this.ensureStage();
        requestAnimationFrame(() => this.drawCoverChart());
        // (the chapter's batch measures the map's cell itself: no extra forced layout here, perf review P3)
        // the story opens on its chapter's end state (a change of layer crossfades the whole page around it)
        const done = at > 0 ? this.goTo(Math.min(at, SCENES.length - 1), { instant: true }) : this.activate(this.active < 0 ? 0 : this.active, true);
        this.el.focus({ preventScroll: true });
        return done;
    },

    close(opts = {}) {
        if (!this.el || this.el.classList.contains('hidden')) return;
        this.stopPlay();
        // first: the explorer comes back (a card may open a modal inside it right after this)
        this.setExplorerInert(false);
        const focusWasHere = this.el.contains(document.activeElement) || document.activeElement === document.body;
        // a card or tile opens the explorer as a new history entry, so Back returns to the chapter
        if (opts.fromScene != null) history.pushState(null, '', location.hash);
        document.body.classList.remove('story-open');
        if (opts.fromScene != null) this.offerReturn(opts.fromScene);
        this.el.classList.add('hidden');
        if (focusWasHere) document.getElementById('map-area')?.focus({ preventScroll: true });
    },

    // After a card opened the explorer: a link that leads back to the same chapter.
    offerReturn(n) {
        const b = document.getElementById('story-return');
        if (!b) return;
        b.innerHTML = `<span aria-hidden="true">&larr;</span> Back to the story: ${esc(SCENES[n].short)}`;
        b.classList.remove('hidden');
        b.onclick = () => this.layerSwap('story', () => { b.classList.add('hidden'); const p = this.open(); document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('on', t.dataset.mode === 'story')); return p; });
    },

    isOpen() { return this.el && !this.el.classList.contains('hidden'); },

    next() { if (this.active >= SCENES.length - 1) { this.onAction?.('explore'); } else this.goTo(this.active + 1); },
    prev() { if (this.active > 0) this.goTo(this.active - 1); },

    goTo(n, opts = {}) {
        if (!this.scenes[n]) return Promise.resolve();
        return this.activate(n, !!opts.instant);
    },

    // One chapter change, one sequence (docs/design/MOTION_V6.md): the old text fades out where it is while the new
    // one lifts in; the dashes fill (or empty) one after the other up to the new chapter; the old chart fades and the
    // new one grows; on the map, the old corridors fade, the camera glides, the new corridors draw on as it lands and
    // the labels follow. A newer change interrupts all of it from where it is.
    activate(n, instant = false) {
        if (n === this.active && !instant && this.isOpen() && this._applied === n) return Promise.resolve();
        const from = this.active;
        const anim = !instant && motionOn() && this.isOpen() && from >= 0 && from !== n;
        // read before anything is written (perf review P3): where the leaving text and chart are now
        const phone = document.documentElement.classList.contains('phone');
        const prev = this.scenes.find(s => s.classList.contains('is-active'));
        const ghost = anim && !phone;
        const prevBox = ghost && prev && prev !== this.scenes[n] ? box_(prev, this.stepsEl) : null;
        this._chartBox = ghost && this.chartEl.classList.contains('on') && this.chartEl.querySelector('.stc-holder') ? box_(this.chartEl, this.stageEl) : null;
        this.active = n;
        if (this.isOpen()) history.replaceState(null, '', n ? `#story=${n}` : '#story');
        this.cells.forEach((c, k) => {
            // forward: the dashes between fill in order; back: they empty from the right
            const d = !anim ? 0 : n > from ? Math.max(0, k - from) * 45 : Math.max(0, from - k) * 35;
            c.style.setProperty('--d', `${Math.min(d, 400)}ms`);
            c.classList.toggle('on', k < n); c.classList.toggle('now', k === n); c.setAttribute('aria-current', k === n ? 'step' : 'false');
        });
        const lab = this.el.querySelector('.st-progress-label');
        if (lab) lab.textContent = n ? `${n} of ${SCENES.length - 1} · ${SCENES[n].short}` : 'Opening';
        this.el.querySelector('.st-step-label').textContent = n ? `Story · ${n} of ${SCENES.length - 1}` : '';
        // the text: the chapter that leaves stays a moment where it was, fading, above the one that arrives
        // (on a phone the chapter is one scrolling column that reflows: the new text simply arrives)
        this._endLeave?.();
        this._endLeave = null;
        if (prevBox) this._endLeave = leave(prev, { ms: MS.micro, rect: prevBox });
        this.scenes.forEach((s, k) => s.classList.toggle('is-active', k === n));
        if (anim) enter(this.scenes[n], { y: 6, delay: 50 });
        this.el.querySelectorAll('.st-headline.on').forEach(h => { if (!this.scenes[n].contains(h)) h.classList.remove('on'); });
        this.stepsEl.scrollTop = 0;
        const nx = this.el.querySelector('[data-next]');
        nx.textContent = n >= SCENES.length - 1 ? 'Explore the data' : 'Next';
        this.el.querySelector('[data-prev]').disabled = n === 0;
        this._viewIdx = 0;
        this.scenes[n].querySelectorAll('[data-sview]').forEach((b, k) => { b.classList.toggle('active', !k); b.setAttribute('aria-pressed', String(!k)); });
        this._applied = n;
        return this.apply(n, instant, anim);
    },

    // Chapter "Two reports": the parts of the map (world, Americas, Europe)
    setSubView(k) {
        const sc = SCENES[this.active];
        if (!sc?.views?.[k]) return;
        this._viewIdx = k;
        this.scenes[this.active].querySelectorAll('[data-sview]').forEach((b, j) => { b.classList.toggle('active', j === k); b.setAttribute('aria-pressed', String(j === k)); });
        this.stage.batch(() => { this.applyOnly(sc.views[k]); this.stage.setView(sc.views[k], 'auto'); });
    },

    // A chapter's computed text (cached: the data do not change while the page is open)
    async finding(id) {
        if (!Findings[id]) return null;
        if (!(id in this._found)) {
            try { this._found[id] = await Findings[id](); } catch { this._found[id] = null; }
        }
        return this._found[id];
    },

    async apply(n, instant, anim = false) {
        const sc = SCENES[n];
        const seq = ++this._seq;
        this.stopPlay();
        await this.ensureStage();
        if (seq !== this._seq) return;
        // the old chart fades out where it was (before the grid changes under it); the new one grows in its place
        if (sc.chart !== this._chartForKind || this._chartFor !== sc.id) this.ghostChart(anim);
        // stage layout: chapter column, map, chart column (or a band under the map)
        this.stageEl.classList.toggle('is-aside', sc.mode === 'aside');
        this.stageEl.classList.toggle('is-inset', sc.mode === 'inset');
        this.stageEl.classList.toggle('is-below', sc.mode === 'below');
        this.stageEl.dataset.scene = sc.id;
        const v0 = sc.views ? sc.views[this._viewIdx || 0] : sc.view;
        const years = sc.play ? await this.playYears(sc) : null;
        const last = years ? years[years.length - 1] : null;
        // a chapter that plays starts on its first year (no jump from the last year back to the first)
        const plays = !!years && !instant && !prefersReducedMotion();
        const y0 = plays ? years[0] : last;
        if (seq !== this._seq) return;
        // flows
        const key = JSON.stringify(sc.flows);
        const list = sc.flows ? await this.sceneFlows(sc.flows) : [];
        this._list = list;
        const h = await this.finding(sc.id);
        const spikes = sc.spikes ? await this.sceneSpikes(sc.spikes, y0) : null;
        if (seq !== this._seq) return;
        this._named = h?.named || [];
        // the map: one sequence for the whole chapter (src/storyMap.js batch): the cell is measured now (the grid
        // has just changed), what leaves fades, the camera glides, the new corridors and spikes arrive as it lands,
        // the labels after it has settled
        this.stage.batch(() => {
            // land layer (HS version by year in the chapter on the codes)
            this.stage.setLand?.(sc.land || 'base', sc.land ? this.landFill(sc.land, y0) : null);
            if (key !== this._flowsKey) {
                this._flowsKey = key;
                this.stage.setFlows(list, { twin: !!sc.flows?.twin });
            }
            this.stage.setSpikes(spikes);
            this.stage.setFocus(sc.focus ? STATE.countryCoords[sc.focus] : null, sc.focus);
            this.stage.setLabels(this.sceneLabels(sc, list));
            this.applyOnly(v0);
            this.stage.setView(v0, instant ? 0 : 'auto');
        }, { instant });
        this.showHeadline(sc, h, anim);
        this.showYear(sc, last, years);
        if (plays) this.yearEl.querySelector('.st-year').textContent = yr(y0);
        if (sc.id === 'intro') requestAnimationFrame(() => this.drawCoverChart());
        const cap = this.el.querySelector('.st-caption-data'), capText = this.caption(sc, list.length);
        if (cap.textContent !== capText) { cap.textContent = capText; if (anim) enter(cap, { y: 0, delay: MS.ui }); }
        // chart
        if (sc.chart) {
            if (this._chartFor !== sc.id) {
                this._chartFor = sc.id;
                // Each chart draws into its own holder, so a slower, superseded chart cannot overwrite it.
                const holder = document.createElement('div');
                holder.className = 'stc-holder';
                this.chartEl.innerHTML = '';
                this.chartEl.appendChild(holder);
                this.chartEl.classList.add('on');
                await new Promise(r => requestAnimationFrame(r));   // the chart column has its size
                const opts = { gap: { mark: h?.wide }, conc: { named: h?.named }, matrix: { highlight: h?.big ? [h.big.e, h.big.i] : [] }, hs: { mark13: true } }[sc.chart] || {};
                opts.grow = !instant;   // marks grow from their baseline on first draw (not on a direct link)
                if (plays && sc.chart === 'boom') opts.year = y0;
                const api = await StoryCharts[sc.chart](holder, this.stageEl, opts);
                if (seq !== this._seq || !holder.isConnected) return;
                this._chartApi = api;
                this._chartForKind = sc.chart;
                const sr = this.scenes[n].querySelector('.sr-summary') || this.scenes[n].appendChild(Object.assign(document.createElement('p'), { className: 'sr-only sr-summary' }));
                sr.textContent = StoryCharts.summary?.(sc.chart) || '';
            }
        } else {
            this._chartFor = null;
            this._chartForKind = null;
            this._chartApi = null;
            this.chartEl.classList.remove('on');
            this.chartEl.innerHTML = '';
        }
        // play through the years where change over time is the point (not with reduced motion, nor on a direct link)
        if (years) {
            if (plays) this.startPlay(sc, years, seq, 600, true);
            else this.frame(sc, last);
        }
        this.prefetch(n);
    },

    // The chart that leaves: lifted out of the chart cell (so the cell holds only the new chart) into a sheet over
    // the place it had, faded out there, removed. Without motion it is simply removed.
    ghostChart(anim) {
        this._ghost?.remove();
        this._ghost = null;
        const old = this.chartEl.querySelector('.stc-holder');
        const b = this._chartBox;   // measured in activate(), before the DOM changed
        this._chartBox = null;
        if (!anim || !old || !b || b.width < 10 || b.height < 10) return;
        const gh = document.createElement('div');
        gh.className = 'st-chart-ghost';
        gh.setAttribute('aria-hidden', 'true');
        gh.inert = true;
        Object.assign(gh.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
        const sc = this.chartEl.scrollTop;
        gh.appendChild(old);
        this.stageEl.appendChild(gh);
        gh.scrollTop = sc;
        this._chartFor = null;
        this._ghost = gh;
        const a = gh.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MS.micro, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
        a.finished.then(() => { gh.remove(); if (this._ghost === gh) this._ghost = null; }, () => {});
    },

    // ── playing through the years (chapters 1 and 5)
    async playYears(sc) {
        if (sc.play === 'boom') return (await Calc.boom()).years;
        if (sc.play === 'hs') return (await Calc.hs()).years;
        return null;
    },
    async frame(sc, y, map = true) {
        if (SCENES[this.active] !== sc) return;
        if (map && sc.play === 'boom') this.stage.setSpikes(await this.sceneSpikes('boom', y));
        if (map && sc.play === 'hs') this.stage.setLand('hs', this.landFill('hs', y));
        if (SCENES[this.active] !== sc) return;
        this._chartApi?.setYear?.(y);
        const t = this.yearEl.querySelector('.st-year');
        t.textContent = yr(y);
    },
    // The first year is shown at once; the next ones follow, one step at a time (the map settles meanwhile).
    // fresh: the chapter has just been drawn on its first year (the map need not be set again)
    startPlay(sc, years, seq, delay = 0, fresh = false) {
        this.stopPlay();
        let k = 1;
        const btn = this.yearEl.querySelector('.st-play');
        const step = () => {
            if (seq !== this._seq || SCENES[this.active] !== sc || !this.isOpen()) { this.stopPlay(); return; }
            this.frame(sc, years[k]);
            k++;
            if (k < years.length) this._playT = setTimeout(step, PLAY_STEP[sc.play] || 700);
            else this.stopPlay();
        };
        this.frame(sc, years[0], !fresh);
        this._playing = true;
        btn.textContent = 'Stop';
        btn.setAttribute('aria-label', 'Stop playing the years');
        this._playT = setTimeout(step, delay + (PLAY_STEP[sc.play] || 700));
    },
    stopPlay() {
        clearTimeout(this._playT);
        this._playT = null;
        this._playing = false;
        const btn = this.yearEl?.querySelector('.st-play');
        const sc = SCENES[this.active];
        if (btn && sc?.play) { btn.textContent = 'Play the years'; btn.setAttribute('aria-label', `Play the years ${this._years?.[0] ?? ''} to ${this._years?.[this._years.length - 1] ?? ''}`); }
    },
    togglePlay() {
        const sc = SCENES[this.active];
        if (!sc?.play || !this._years) return;
        if (this._playing) { this.stopPlay(); return; }
        this.startPlay(sc, this._years, this._seq, 0);
    },
    showYear(sc, last, years) {
        this._years = years;
        this.yearEl.hidden = !years;
        if (!years) return;
        this.yearEl.querySelector('.st-year').textContent = yr(last);
        this.stopPlay();
    },

    // Screen readers: every chapter's computed text is in its section from the start
    // (perf R1) one chapter per idle moment, starting after the chapter shown, so opening the story does not hold
    // a long task while its first chapter animates; a chapter reached earlier computes its own (finding() caches).
    async fillAllFindings() {
        if (this._srDone) return;
        this._srDone = true;
        const start = Math.max(0, this.active);
        const order = SCENES.map((_, k) => (start + 1 + k) % SCENES.length);
        for (const n of order) {
            await idle();
            const h = await this.finding(SCENES[n].id);
            if (h) this.srHeadline(n, h);
        }
    },
    // (perf R1) the next chapter's data, fetched and computed at an idle moment after a chapter has settled
    prefetch(n) {
        const nx = SCENES[n + 1];
        if (!nx) return;
        idle().then(() => {
            if (nx.flows) this.sceneFlows(nx.flows).catch(() => {});
            if (nx.spikes) this.sceneSpikes(nx.spikes).catch(() => {});
            this.finding(nx.id);
        });
    },
    srHeadline(n, h) {
        const sec = this.scenes[n];
        if (!sec) return;
        const sr = sec.querySelector('.sr-headline') || sec.appendChild(Object.assign(document.createElement('p'), { className: 'sr-only sr-headline' }));
        sr.textContent = `UN Comtrade data: ${findingText(h)} ${h.foot || ''}`.trim();
    },

    // The computed text, under the chapter's title: two or three sentences, the numbers in bold navy at text size
    async showHeadline(sc, h, anim = false) {
        const n = SCENES.indexOf(sc);
        const el = this.scenes[n]?.querySelector('.st-headline');
        if (!el) return;
        if (!h) { el.classList.remove('on'); return; }
        let first = false;
        if (!el.dataset.done) {
            el.dataset.done = '1';
            first = true;
            el.innerHTML = `<span class="st-hl-k">UN Comtrade data, UNCTAD calculations</span><p class="st-find">${h.html.join(' ')}</p>${h.foot ? `<small>${esc(h.foot)}</small>` : ''}`;
        }
        if (SCENES[this.active] === sc) {
            const was = el.classList.contains('on');
            el.classList.add('on');
            if (anim && !was) enter(el, { y: 4, delay: 90 });
            // the lead number counts up once, the first time the chapter is reached with Next / Back
            if (anim && first) this.countUp(el.querySelector('.st-hl-num'));
        }
        this.srHeadline(n, h);
    },

    // A whole number (or a whole per cent) counts up to its value in about half a second; anything else is left as
    // it is. The visual text is aria-hidden (the screen-reader text has the value); a newer chapter ends it at once.
    countUp(b) {
        const m = b && /^(\d{1,4})(%?)$/.exec(b.textContent.trim());
        if (!m || !motionOn()) return;
        const to = +m[1], unit = m[2], final = b.textContent;
        if (to < 3) return;
        const t0 = performance.now(), dur = MS.data + 120, sc = this.active;
        const step = (t) => {
            const u = Math.min(1, (t - t0) / dur);
            if (u >= 1 || this.active !== sc || !b.isConnected) { b.textContent = final; return; }
            b.textContent = `${Math.round(to * EASE.out(u))}${unit}`;
            requestAnimationFrame(step);
        };
        b.textContent = `0${unit}`;
        requestAnimationFrame(step);
    },

    // Fill per UN map code for the year shown: reported in HS 2022 (8549 breakdown) = blue; earlier HS version =
    // hatched; no report for the year = land grey (unchanged).
    landFill(name, y) {
        if (name !== 'hs') return null;
        const blue = cssVar('--un-blue-light');
        const yy = String(y || 2024);
        return code => {
            const e = ISO_MAP[parseInt(code, 10)];
            if (!e) return null;
            const rep = (STATE.meta.reporting[e]?.[yy] || '').length > 0;
            if (!rep) return null;
            return STATE.meta.hs_version[e]?.[yy] === 'H6' ? blue : 'hatch';
        };
    },

    // Spikes: one per economy (Non-plastic), from the chapter's calculations
    async sceneSpikes(kind, y) {
        const ll = iso => STATE.countryCoords[iso];
        const item = d => ({ iso: d.iso, v: d.v, lonlat: ll(d.iso), name: shortName(d.iso) });
        if (kind === 'boom') {
            const c = await Calc.boom();
            const yy = y ?? c.years[c.years.length - 1];
            // one scale for every year: the largest value of any year sets it, and stays inside the frame
            const top = c.years.map(q => c.eco[q][0]).filter(Boolean).reduce((a, d) => (d.v > a.v ? d : a));
            return { items: (c.eco[yy] || []).slice(0, 60).map(item), fmt: usd, labels: 5, vmax: c.vmax, fit: true, ref: { lonlat: ll(top.iso), v: top.v }, color: cssVar('--un-blue-dark') };
        }
        if (kind === 'liw') {
            const c = await Calc.weight();
            return { items: c.li.ex.slice(0, 60).map(item), fmt: tonnes, labels: 5, fit: true, color: cssVar('--un-blue-dark') };
        }
        if (kind === 'hs13') {
            const c = await Calc.hs();
            return { items: c.ex13.slice(0, 12).map(item), fmt: v => `${pct(v / (c.tot13 || 1))} of 8549.13`, labels: 3, fit: true, color: cssVar('--un-blue-dark') };
        }
        return null;
    },

    async sceneFlows(cfg) {
        const all = await DataLoader.loadFlows(cfg.product, cfg.year);
        const k = cfg.metric === 'weight' ? 'w' : 'v';
        if (cfg.twin) {
            // both reports of the largest flows (same rule as the Two reports view)
            const xk = cfg.metric === 'weight' ? 'xw' : 'xv', mk = cfg.metric === 'weight' ? 'mw' : 'mv';
            const big = d => Math.max(d[xk] || 0, d[mk] || 0);
            const top = all.filter(d => d.src !== 'e' && big(d) > 0).sort((a, b) => big(b) - big(a)).slice(0, cfg.top);
            const cX = cssVar('--rep-x'), cM = cssVar('--rep-m');
            return top.map(d => ({ e: d.e, i: d.i, a: STATE.countryCoords[d.e], b: STATE.countryCoords[d.i], v: big(d), x: d[xk], m: d[mk], dagger: d.src === 'm', color: cX, colorM: cM, metric: cfg.metric }))
                .filter(x => x.a && x.b);
        }
        let f = all.filter(d => (d[k] || 0) > 0 && d.src !== 'e');
        if (cfg.preset) {
            const m = new Set(STATE.meta.presets[cfg.preset].members);
            f = f.filter(d => (cfg.within ? m.has(d.e) && m.has(d.i) : m.has(d.e) || m.has(d.i)));
        }
        if (cfg.country) f = f.filter(d => d.e === cfg.country || d.i === cfg.country);
        f = f.slice().sort((a, b) => b[k] - a[k]).slice(0, cfg.top);
        const color = cssVar('--un-blue-text');
        return f.map(d => ({ e: d.e, i: d.i, a: STATE.countryCoords[d.e], b: STATE.countryCoords[d.i], v: d[k], dagger: d.src === 'm', color, metric: cfg.metric }))
            .filter(x => x.a && x.b);
    },

    // Show only the corridors that belong to the chosen part of the map (chapter "Two reports")
    applyOnly(view) {
        const reg = { americas: '5200', europe: '5400' }[view?.only];
        const fn = reg ? (f => STATE.eco[f.e]?.reg === reg) : null;
        this.stage?.setFlowFilter?.(fn);
        // labels follow the corridors that are shown
        const sc = SCENES[this.active];
        if (sc && this._list) this.stage?.setLabels(this.sceneLabels(sc, fn ? this._list.filter(fn) : this._list));
    },

    // Tooltip for a hovered arc (data from the flow file; † = importer's report).
    hoverFlow(f, ev) {
        let t = this.stageEl.querySelector('.st-tip');
        if (!t) { t = document.createElement('div'); t.className = 'st-tip'; this.stageEl.appendChild(t); }
        if (!f || !ev) { t.style.display = 'none'; return; }
        const fmt = METRIC_FORMAT[f.metric || 'weight'].fmt;
        const head = `<b>${esc(STATE.countryNames[f.e] || f.e)} → ${esc(STATE.countryNames[f.i] || f.i)}${f.dagger ? ' †' : ''}</b>`;
        t.innerHTML = f.side
            ? `${head}<div class="st-tip-row"><i class="dot db-x"></i>Exporter’s report<span>${f.x == null ? 'no record' : fmt(f.x)}</span></div>
               <div class="st-tip-row"><i class="dot db-m"></i>Importer’s report<span>${f.m == null ? 'no record' : fmt(f.m)}</span></div>
               ${f.side === 'both' ? '<div class="st-tip-note">The two reports agree within 10%: one line.</div>' : ''}`
            : `${head}<div class="st-tip-row">${f.dagger ? 'Importer’s report' : 'Exporter’s report'}<span>${fmt(f.v)}</span></div>
            ${f.dagger ? '<div class="st-tip-note">† The exporter did not report for this year.</div>' : ''}`;
        t.style.display = 'block';
        const r = this.stageEl.getBoundingClientRect(), b = t.getBoundingClientRect();
        let x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
        if (x + b.width > r.width - 8) x = ev.clientX - r.left - b.width - 14;
        if (y + b.height > r.height - 8) y = r.height - b.height - 8;
        t.style.left = x + 'px'; t.style.top = y + 'px';
    },

    // Map labels: the focus economy, then the economies the text names (bold), then the ends of the largest flows.
    // Chapters with spikes label the spikes themselves.
    sceneLabels(sc, list) {
        const out = new Map();
        const ll = iso => STATE.countryCoords[iso];
        if (sc.focus) out.set(sc.focus, { text: shortName(sc.focus), lonlat: ll(sc.focus), cls: 'focus' });
        if (sc.spikes) return [...out.values()].filter(l => l.lonlat);
        const ends = new Set(list.flatMap(f => [f.e, f.i]));
        (this._named || []).filter(iso => ends.has(iso)).forEach(iso => { if (!out.has(iso)) out.set(iso, { text: shortName(iso), lonlat: ll(iso), cls: 'named' }); });
        list.slice(0, sc.labels || 0).forEach(f => {
            [f.e, f.i].forEach(iso => { if (!out.has(iso)) out.set(iso, { text: shortName(iso), lonlat: ll(iso) }); });
        });
        return [...out.values()].filter(l => l.lonlat);
    },

    caption(sc, n) {
        if (sc.spikes === 'boom') return 'Map: exports of lead-acid and lithium-ion batteries by exporter (own reports), US dollars, for the year shown; spike height = exports, one scale for all years.';
        if (sc.spikes === 'liw') return 'Map: exports of lithium-ion batteries by exporter (own reports), tonnes, 2024ᵖ; spike height = weight. Weights flagged as unreliable are left out.';
        if (sc.land === 'hs') return 'Map: HS version used for the year shown. Blue = HS 2022 (spent batteries split into 8549.11–19); hatched = an earlier HS version (no split); grey = did not report. Spikes: the largest exporters of 8549.13, 2022–2024ᵖ, by value.';
        const f = sc.flows;
        if (!f) return '';
        const p = DataLoader.product(f.product);
        if (f.twin) return `Map: ${p.label}, ${f.year}ᵖ, ${n ?? f.top} largest flows (larger of the two reports), ${f.metric}. Solid = exporter’s report; outlined, open arrow = importer’s report; one line if they agree within 10%.`;
        const scope = f.country ? ` touching ${shortName(f.country)}` : f.preset ? (f.within ? ` between ${STATE.meta.presets[f.preset].label} economies` : ` with at least one end in ${STATE.meta.presets[f.preset].label}`) : '';
        return `Map: ${p.label}, ${f.year}ᵖ, largest ${n ?? f.top} flows${scope}, by ${f.metric}. Arrow = importer; dashed with an open arrow = importer’s report (†).${this._named?.length ? ' Bold names: economies named in the text.' : ''}`;
    },
};
