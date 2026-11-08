import './styles/tokens.css';
import './styles/style.css';
import './styles/motion.css';
import './styles/mobile.css';   // phone fixes (docs/design/MOBILE_AUDIT.md), after style.css and motion.css
import * as d3 from 'd3';
import { swap, name as vtName, enter, leave } from './transitions.js';
import { MS, motionOn } from './motion.js';
import { CONFIG, STATE, METRIC_FORMAT, fmtMetric, isProvisional, tickFmt, isPhone, PHONE_Q } from './config.js';
import { DataLoader } from './dataLoader.js';
import { TradeMap } from './map.js';
import { CorridorList } from './corridorList.js';
import { MatrixView } from './matrixView.js';
import { CountryPanel, hhi } from './countryPanel.js';
import { VisibilityPanel } from './visibilityPanel.js';
import { Story } from './storyMode.js';
import { GapView } from './gapView.js';
import { CsvExport } from './csvExport.js';
import { Methodology } from './methodology.js';
import { ProductDock, shortLabel } from './productDock.js';
import { Timeline } from './timeline.js';
import { TableView } from './tableView.js';
import { Pages, QUESTIONS } from './pages.js';
import { Findings, longDate, twoReportsNote, pct as fpct } from './storyFindings.js';
import { VISIBILITY_TEXT, STORY_CARDS } from './storyData.js';

// The explorer. v2 layout (docs/design/REDESIGN_V2.md, after the Non-plastic dashboard): header with search and
// economies; KPI strip with measure and basis; three columns (what · map, matrix or two reports · details);
// the time line at the foot. Functions and URL state are as in v1 (spec 7).
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nm = iso => STATE.countryNames[iso] || iso;
const $ = id => document.getElementById(id);
const REGIONS = ['Global', 'Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];
const VIEWS = [['map', 'Map', 'Directed flows on the map, with the ranked list'], ['matrix', 'Matrix', 'Origin-destination matrix'], ['gap', 'Two reports', 'Exporter’s and importer’s reports of the same flows'], ['table', 'Table', 'The flows in view as a sortable table']];
const POPS = ['product', 'eco', 'year', 'menu'];   // control bar popovers (docs/design/EXPLORER_V4.md)
// Phones (docs/design/MOBILE_V8.md). In portrait the details are a bottom sheet (peek / half / full); in landscape
// (a phone on its side, at most 500 px high) they are a column at the right, as on a desktop (the user's D3).
const LAND_Q = '(orientation: landscape) and (max-height: 500px)';
const isLand = () => document.documentElement.classList.contains('land');
const sheetMode = () => isPhone() && !isLand();
const HALF = 0.5;   // the half sheet's share of the stage (mobile.css: #side.sheet-half)
const LEGEND_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><g stroke-linecap="round" stroke-width="2.4"><path d="M4 7h6" style="stroke:var(--flow-DG)"/><path d="M4 12h6" style="stroke:var(--flow-GD)"/><path d="M4 17h6" style="stroke:var(--flow-GG)"/></g><path d="M13 7h7M13 12h7M13 17h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
// HS codes as people read them: 854911 -> 8549.11, a range with an en dash, "or earlier" (the data files keep 6 digits)
const hsShow = s => String(s || '').replace(/\b(\d{4})(\d{2})\b/g, '$1.$2').replace(/(\d)-(\d)/g, '$1–$2').replace('and earlier', 'or earlier');

// ── URL state (shareable views) ────────────────────────────────────
const Hash = {
    read() {
        const p = new URLSearchParams(location.hash.slice(1));
        const o = {};
        if (p.get('p')) o.product = p.get('p');
        if (p.get('y')) o.year = +p.get('y');
        if (p.get('m')) o.metric = p.get('m');
        if (p.get('v')) o.view = p.get('v');
        if (p.get('s')) o.preset = p.get('s');
        if (p.get('r')) o.region = p.get('r');
        if (p.get('c')) o.country = p.get('c');
        if (p.get('n')) o.topN = +p.get('n');
        if (p.get('b')) o.basis = p.get('b');
        if (p.get('q')) o.fromQ = p.get('q');     // explorer reached from a question page (breadcrumb)
        if (p.get('hs')) o.hs = true;             // open the HS-code panel (one-shot)
        if (p.get('d') === '0') o.side = false;   // details panel closed (v4)
        return o;
    },
    write() {
        if (Story.isOpen() || Pages.isOpen()) return;   // the story and the question pages keep their own links
        const p = new URLSearchParams({ p: STATE.product, y: STATE.year, m: STATE.metric, v: STATE.view, s: STATE.preset });
        if (STATE.region !== 'Global') p.set('r', STATE.region);
        if (STATE.selectedCountry) p.set('c', STATE.selectedCountry);
        if (STATE.topN !== CONFIG.topN.default) p.set('n', STATE.topN);
        if (STATE.basis === 'estimated') p.set('b', 'estimated');
        if (App._fromQ) p.set('q', App._fromQ);
        if (App.sideOpen === false && !isPhone()) p.set('d', '0');
        history.replaceState(history.state, '', '#' + p.toString());   // keeps the phone's Back marker (App.syncBack)
        App._routed = location.hash;
    },
};

const App = {
    _seq: 0,

    async init() {
        const ok = await DataLoader.loadAll();
        if (!ok) { $('loader').querySelector('p').textContent = 'Could not load the data. Check the connection and reload the page.'; return; }
        const h = Hash.read();
        const fresh = !h.product;  // no view in the link: first visit (or a #story=N link)
        const storyAt = Math.max(0, parseInt(new URLSearchParams(location.hash.slice(1)).get('story') || '0', 10) || 0);
        this.applyState(h, false);
        this.watchHeader();
        // the explorer's stage is measured only when the explorer opens (mobile M14: on the entry, a question page or
        // the story this was a forced layout of the hidden explorer; afterStory / showFromCard measure it on entry)
        if (!fresh) this.layoutStage(); else this._sized = false;

        // perf v6: the explorer map is built when the explorer is first shown (afterStory / showFromCard / render), not
        // behind the entry, a question or the story, where it cost a long task before the first paint
        if (!fresh) TradeMap.init();
        TradeMap.setEstTest(d => DataLoader.isEst(d));
        CorridorList.init($('corridor-list'));
        MatrixView.init($('matrix-container'));
        GapView.init($('gap-container'));
        TableView.init($('table-container'));
        this.sideOpen = h.side === false ? false : true;
        this.initStage();
        Timeline.init($('tl'), { onYear: (y) => this.onControl('year', y) });
        Story.init($('story-overlay'), { onShow: (show) => this.showFromCard(show), onAction: (a) => this.onAction(a), onOpen: () => this.setLayer('story'), layerSwap: (to, fn) => this.layerSwap(to, fn) });
        Pages.init($('pages'), { onNavigate: (what) => {
            if (what === 'home-ready') this.bindSearch('home-search', 'home-search-list');
            if (what === 'replaced') this._routed = location.hash;
        } });
        $('methodology-body').innerHTML = Methodology.html(STATE.buildInfo);
        this.renderScopeOptions();
        this.renderControls();
        this.renderBasis();
        this.bindEvents();
        this.bindSearch('search-input', 'search-list');
        // Layers (docs/design/LAYERS_V3.md): without an explorer view in the link, the entry (#home), a question
        // page (#q=…) or the story (#story=N) opens; the explorer renders behind it.
        this._fromQ = h.product ? (h.fromQ || null) : null;
        window.addEventListener('hashchange', () => this.route());
        if (fresh) { this._routed = null; await this.route(); } else { this._routed = location.hash; this.setLayer('explore'); }
        void storyAt;
        await this.update();
        $('loader').classList.add('hidden');
        this._booted = true;   // from now on a change of layer is animated (layerSwap)
        this._armed = !!history.state?.bmLayer;   // a reload keeps the phone's Back marker (syncBack)
        if (h.country) this.openCountry(h.country);
        if (h.product && h.hs) this.openVisibility();
        this.syncMode();
        document.fonts?.ready?.then(() => { if (this.layer !== 'explore') { this._sized = false; return; } if (this.layoutStage() && !Story.isOpen()) { TradeMap.init(); this.render(); } }).catch(() => {});
    },

    // The story overlay sits under the header: keep its top in step with the header's height.
    watchHeader() {
        const set = () => document.documentElement.style.setProperty('--hdrh', `${$('main-header').getBoundingClientRect().height}px`);
        set();
        new ResizeObserver(set).observe($('main-header'));
        const mq = window.matchMedia(PHONE_Q), lq = window.matchMedia(LAND_Q);
        const changed = () => {
            const d = document.documentElement, was = [isPhone(), isLand()].join();
            d.classList.toggle('phone', mq.matches);
            d.classList.toggle('land', mq.matches && lq.matches);
            if ([isPhone(), isLand()].join() === was) return;
            this.placeControls();
            // a phone turned: portrait has the sheet, landscape the column (the economy or the flow stays open)
            if (sheetMode()) this.setSheet(STATE.selectedCountry || !$('arc-modal').classList.contains('hidden') ? 'half' : 'peek');
            else { this.sideOpen = true; $('side-body').inert = false; if (isPhone()) this.setSheet('peek'); }
            if (this.layer === 'explore') { this.layoutStage(); TradeMap.init(); this.render(); } else this._sized = false;
        };
        mq.addEventListener?.('change', changed);
        lq.addEventListener?.('change', changed);
    },

    // Phones (docs/design/MOBILE_V8.md): the Product, Economies and Year controls, with their popovers, and the measure
    // live in the Choose layer (#choose), opened by one summary button; on a desktop they are back in the control bar.
    // The same elements move, so their ids, events and tests are the same in both places.
    placeControls() {
        const bar = $('ctlbar'), menu = $('ctl-menu-w'), chip = $('scope-chip');
        const wraps = ['ctl-product-w', 'ctl-eco-w', 'ctl-year-w'].map($);
        if (isPhone()) {
            if (wraps[0].parentNode === $('choose-tabs')) return;
            this.closePop(false);
            $('choose-tabs').append(...wraps);
            $('choose-foot').append($('meas-fld'));
            $('ctl-choose').after(chip);   // the economy's × stays in the bar
        } else {
            if (wraps[0].parentNode === bar) return;
            this.closeChoose(false);
            wraps.forEach(w => bar.insertBefore(w, menu));
            bar.insertBefore($('meas-fld'), menu);
            $('ctl-eco').after(chip);
        }
    },

    // v4: the stage is the whole screen. What floats over it (control bar, panel, view switcher, legend) is measured
    // into CSS variables, and the map is fitted to the part that is left (TradeMap.zoneFn). True when it changed.
    layoutStage() {
        const root = document.documentElement.style;
        const prev = [root.getPropertyValue('--sidew'), root.getPropertyValue('--footh'), root.getPropertyValue('--ctlh')].join();
        const side = $('side');
        const sheet = sheetMode(), land = isLand();   // landscape phone: a column at the right edge, as on a desktop
        side.classList.toggle('closed', !sheet && !this.sideOpen);
        $('side-open').classList.toggle('hidden', sheet || this.sideOpen);
        const sw = sheet ? 0 : this.sideOpen ? side.offsetWidth + (land ? 0 : 24) : $('side-open').offsetWidth + (land ? 0 : 16);
        root.setProperty('--sidew', `${Math.round(sw)}px`);
        root.setProperty('--footh', `${Math.round(this.footH())}px`);
        root.setProperty('--ctlh', `${Math.round($('ctlbar').offsetHeight + 10)}px`);
        return prev !== [root.getPropertyValue('--sidew'), root.getPropertyValue('--footh'), root.getPropertyValue('--ctlh')].join();
    },

    // The part of the map that nothing covers: the map is fitted to it and selections are centred in it
    visibleZone() {
        const area = $('map-area').getBoundingClientRect();
        if (!area.width) return { top: 10, right: 10, bottom: 10, left: 10 };
        const bar = $('ctlbar').getBoundingClientRect();
        const top = Math.max(10, bar.bottom - area.top + 10);
        if (sheetMode()) {
            // where the sheet will be, not where its height transition is (mobile M08). At "full" the map is covered;
            // its camera keeps the half-sheet zone. The one-line map note sits on the sheet and moves with it (v8).
            const stage = $('stage').getBoundingClientRect();
            const sheetTop = stage.bottom - (this._sheet === 'half' || this._sheet === 'full' ? stage.height * HALF : this.peekH());
            const footTop = sheetTop - this.footH();
            const bottom = Math.max(10, Math.min(area.height - top - 40, area.bottom - footTop + 6));
            return { top, right: 6, bottom, left: 6 };
        }
        if (isPhone()) {
            // landscape phone: the map is the part left of the column, down to the one-line map note
            const right = Math.max(6, area.right - (this.sideOpen ? $('side') : $('side-open')).getBoundingClientRect().left + 6);
            const footTop = area.bottom - this.footH();
            return { top: Math.max(8, bar.bottom - area.top + 6), right, bottom: Math.max(10, area.bottom - footTop + 4), left: 6 };
        }
        const vs = $('viewsw').getBoundingClientRect();
        // where the panel (or its handle) will be, without the slide it may be making (src/styles/motion.css)
        const se = this.sideOpen ? $('side') : $('side-open'), rr = se.getBoundingClientRect();
        const tx = new DOMMatrixReadOnly(getComputedStyle(se).transform === 'none' ? undefined : getComputedStyle(se).transform).m41;
        const side = { left: rr.left - tx };
        const right = Math.max(12, area.right - side.left + 12);
        return { top, right, bottom: Math.max(12, area.bottom - vs.top + 8), left: 12 };
    },
    // the notes strip's height at rest (on a phone "more" opens it over the map, and the map is not fitted to that)
    footH() {
        const f = $('map-footer');
        if (!isPhone()) return f.offsetHeight;
        if (!f.classList.contains('open')) this._footh = f.offsetHeight;
        return this._footh || 30;
    },
    peekH() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--peekh')) || 56; },

    // ── v4 stage: popovers, the details panel, the one-time hint
    initStage() {
        TradeMap.zoneFn = () => this.visibleZone();
        // popovers: one open at a time; Escape or a click outside closes; focus goes in and comes back
        this.placeControls();
        POPS.forEach(k => $(`ctl-${k}`).addEventListener('click', (e) => { e.stopPropagation(); this.togglePop(k); }));
        // inside the Choose layer the popovers are its sections: a tap elsewhere in the layer keeps the open one
        document.addEventListener('mousedown', (e) => {
            if (this._choose) { if (!$('choose').contains(e.target) && !e.target.closest?.('.modal')) this.closeChoose(false); return; }
            if (!this._pop) return;
            const w = $(`ctl-${this._pop}-w`);
            if (w && !w.contains(e.target)) this.closePop(false);
        });
        document.addEventListener('focusin', (e) => {
            if (!this._pop || this._choose) return;
            const w = $(`ctl-${this._pop}-w`);
            if (w && !w.contains(e.target) && !e.target.closest?.('.tip')) this.closePop(false);
        });
        // phone: the summary button opens the Choose layer; Done, Escape or Back close it (changes apply at once)
        $('ctl-choose').addEventListener('click', () => (this._choose ? this.closeChoose() : this.openChoose()));
        $('choose-done').addEventListener('click', () => this.closeChoose());
        // play shows the years on the map: the layer steps aside (Timeline's own handler runs after this one)
        $('play').addEventListener('click', () => { if (this._choose && !Timeline._timer) setTimeout(() => this.closeChoose(), 0); });
        // phone: the notes strip is one line ("more" opens the whole UN map note, the source and the notes over the map)
        $('foot-more').addEventListener('click', () => this.setNotes(!$('map-footer').classList.contains('open')));
        $('eco-filter').addEventListener('input', () => this.renderEcoList());
        $('eco-filter').addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); $('eco-list').querySelector('button')?.focus(); }
            if (e.key === 'Enter') { const b = $('eco-list').querySelector('button[data-iso]'); if (b) { e.preventDefault(); b.click(); } }
        });
        $('eco-list').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-iso]');
            if (b) { this.closePop(false); this.closeChoose(false); this.openCountry(b.dataset.iso); return; }
            if (e.target.closest('[data-eco-clear]')) { this.closePop(false); this.closeChoose(false); this.closeCountry(); }
        });
        $('eco-list').addEventListener('keydown', (e) => {
            const items = [...$('eco-list').querySelectorAll('button')];
            const k = items.indexOf(document.activeElement);
            if (k < 0) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, k + 1)].focus(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); (k ? items[k - 1] : $('eco-filter')).focus(); }
        });
        // the details panel: one handle; on a phone a sheet (peek, half, full)
        $('side-toggle').addEventListener('click', () => (sheetMode() ? this.cycleSheet() : this.setSide(false)));
        $('side-open').addEventListener('click', () => this.setSide(true, true));
        this.bindSheetDrag();
        $('legend-toggle').addEventListener('click', () => {
            const off = !document.body.classList.toggle('legend-off');
            $('legend-toggle').setAttribute('aria-pressed', String(off));
        });
        new ResizeObserver(() => { if (this.layer === 'explore' && this.layoutStage()) { TradeMap.init(); this.render(); } }).observe($('ctlbar'));
        if (isPhone()) this.setSheet('peek');
    },

    // ── Phone: the Choose layer (docs/design/MOBILE_V8.md). A dialog under the header with the Product, Economies and
    //    Year controls as its tabs (one section open at a time: the same popovers) and the measure at its foot.
    openChoose(k = this._chooseTab || 'product') {
        if (this._choose || !isPhone()) return;
        this.closePop(false);
        this._choose = true;
        const c = $('choose');
        c.classList.remove('hidden');
        enter(c, { y: 10, ms: MS.ui });
        $('ctl-choose').setAttribute('aria-expanded', 'true');
        ['main', '#tabbar', '#main-header'].forEach(s => { const e = document.querySelector(s); if (e) e.inert = true; });
        this.openPop(k);
        this.syncBack();
    },
    closeChoose(focus = true) {
        if (!this._choose) return;
        if (this._pop) this._chooseTab = this._pop;
        this.closePop(false);
        this._choose = false;
        $('choose').classList.add('hidden');
        $('ctl-choose').setAttribute('aria-expanded', 'false');
        const off = this.layer !== 'explore';
        ['main', '#tabbar'].forEach(s => { const e = document.querySelector(s); if (e) e.inert = off; });
        $('main-header').inert = false;
        if (focus) $('ctl-choose').focus({ preventScroll: true });
        this.syncBack();
    },

    // Phone: the notes strip opens over the map and closes again (its height at rest is what the map is fitted to)
    setNotes(open) {
        const f = $('map-footer');
        if (open) this.footH();
        f.classList.toggle('open', open);
        $('foot-more').setAttribute('aria-expanded', String(open));
        $('foot-more').firstChild.textContent = open ? 'less' : 'more';
        $('footer-notes').classList.toggle('clamp', !open);
        $('notes-btn').setAttribute('aria-expanded', String(open));
        $('notes-btn').textContent = open ? 'Fewer notes' : 'All notes';
        if (open) f.scrollTop = 0;
    },

    togglePop(k) {
        if (this._pop === k) { if (!this._choose) this.closePop(true); return; }   // in the Choose layer a section stays open
        this.openPop(k);
    },
    openPop(k) {
        if (this._pop) this.closePop(false);
        this._pop = k;
        $(`pop-${k}`).classList.remove('hidden');
        $(`ctl-${k}`).setAttribute('aria-expanded', 'true');
        if (k === 'eco') { $('eco-filter').value = ''; this.renderEcoList(); }
        if (k === 'year') Timeline.render(this._summary);
        const pop = $(`pop-${k}`);
        if (this._choose) { pop.scrollTop = 0; $(`ctl-${k}`).focus({ preventScroll: true }); return; }   // the tab: no keyboard pops up
        const first = k === 'year' ? $('tl').querySelector('.tl-col.on')
            : ['input', 'select', 'button.active', 'button:not([disabled])', '[tabindex="0"]'].map(q => pop.querySelector(q)).find(Boolean);
        first?.focus({ preventScroll: true });
    },
    closePop(focusBack = true) {
        const k = this._pop;
        if (!k) return;
        this._pop = null;
        $(`pop-${k}`).classList.add('hidden');
        $(`ctl-${k}`).setAttribute('aria-expanded', 'false');
        if (focusBack) $(`ctl-${k}`).focus({ preventScroll: true });
    },

    // Economies popover: the economies of the selection by trade, or all that match the search
    renderEcoList() {
        const q = $('eco-filter').value.trim().toLowerCase();
        const stats = STATE.nodeStats || {};
        let list;
        if (q) {
            list = Object.values(STATE.eco).filter(e => e.name.toLowerCase().includes(q) || e.iso.toLowerCase() === q)
                .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name)).slice(0, 40).map(e => e.iso);
        } else {
            list = Object.keys(stats).filter(i => STATE.eco[i]).sort((a, b) => (stats[b].total || 0) - (stats[a].total || 0)).slice(0, 40);
        }
        const max = Math.max(1, ...list.map(i => stats[i]?.total || 0));
        $('eco-list-cap').textContent = q ? `${list.length ? list.length : 'No'} economies match` : `Economies in this selection, by exports plus imports (${METRIC_FORMAT[STATE.metric].label.toLowerCase()})`;
        const sel = STATE.selectedCountry;
        $('eco-list').innerHTML = (sel ? `<li><button type="button" class="eco-clear" data-eco-clear>&larr; All economies (close ${esc(nm(sel))})</button></li>` : '')
            + list.map(i => `<li><button type="button" class="row ${i === sel ? 'on' : ''}" data-iso="${i}" style="--c:var(--un-blue)" aria-pressed="${i === sel}">
                <span class="sw"></span><span class="nm">${esc(nm(i))}</span><span class="vl">${stats[i]?.total ? fmtMetric(stats[i].total) : ''}</span>
                <span class="bar" aria-hidden="true"><i style="width:${((stats[i]?.total || 0) / max * 100).toFixed(1)}%"></i></span></button></li>`).join('')
            || '<li class="cl-empty">Nothing to show. Type part of a name, or choose other economies above.</li>';
    },

    // The free part of the stage changed (the panel opened or closed): the map camera moves into it when the map
    // engine can do that without projecting the map again (TradeMap.refit, src/map.js); otherwise it is fitted again.
    refitMap() {
        if (typeof TradeMap.refit === 'function') return TradeMap.refit(MS.ui);
        TradeMap.init();
        return null;
    },

    // Details panel (desktop: open / closed; phone: a sheet)
    setSide(open, focus = false) {
        if (sheetMode()) { this.setSheet(open ? 'half' : 'peek'); return; }
        if (this.sideOpen === open && !$('side').classList.contains('closed') === open) return;
        this.sideOpen = open;
        $('side-toggle').setAttribute('aria-expanded', String(open));
        this.layoutStage();          // the panel slides in or out (src/styles/motion.css)
        this.refitMap();             // while the map moves into the part of the stage that is now free
        this.render();
        Hash.write();
        if (focus) (open ? $('side-toggle') : $('side-open')).focus({ preventScroll: true });
        else if (!open) $('side-open').focus({ preventScroll: true });
    },
    setSheet(st) {
        const side = $('side');
        ['peek', 'half', 'full'].forEach(x => side.classList.toggle(`sheet-${x}`, x === st));
        this._sheet = st;
        document.documentElement.dataset.sheet = st;   // what sits above the sheet moves with it (mobile.css, M08)
        const sheet = sheetMode();   // a landscape phone has the column: its toggle hides it, as on a desktop
        $('side-toggle').setAttribute('aria-expanded', String(sheet ? st !== 'peek' : this.sideOpen !== false));
        $('side-toggle').querySelector('.st-txt').textContent = !sheet ? 'Hide details' : st === 'full' ? 'Less' : 'More';
        $('side-body').inert = sheet && st === 'peek';   // at peek only the head is in sight (mobile M31)
        this.syncBack();
    },
    cycleSheet() { this.setSheet({ peek: 'half', half: 'full', full: 'peek' }[this._sheet || 'peek']); this.frameSheet(); },
    // Phone: after the sheet moved, the map keeps what is chosen in the part above it (a flow's two ends, the economy
    // and its partners, or all the flows). A camera move only (src/map.js); at "full" the sheet covers the map.
    frameSheet() {
        if (!sheetMode() || STATE.view !== 'map' || this._sheet === 'full' || !TradeMap.zoomBehavior) return;
        if (this._pair && !$('arc-modal').classList.contains('hidden')) TradeMap.frameIsos(this._pair);
        else if (STATE.selectedCountry) TradeMap.frameFlows(STATE.selectedCountry);
        else TradeMap.fitFlows();
    },

    // Phone: the sheet's head is its handle (mobile M07). A tap on it changes the state, as "More" does; a drag moves
    // the sheet with the finger and it snaps to the nearest of peek / half / full on release (a quick flick goes to the
    // next one in its direction). The snap uses the sheet's CSS height transition (motion.css, --mo-ui: 0 ms under
    // reduced motion). The "More" button keeps the keyboard and screen-reader way.
    bindSheetDrag() {
        const side = $('side'), head = side.querySelector('.side-head');
        if (!head) return;
        let drag = null, moved = false;
        const stops = () => {
            const H = $('stage').getBoundingClientRect().height;
            return { peek: this.peekH(), half: H * HALF, full: H - $('ctlbar').offsetHeight };   // full: up to the summary bar
        };
        const move = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const dy = e.clientY - drag.y0;
            if (!moved && Math.abs(dy) < 6) return;
            if (!moved) { moved = true; side.style.transition = 'none'; }
            const now = performance.now();
            drag.v = (e.clientY - drag.ly) / Math.max(1, now - drag.lt);   // px per ms, < 0 = up
            drag.ly = e.clientY; drag.lt = now;
            side.style.height = `${Math.round(Math.max(drag.s.peek, Math.min(drag.s.full, drag.h0 - dy)))}px`;
        };
        const end = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const d = drag; drag = null;
            head.removeEventListener('pointermove', move);
            if (!moved) return;
            const h = side.getBoundingClientRect().height;
            const order = ['peek', 'half', 'full'];
            let st;
            if (Math.abs(d.v) > 0.5) st = d.v < 0 ? order.find(k => d.s[k] > h + 1) || 'full' : [...order].reverse().find(k => d.s[k] < h - 1) || 'peek';
            else st = order.reduce((a, k) => (Math.abs(d.s[k] - h) < Math.abs(d.s[a] - h) ? k : a), 'peek');
            side.style.transition = '';
            side.style.height = '';
            this.setSheet(st);
            this.frameSheet();
        };
        head.addEventListener('pointerdown', (e) => {
            if (!sheetMode() || e.button > 0 || e.target.closest('button')) return;
            const s = stops();
            drag = { id: e.pointerId, y0: e.clientY, ly: e.clientY, lt: performance.now(), v: 0, h0: side.getBoundingClientRect().height, s };
            moved = false;
            head.setPointerCapture?.(e.pointerId);
            head.addEventListener('pointermove', move);
        });
        head.addEventListener('pointerup', end);
        head.addEventListener('pointercancel', end);
        head.addEventListener('click', (e) => {
            if (!sheetMode() || e.target.closest('button')) return;
            if (moved) { moved = false; return; }   // the click that ends a drag
            this.cycleSheet();
        });
    },

    // a one-time hint, remembered in this browser (localStorage may be unavailable: then it shows each time)
    showFirstHint() {
        let seen = false;
        try { seen = localStorage.getItem('bm.hint.v4') === '1'; } catch { /* no storage */ }
        if (seen || this._hintShown || $('first-hint') || document.querySelector('.handover-hint')) return;
        this._hintShown = true;
        const el = document.createElement('div');
        el.id = 'first-hint';
        el.className = 'first-hint';
        el.setAttribute('role', 'status');
        el.innerHTML = 'Select an economy or a flow to see its details. <button type="button" aria-label="Close the hint">&times;</button>';
        $('map-body').appendChild(el);
        const done = () => { try { localStorage.setItem('bm.hint.v4', '1'); } catch { /* no storage */ } el.remove(); this._hintDone = null; };
        this._hintDone = done;   // any way of choosing an economy or a flow (search, list, links) closes it too
        el.querySelector('button').addEventListener('click', done);
        document.addEventListener('bm:country-click', done, { once: true });
        document.addEventListener('bm:arc-click', done, { once: true });
    },

    // Apply a partial state (from the URL or a card). Keeps values valid.
    applyState(s, keepCountry = true) {
        if (s.product && DataLoader.product(s.product)) STATE.product = s.product;
        if (s.metric === 'value' || s.metric === 'weight') STATE.metric = s.metric;
        if (s.preset && STATE.meta.presets[s.preset]) STATE.preset = s.preset;
        if (['map', 'matrix', 'gap', 'table'].includes(s.view)) {
            // phones: a link to another view brings it into sight (an open sheet would cover it)
            if (s.view !== STATE.view && sheetMode() && this._sheet && this._sheet !== 'peek') this.setSheet('peek');
            STATE.view = s.view;
        }
        if (s.basis === 'reported' || (s.basis === 'estimated' && DataLoader.estimationAvailable())) STATE.basis = s.basis;
        if (s.region && REGIONS.includes(s.region)) STATE.region = s.region;
        if (STATE.preset !== 'GLOBAL') STATE.region = 'Global';
        if (s.topN && CONFIG.topN.options.includes(s.topN)) STATE.topN = s.topN;
        const yrs = DataLoader.productYears();
        if (s.year && yrs.includes(s.year)) STATE.year = s.year;
        if (!yrs.includes(STATE.year)) STATE.year = yrs[yrs.length - 1];
        if (!keepCountry) STATE.selectedCountry = null;
    },

    // ── Controls: text tabs in the KPI strip (measure), the map column (view), the left column (product),
    //    the header select (economies) and the time line (year).
    tabs(ctl, items, cur) {
        return items.map(([v, l, t]) => `<button class="btn-toggle ${String(v) === String(cur) ? 'active' : ''}" data-ctl="${ctl}" data-val="${v}" type="button" aria-pressed="${String(v) === String(cur)}" ${t ? `title="${esc(t)}"` : ''}>${esc(l)}</button>`).join('');
    },

    renderScopeOptions() {
        const sel = $('scope-sel');
        const presets = STATE.meta.presets;
        sel.innerHTML = `<option value="GLOBAL">All economies</option>
            <optgroup label="Regions (both ends in the region)">${REGIONS.slice(1).map(r => `<option value="R:${r}">${r}</option>`).join('')}</optgroup>
            <optgroup label="Groups (at least one end in the group)">${Object.entries(presets).filter(([k]) => k !== 'GLOBAL').map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</optgroup>`;
    },
    scopeValue() {
        if (STATE.preset !== 'GLOBAL') return STATE.preset;
        return STATE.region !== 'Global' ? `R:${STATE.region}` : 'GLOBAL';
    },

    renderControls() {
        $('meas').innerHTML = this.tabs('metric', [['weight', 'Weight', 'Tonnes (reported weights)'], ['value', 'Value', 'Current US dollars']], STATE.metric);
        // phone: Weight / Value is at the foot of the Choose layer (#meas, moved there by placeControls), and also in the
        // Menu (mobile M04)
        if (isPhone()) {
            let mm = $('menu-meas');
            if (!mm) {
                mm = document.createElement('div');
                mm.id = 'menu-meas';
                mm.className = 'tb-fld menu-meas';
                mm.innerHTML = '<span class="tb-cap" id="menu-meas-cap">Measure</span><div class="tb-seg" role="group" aria-labelledby="menu-meas-cap"></div>';
                $('pop-menu').prepend(mm);
            }
            mm.querySelector('.tb-seg').innerHTML = this.tabs('metric', [['weight', 'Weight', 'Tonnes (reported weights)'], ['value', 'Value', 'Current US dollars']], STATE.metric);
        }
        $('view-tabs').innerHTML = this.tabs('view', VIEWS, STATE.view);
        $('scope-sel').value = this.scopeValue();
        ProductDock._p = ProductDock.render();
        document.querySelectorAll('#tabbar [data-view]').forEach(b => { const on = b.dataset.view === STATE.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
        this.renderCtlLabels();
    },

    renderCtlLabels() {
        const p = DataLoader.product();
        const sl = shortLabel(p.id);
        $('ctl-product-v').textContent = p.group === 'SPENT' && p.id !== 'SPENT_ALL' ? `Spent${p.id === 'SPENT_11' ? ' ' : ', '}${sl.charAt(0).toLowerCase()}${sl.slice(1)}` : sl;
        $('ctl-product').setAttribute('aria-label', `Product: ${p.label}. Choose the product`);
        const eco = STATE.selectedCountry ? nm(STATE.selectedCountry) : STATE.preset !== 'GLOBAL' ? STATE.meta.presets[STATE.preset].label : STATE.region !== 'Global' ? STATE.region : 'All economies';
        $('ctl-eco-v').textContent = eco;
        $('ctl-eco').setAttribute('aria-label', `Economies: ${eco}. Choose the economies`);
        $('ctl-year-v').textContent = `${STATE.year}${isProvisional(STATE.year) ? 'ᵖ' : ''}`;
        $('ctl-year').setAttribute('aria-label', `Year: ${STATE.year}${isProvisional(STATE.year) ? ' (provisional)' : ''}. Choose the year`);
        // phone: the one summary button (the product, then the economies, the year and the measure)
        const meas = METRIC_FORMAT[STATE.metric].label.toLowerCase(), est = STATE.basis === 'estimated' ? ' · with estimates' : '';
        $('ctl-choose-v').textContent = $('ctl-product-v').textContent;
        $('ctl-choose-k').textContent = `${eco} · ${$('ctl-year-v').textContent} · ${meas}${est}`;
        $('ctl-choose').setAttribute('aria-label', `${$('ctl-product-v').textContent}; ${eco}; ${STATE.year}${isProvisional(STATE.year) ? ' (provisional)' : ''}; ${meas}${est ? '; with experimental estimates' : ''}. Choose the data`);
        $('menu-topn').innerHTML = this.tabs('topn', CONFIG.topN.options.map(n => [n, String(n)]), STATE.topN);
        $('menu-csv-country').disabled = !STATE.selectedCountry;
        $('menu-csv-pair').disabled = !this._pair || $('arc-modal').classList.contains('hidden');
    },

    // Reported / Estimated switch (shown only when meta.json has an active estimation block).
    renderBasis() {
        const el = $('basis-switch');
        const on = DataLoader.estimationAvailable();
        el.classList.toggle('hidden', !on);
        document.body.classList.toggle('basis-estimated', on && STATE.basis === 'estimated');
        if (!on) { el.innerHTML = ''; return; }
        const lab = STATE.meta.estimation?.value?.label || 'Experimental estimates';
        const forMeasure = DataLoader.estAvailableFor();
        const tip = forMeasure
            ? `Experimental estimates (not official statistics). ${lab}. Estimates are marked est. and have 90% intervals.`
            : `No ${STATE.metric} estimates in this build; ${STATE.metric === 'weight' ? 'weights' : 'values'} stay as reported.`;
        el.innerHTML = `<span class="tb-cap">Figures</span><span class="tb-seg">
            <button class="btn-toggle ${STATE.basis === 'reported' ? 'active' : ''}" type="button" data-ctl="basis" data-val="reported" aria-pressed="${STATE.basis === 'reported'}" title="As reported (exporter’s report; † importer’s report)">Reported</button>
            <button class="btn-toggle ${STATE.basis === 'estimated' ? 'active' : ''} ${forMeasure ? '' : 'is-partial'}" type="button" data-ctl="basis" data-val="estimated" aria-pressed="${STATE.basis === 'estimated'}" title="${esc(tip)}">Estimated</button></span>`;
    },

    // Header links: Story / Explore show which mode is on
    syncMode() {
        const mode = Story.isOpen() ? 'story' : Pages.isOpen() ? 'home' : 'explore';
        document.querySelectorAll('.mode-tab').forEach(b => {
            const on = b.dataset.mode === mode;
            b.classList.toggle('on', on);
            if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
    },

    bindEvents() {
        document.addEventListener('click', (e) => {
            const c = e.target.closest('[data-ctl]');
            if (c && c.tagName === 'BUTTON') { this.onControl(c.dataset.ctl, c.dataset.val); return; }
            const a = e.target.closest('[data-act]');
            if (a) { if (a.tagName === 'A') e.preventDefault(); this.onAction(a.dataset.act); }
        });
        document.addEventListener('change', (e) => {
            const c = e.target.closest('[data-ctl]');
            if (!c || c.tagName !== 'SELECT') return;
            this.onControl(c.dataset.ctl, c.value);
        });
        document.addEventListener('bm:product', (e) => this.onControl('product', e.detail));

        $('panel-close-btn').addEventListener('click', () => this.closeCountry());
        $('panel-export-btn').addEventListener('click', () => STATE.selectedCountry && CsvExport.country(STATE.selectedCountry));
        $('arc-modal-close').addEventListener('click', () => this.closeModal('arc-modal'));
        $('arc-export-btn').addEventListener('click', () => this._pair && CsvExport.pair(...this._pair));
        $('visibility-modal-close').addEventListener('click', () => this.closeModal('visibility-modal'));
        $('visibility-modal-backdrop').addEventListener('click', () => this.closeModal('visibility-modal'));
        $('methodology-btn').addEventListener('click', () => this.openModal('methodology-modal'));
        $('methodology-modal-close').addEventListener('click', () => this.closeModal('methodology-modal'));
        $('methodology-modal-backdrop').addEventListener('click', () => this.closeModal('methodology-modal'));
        // Tab stays inside an open modal
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const id = ['methodology-modal', 'visibility-modal'].find(k => !$(k).classList.contains('hidden')) || (this._choose ? 'choose' : null);
            if (!id) return;
            const f = [...$(id).querySelectorAll(id === 'choose' ? 'button:not([disabled]), select, input, a[href], [tabindex="0"]' : '.modal-card button, .modal-card select, .modal-card a[href], .modal-card [tabindex="0"]')].filter(x => x.offsetParent !== null);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            else if (!$(id).contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        });
        $('insight-panel').inert = true;
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (document.activeElement === $('search-input') && !$('search-list').classList.contains('hidden')) return;
            if (document.documentElement.classList.contains('menu-open')) { this.toggleMenu(false); return; }
            if (this._choose) {   // a dialog opened from the layer closes first, then the layer
                const m = ['visibility-modal', 'methodology-modal'].filter(id => !$(id).classList.contains('hidden'));
                if (m.length) m.forEach(id => this.closeModal(id)); else this.closeChoose();
                return;
            }
            if (isPhone() && $('map-footer').classList.contains('open')) { this.setNotes(false); $('foot-more').focus({ preventScroll: true }); return; }
            if (this._pop) { this.closePop(true); return; }
            const open = ['visibility-modal', 'methodology-modal'].filter(id => !$(id).classList.contains('hidden'));
            open.forEach(id => this.closeModal(id));
            if (open.length) return;
            if (!$('arc-modal').classList.contains('hidden')) { this.closeModal('arc-modal'); return; }
            if ($('insight-panel').classList.contains('open')) { this.closeCountry(); return; }
            if (this.layer === 'explore' && $('side').contains(document.activeElement) && !sheetMode()) { this.setSide(false); return; }
            if (Story.isOpen()) this.onAction('explore');
        });

        window.addEventListener('popstate', () => this.onPop());
        // footer notes: two lines at rest, all of them on request
        $('notes-btn').addEventListener('click', () => {
            const open = $('footer-notes').classList.toggle('clamp') === false;
            $('notes-btn').setAttribute('aria-expanded', String(open));
            $('notes-btn').textContent = open ? 'Fewer notes' : 'All notes';
        });
        $('kpi-inner').addEventListener('click', (e) => {
            if (!e.target.closest('#kpi-more-btn')) return;
            this._kpiMore = !this._kpiMore;
            this.renderKPI();
            $('kpi-more-btn')?.focus({ preventScroll: true });
        });

        // map / list / matrix events
        document.addEventListener('bm:country-click', (e) => this.openCountry(e.detail));
        document.addEventListener('bm:arc-click', (e) => this.openPair(e.detail.e, e.detail.i));
        // a tap sends an emulated mouseover: no hover tooltip then (it stayed over the map, on top of the sheet that
        // the same tap opened with the same figures; mobile M05). The last pointer's type is kept for hybrid devices.
        const pt = (e) => { this._pointer = e.pointerType; };
        document.addEventListener('pointerdown', pt, { capture: true, passive: true });
        document.addEventListener('pointermove', pt, { capture: true, passive: true });
        const touchHover = (ev) => !!(ev?.sourceCapabilities?.firesTouchEvents || this._pointer === 'touch' || this._pointer === 'pen' || matchMedia('(hover: none)').matches);
        document.addEventListener('bm:arc-hover', (e) => { if (!touchHover(e.detail.event)) this.tooltipFlow(e.detail.event, e.detail.flow); });
        document.addEventListener('bm:country-hover', (e) => { if (!touchHover(e.detail.event)) this.tooltipCountry(e.detail.event, e.detail.iso); });
        document.addEventListener('bm:matrix-hover', (e) => { if (!touchHover(e.detail.event)) this.showTooltip(e.detail.event, MatrixView.describe(e.detail.cell)); });
        document.addEventListener('bm:gap-hover', (e) => { if (!touchHover(e.detail.event)) this.showTooltip(e.detail.event, e.detail.html); });
        document.addEventListener('bm:hoverend', () => this.hideTooltip());
        // KPI definitions: a real tooltip on hover and keyboard focus
        const kpiTip = (e) => {
            const it = e.target.closest?.('.kpi-item[data-tip]');
            if (!it) return;
            const r = it.getBoundingClientRect();
            this.showTooltip({ clientX: r.left - 14, clientY: r.bottom - 8 }, `<div class="tt-title">${it.querySelector('.kpi-label').textContent}</div><div class="tt-note">${esc(it.dataset.tip)}</div>`);
        };
        $('kpi-inner').addEventListener('mouseover', kpiTip);
        $('kpi-inner').addEventListener('focusin', kpiTip);
        $('kpi-inner').addEventListener('mouseleave', () => this.hideTooltip());
        $('kpi-inner').addEventListener('focusout', () => this.hideTooltip());
        document.addEventListener('bm:highlight', (e) => { TradeMap.setHighlight(e.detail); CorridorList.render(); });
        document.addEventListener('bm:highlight-preview', (e) => TradeMap.setHighlight(e.detail));
        document.addEventListener('bm:background-click', () => {
            if (STATE.highlightPair) { STATE.highlightPair = null; TradeMap.setHighlight(null); CorridorList.render(); }
        });

        // map tools and legend
        $('fit-screen-btn').addEventListener('click', () => (isPhone() ? TradeMap.fitFlows() : TradeMap.zoomToRegion('Global')));
        $('zin').addEventListener('click', () => TradeMap.zoomBy(1.5));
        $('zout').addEventListener('click', () => TradeMap.zoomBy(1 / 1.5));
        const fold = (min) => {
            $('legend-panel').classList.toggle('min', min);
            $('legend-fold').setAttribute('aria-expanded', String(!min));
            $('legend-fold').setAttribute('aria-label', min ? 'Show the legend' : 'Fold the legend');
            $('legend-fold').innerHTML = min ? (isPhone() ? LEGEND_ICON : '+') : '&minus;';   // phone: a 44 px key button over the map
        };
        $('legend-fold').addEventListener('click', () => fold(!$('legend-panel').classList.contains('min')));
        $('legend-panel').querySelector('.lg-t').addEventListener('click', () => fold(false));
        // folded where the map is small (as in the Non-plastic dashboard)
        if (isPhone() || window.innerHeight < 760) fold(true);

        // phone: menu and tab bar
        $('btn-menu').addEventListener('click', () => this.toggleMenu(!document.documentElement.classList.contains('menu-open')));
        $('header-actions').addEventListener('click', (e) => { if (e.target.closest('button[data-act], button[data-mode]') && isPhone()) this.toggleMenu(false); });
        $('tabbar').addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            // a view chosen at the foot comes into sight: an open sheet goes down to its peek (it covered the
            // Two reports and Table views; 2026-11-06)
            if (b.dataset.view) { if (this._sheet && this._sheet !== 'peek') this.setSheet('peek'); this.onControl('view', b.dataset.view); }
        });

        window.addEventListener('resize', () => {
            clearTimeout(this._rt);
            this._rt = setTimeout(() => { if (Story.isOpen() || this.layer !== 'explore') { this._sized = false; return; } this.layoutStage(); TradeMap.init(); this.render(); }, 200);
        });
    },

    // ── Layers: #home, #q=<id>, #p=… (explorer), #story[=N]. Moves between layers add a history entry.
    explorerHash(extra = {}) {
        const p = new URLSearchParams({ p: STATE.product, y: STATE.year, m: STATE.metric, v: STATE.view, s: STATE.preset });
        if (STATE.region !== 'Global') p.set('r', STATE.region);
        if (STATE.topN !== CONFIG.topN.default) p.set('n', STATE.topN);
        if (STATE.basis === 'estimated') p.set('b', 'estimated');
        Object.entries(extra).forEach(([k, v]) => p.set(k, v));
        return '#' + p.toString();
    },

    // A change of layer as one View Transition (src/transitions.js, docs/design/MOTION_V6.md): the old page leaves,
    // the new one arrives (up when going deeper, down when coming back, sideways between questions); a question's
    // picture grows into its page's picture and back; the story's map becomes the explorer's map and back.
    // fn() makes the change; it may be async (the new page is held for a moment so it is shown with its content).
    // Before the app has finished loading (or with motion off) fn() just runs.
    layerSwap(to, fn, o = {}) {
        const from = this.layer;
        if (!this._booted || !from) return Promise.resolve(fn());
        const D = { home: 0, q: 1, story: 2, explore: 3 };
        const kind = D[to] > D[from] ? 'deeper' : D[to] < D[from] ? 'back' : 'page';
        let dir = 0;
        if (from === 'q' && to === 'q' && o.qFrom && o.qTo) {
            const n = QUESTIONS.length, a = QUESTIONS.findIndex(x => x.id === o.qFrom), b = QUESTIONS.findIndex(x => x.id === o.qTo);
            dir = (b - a + n) % n === 1 ? 1 : (a - b + n) % n === 1 ? -1 : 0;
        }
        // shared elements: named in the old state here, in the new state after fn() has built it
        const shared = from === 'home' && to === 'q' ? [`#qt-${o.qTo}`, '#qp-visual', 'q-visual']
            : from === 'q' && to === 'home' && o.qFrom ? ['#qp-visual', `#qt-${o.qFrom}`, 'q-visual']
                : from === 'story' && to === 'explore' ? ['#story-overlay .st-mapcell', '#map-area', 'map-stage']
                    : from === 'explore' && to === 'story' ? ['#map-area', '#story-overlay .st-mapcell', 'map-stage'] : null;
        if (shared) vtName(document.querySelector(shared[0]), shared[2]);
        return swap(() => {
            const r = fn();
            if (shared) vtName(document.querySelector(shared[1]), shared[2]);
            return r;
        }, { kind, dir, hold: to === 'explore' ? 120 : 260 });   // the explorer is ready at once: hold less (perf P2)
    },

    // ── Phones, Back (the user's D5): Back first closes what is open over the map, one thing per press: the Choose
    //    layer, then a flow, then the full sheet (it goes back to half or peek), then an economy. While anything is open,
    //    one history entry of our own (state.bmLayer) sits on top of the explorer's entry ("armed"). Back lands on the
    //    entry under it; onPop closes the top thing, keeps the rest of the view (product, year, ...) and writes it into
    //    that entry, and arms again if something is still open. A thing closed with its own button gives the entry back
    //    (history.back), so a later Back never seems to do nothing. The links (#p=…&c=…) are as before.
    openLayers() {
        const L = [];
        if (STATE.selectedCountry && $('insight-panel').classList.contains('open')) L.push('country');
        if (sheetMode() && this._sheet === 'full') L.push('full');
        if (!$('arc-modal').classList.contains('hidden')) L.push('pair');
        if (this._choose) L.push('choose');
        return L;   // the last is on top
    },
    closeTopLayer() {
        const top = this.openLayers().pop();
        if (top === 'choose') this.closeChoose();
        else if (top === 'pair') this.closeModal('arc-modal');
        else if (top === 'full') { this.setSheet(STATE.selectedCountry ? 'half' : 'peek'); this.frameSheet(); }
        else if (top === 'country') this.closeCountry();
        return !!top;
    },
    syncBack() {
        if (!isPhone() || this.layer !== 'explore' || !this._booted || this._popping) return;
        const open = this.openLayers().length > 0;
        if (open && !this._armed) { history.pushState({ bmLayer: 1 }, '', location.href); this._armed = true; }
        else if (!open && this._armed) {
            this._armed = false;
            if (history.state?.bmLayer) { this._skipPop = true; history.back(); }   // still on our entry: give it back
        }
    },
    onPop() {
        const st = history.state;
        if (this._skipPop) {   // our own history.back(): the view stays; the entry we are on gets it
            this._skipPop = false;
            this._armed = !!st?.bmLayer;
            Hash.write();
            return;
        }
        if (this._armed && !st?.bmLayer && this.layer === 'explore' && isPhone() && this.openLayers().length) {
            this._armed = false;
            this._popping = true;
            try { this.closeTopLayer(); } finally { this._popping = false; }
            Hash.write();      // the same view, without what was closed (a hashchange that may follow finds it routed)
            this.syncBack();   // something is still open: arm again for the next Back
            return;
        }
        this.route();
    },

    async route() {
        const hash = location.hash;
        if (hash === this._routed) return;
        this._routed = hash;
        this._armed = !!history.state?.bmLayer;   // a new link has no marker; a step back or forward may have ours
        const q = new URLSearchParams(hash.slice(1));
        if (q.has('story') || hash === '#story') {
            await this.layerSwap('story', () => {
                this.closeModals();
                Pages.hide();
                return Story.open(Math.max(0, parseInt(q.get('story') || '0', 10) || 0));
            });
            return;
        }
        if (q.get('p')) {
            const away = Story.isOpen() || Pages.isOpen();
            const h = Hash.read();
            await this.layerSwap('explore', async () => {
                if (Story.isOpen()) Story.close();
                Pages.hide();
                if (!h.basis) h.basis = 'reported';
                this._fromQ = h.fromQ && Pages.has(h.fromQ) ? h.fromQ : null;
                this.closeModals();
                this.applyState(h, false);
                this.renderBasis();
                this.renderControls();
                if (away) { this._sized = false; }
                this.afterStory();
                await this.update();
            });
            if (h.country) this.openCountry(h.country); else if (STATE.selectedCountry) this.closeCountry();
            if (h.hs) this.openVisibility();
            else if (away) $('map-area').focus({ preventScroll: true });
            return;
        }
        const id = q.get('q');
        const qFrom = this.layer === 'q' ? Pages.cur : this.layer === 'explore' ? this._fromQ : null;
        if (id && Pages.has(id)) {
            await this.layerSwap('q', async () => {
                if (Story.isOpen()) Story.close();
                this.closeModals();
                this.toggleMenu(false);
                this.setLayer('q', id);
                await Pages.showQuestion(id, { pr: q.get('pr'), me: q.get('me') });
                this.setLayer('q', id);
            }, { qFrom, qTo: id });
            $('q-h')?.focus({ preventScroll: true });
        } else {
            await this.layerSwap('home', async () => {
                if (Story.isOpen()) Story.close();
                this.closeModals();
                this.toggleMenu(false);
                this.setLayer('home');
                await Pages.showHome(this.explorerHash());
            }, { qFrom });
            $('home-h')?.focus({ preventScroll: true });
        }
    },

    // The layer that is on: what is inert, the breadcrumb, the page title, the header links
    setLayer(layer, qid) {
        this.layer = layer;
        document.body.dataset.layer = layer;
        if (layer !== 'explore') {   // a phone leaves the explorer: nothing of it stays open, and Back is the page's again
            this.closeChoose(false);
            if ($('map-footer').classList.contains('open')) this.setNotes(false);
            this._armed = false;
        }
        const inert = layer !== 'explore';
        ['main', '#kpi-bar', '#map-footer', '#tabbar'].forEach(s => { const e = document.querySelector(s); if (e) e.inert = inert; });
        const qq = QUESTIONS.find(x => x.id === (layer === 'q' ? (qid || Pages.cur) : this._fromQ));
        const parts = [];
        if (layer !== 'home') parts.push(['Home', '#home']);
        if (layer === 'q' && qq) parts.push([qq.title, null]);
        if (layer === 'explore') { if (qq) parts.push([qq.title, `#q=${qq.id}`]); parts.push(['Explore the data', null]); }
        if (layer === 'story') parts.push(['Guided story', null]);
        $('crumbs').innerHTML = parts.map(([t, h]) => (h ? `<a href="${h}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`)).join('<span class="sep" aria-hidden="true">\u203a</span>');
        $('crumbs').classList.toggle('hidden', layer === 'home');
        const name = { q: qq?.title, explore: 'Explore the data', story: 'Guided story' }[layer];
        document.title = `${name ? `${name} \u2014 ` : ''}Global Battery Trade Monitor`;
        if (layer === 'explore') this.showFirstHint();   // on any way into the explorer, once
        const pr = $('page-return');
        pr.classList.toggle('hidden', !(layer === 'explore' && qq));
        if (layer === 'explore' && qq) { pr.setAttribute('href', `#q=${qq.id}`); pr.innerHTML = `<span aria-hidden="true">&larr;</span> ${esc(qq.title)}`; }
        this.syncMode();
    },

    // Search: from the entry or a question page, open the economy in the explorer (a new history entry)
    exploreEconomy(iso) {
        if (!STATE.eco[iso]) return;
        if (this.layer !== 'explore') { location.hash = this.explorerHash({ c: iso }); return; }
        this.openCountry(iso);
    },

    toggleMenu(open) {
        document.documentElement.classList.toggle('menu-open', open);
        $('btn-menu').setAttribute('aria-expanded', String(open));
    },

    // ── Find an economy: a suggestion list under the field (arrows, Enter, Escape)
    bindSearch(inputId, listId) {
        const input = $(inputId), list = $(listId);
        if (!input || input.dataset.bound) return;
        input.dataset.bound = '1';
        let items = [], at = -1;
        const close = () => { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); at = -1; };
        const draw = () => {
            const q = input.value.trim().toLowerCase();
            if (!q) { close(); return; }
            items = Object.values(STATE.eco).filter(e => e.name.toLowerCase().includes(q) || e.iso.toLowerCase() === q)
                .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name)).slice(0, 10);
            at = items.length ? 0 : -1;
            list.innerHTML = items.length ? items.map((e, k) => `<li role="option" id="${listId}-${k}" data-iso="${e.iso}" class="${k === at ? 'on' : ''}" aria-selected="${k === at}">${esc(e.name)} <small>${e.iso}</small></li>`).join('')
                : '<li class="none" role="option" aria-disabled="true">No economy of that name</li>';
            list.classList.remove('hidden');
            input.setAttribute('aria-expanded', 'true');
            if (at >= 0) input.setAttribute('aria-activedescendant', `${listId}-${at}`);
        };
        const mark = () => {
            list.querySelectorAll('li[data-iso]').forEach((li, k) => { li.classList.toggle('on', k === at); li.setAttribute('aria-selected', String(k === at)); });
            if (at >= 0) input.setAttribute('aria-activedescendant', `${listId}-${at}`);
        };
        const pick = (iso) => { input.value = ''; close(); this.toggleMenu(false); this.exploreEconomy(iso); };
        input.addEventListener('input', draw);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); at = Math.min(items.length - 1, at + 1); mark(); }
            else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); at = Math.max(0, at - 1); mark(); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                const v = input.value.trim().toLowerCase();
                const exact = Object.values(STATE.eco).find(x => x.name.toLowerCase() === v || x.iso.toLowerCase() === v);
                if (exact) pick(exact.iso); else if (at >= 0 && items[at]) pick(items[at].iso);
            } else if (e.key === 'Escape') { if (!list.classList.contains('hidden')) { e.preventDefault(); close(); } }
        });
        list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-iso]'); if (li) { e.preventDefault(); pick(li.dataset.iso); } });
        input.addEventListener('blur', () => setTimeout(close, 120));
        // phone, on the entry: the field (with its label) moves to the top of the page, above the keyboard, with room
        // under it for the list (mobile M10; #pages.search-open in src/styles/mobile.css)
        const pages = input.closest('#pages');
        if (pages) {
            input.addEventListener('focus', () => {
                if (!isPhone()) return;
                pages.classList.add('search-open');
                setTimeout(() => { if (document.activeElement === input) (input.closest('.pg-find') || input).scrollIntoView({ block: 'start', behavior: motionOn() ? 'smooth' : 'auto' }); }, 250);
            });
            input.addEventListener('blur', () => setTimeout(() => pages.classList.remove('search-open'), 200));
        }
    },

    // Where the focus is, described so that it can be found again after a re-render
    focusKey() {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        const box = a.closest('#meas, #menu-meas, #view-tabs, #group-tabs, #slice-list, #basis-switch, #corridor-list, #legend-content, #gap-container, #menu-topn, #tabbar');   // the time line keeps its own focus
        if (!box) return null;
        const sel = a.dataset.view ? `[data-view="${a.dataset.view}"]` : a.dataset.ctl ? `[data-ctl="${a.dataset.ctl}"]${a.dataset.val != null ? `[data-val="${a.dataset.val}"]` : ''}`
            : a.dataset.act ? `[data-act="${a.dataset.act}"]` : a.dataset.gsort ? `[data-gsort="${a.dataset.gsort}"]` : a.dataset.fc ? `[data-fc="${a.dataset.fc}"]` : null;
        return sel ? { box: box.id, sel } : null;
    },
    restoreFocus(k) {
        if (!k) return;
        const el = document.querySelector(`#${k.box} ${k.sel}`);
        if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    },

    async onControl(ctl, val) {
        const fk = this.focusKey();
        await this._onControl(ctl, val);
        if (ctl === 'product' || ctl === 'group') await ProductDock._p;
        this.restoreFocus(fk);
    },

    async _onControl(ctl, val) {
        const prevPreset = STATE.preset;
        switch (ctl) {
            case 'group': {
                const g = STATE.products.groups[val];
                if (!g || DataLoader.product().group === val) return;
                this.applyState({ product: g.default });
                break;
            }
            case 'product': if (val === STATE.product) return; this.applyState({ product: val }); break;
            case 'year': if (+val === STATE.year) return; this.applyState({ year: +val }); break;
            case 'metric': this.applyState({ metric: val }); break;
            case 'view': {
                // views crossfade: the view that leaves fades where it is (150 ms) while the new one fades in
                // (260 ms). Only the two containers are painted again (perf review P2: a View Transition captured the
                // whole page twice). The map, matrix, two reports and table are different pictures of the same flows,
                // so nothing morphs between them.
                if (val === STATE.view) return;
                Timeline.stop();
                STATE.highlightPair = null;
                TradeMap.setHighlight(null);
                const pane = v => $({ map: 'map-container', matrix: 'matrix-container', gap: 'gap-container', table: 'table-container' }[v]);
                const old = pane(STATE.view);
                this._viewLeave?.();
                this._viewLeave = old ? leave(old, { ms: MS.micro, rect: { left: old.offsetLeft, top: old.offsetTop, width: old.offsetWidth, height: old.offsetHeight } }) : null;
                this.applyState({ view: val });
                this.renderControls();
                await this.update();
                if (isPhone()) this.layoutStage();   // the notes strip has no map disclaimer outside the map (mobile M18)
                enter(pane(val), { y: 0, ms: MS.ui });
                return;
            }
            case 'scope': {
                // one select for the presets and the region filter (spec 7.1); URL keys s and r as before
                if (String(val).startsWith('R:')) { this.applyState({ preset: 'GLOBAL', region: val.slice(2) }); STATE.region = val.slice(2); }
                else { this.applyState({ preset: val }); STATE.region = 'Global'; }
                // Japan-ASEAN-India opens in the matrix (spec 7.1); others in the map.
                if (STATE.preset !== prevPreset) STATE.view = STATE.meta.presets[STATE.preset].default_view || 'map';
                TradeMap.zoomToRegion(STATE.region);
                break;
            }
            case 'preset':
                this.applyState({ preset: val });
                if (val !== prevPreset) STATE.view = STATE.meta.presets[val].default_view || 'map';
                break;
            case 'region':
                this.applyState({ region: val });
                TradeMap.zoomToRegion(val);
                break;
            case 'topn': this.applyState({ topN: +val }); break;
            case 'basis':
                if (val === STATE.basis) return;
                this.applyState({ basis: val });
                this.renderBasis();
                break;
            default: return;
        }
        if (ctl !== 'year') Timeline.stop();
        STATE.highlightPair = null;
        TradeMap.setHighlight(null);
        this.renderControls();
        await this.update();
    },

    onAction(act) {
        if (act === 'visibility') this.openVisibility();
        else if (act === 'stories') {
            this.closeModals();
            if (!Story.isOpen()) { history.pushState(null, '', Story.active > 0 ? `#story=${Story.active}` : '#story'); this._routed = location.hash; }
            this.layerSwap('story', () => { Pages.hide(); return Story.open(); });
        }
        else if (act === 'home') { if (this.layer !== 'home') { location.hash = '#home'; } }
        else if (act === 'explore') {
            const away = Story.isOpen() || Pages.isOpen();
            if (away) history.pushState(null, '', this.explorerHash());   // Back returns to the story chapter or the page
            this.layerSwap('explore', () => {
                Story.close(); Pages.hide();
                this._sized = false;
                this.afterStory();
            }).then(() => $('map-area').focus({ preventScroll: true }));
        }
        else if (act === 'methodology') { this.openModal('methodology-modal'); }
        else if (act === 'csv-flows') CsvExport.viewFlows();
        else if (act === 'csv-totals') CsvExport.countryTotals();
        else if (act === 'copy-link') this.copyLink();
        else if (act === 'copy-link-menu') this.copyLink(document.querySelector('[data-act="copy-link-menu"]'));
        else if (act === 'csv-country') { if (STATE.selectedCountry) CsvExport.country(STATE.selectedCountry); }
        else if (act === 'csv-pair') { if (this._pair) CsvExport.pair(...this._pair); }
        else if (act === 'reset') this.reset();
    },

    async copyLink(b = document.querySelector('[data-act="copy-link"]')) {
        try { await navigator.clipboard.writeText(location.href); b.textContent = 'Link copied'; }
        catch { b.textContent = 'Could not copy: copy the link from the address bar'; }
        clearTimeout(this._ct);
        this._ct = setTimeout(() => { b.textContent = 'Copy link'; }, 1800);
    },

    async reset() {
        this.closePop(false);
        this.closeModal('arc-modal');
        this.closeCountry(false);
        Object.assign(STATE, { product: CONFIG.defaults.product, year: CONFIG.defaults.year, metric: CONFIG.defaults.metric, view: CONFIG.defaults.view,
            preset: CONFIG.defaults.preset, region: 'Global', topN: CONFIG.topN.default, basis: 'reported', highlightPair: null });
        STATE.flowFilters = new Set(Object.keys(CONFIG.flowColors));
        TradeMap.setHighlight(null);
        TradeMap.zoomToRegion('Global');
        this.renderBasis();
        this.renderControls();
        await this.update();
    },

    // First entry into the explorer from the story: one line on how to read the map
    showHandoverHint() {
        if (this._hinted || STATE.view !== 'map') return;
        this._hinted = true;
        const el = document.createElement('div');
        el.className = 'handover-hint';
        $('first-hint')?.remove();
        el.setAttribute('role', 'status');
        el.innerHTML = 'Colour = flow category · dashed = † importer’s report · click a flow for both reports <button type="button" aria-label="Close">×</button>';
        $('map-body').appendChild(el);
        const done = () => { el.classList.add('out'); setTimeout(() => el.remove(), 400); };
        el.querySelector('button').addEventListener('click', done);
        setTimeout(done, 9000);
    },

    closeModals() {
        ['visibility-modal', 'methodology-modal'].forEach(id => $(id).classList.add('hidden'));
        if (!$('arc-modal').classList.contains('hidden')) { $('arc-modal').classList.add('hidden'); $('side').classList.remove('has-pair'); }
    },

    openModal(id) {
        const m = $(id);
        if (m.classList.contains('hidden')) this._modalReturn = document.activeElement;
        if (m.classList.contains('hidden')) enter(id === 'arc-modal' ? m : m.querySelector('.modal-card'), { y: id === 'arc-modal' ? 4 : 8 });   // arrives, does not pop
        m.classList.remove('hidden');
        if (id === 'arc-modal') {
            // the pair history opens in the details panel (v4): not modal, the map stays usable
            $('side').classList.add('has-pair');
            this.setSide(true);
            if (sheetMode() && this._sheet === 'peek') this.setSheet('half');
            this.frameSheet();   // phone: the flow's two ends in the part of the map above the sheet
            $('side-body').scrollTop = 0;
            $('arc-modal-close').focus({ preventScroll: true });
            this.syncBack();
            return;
        }
        const card = m.querySelector('.modal-card');
        card.setAttribute('aria-modal', 'true');
        // Methodology is reading text: focus its scrollable body, so PageDown / arrows scroll at once
        const first = id === 'methodology-modal' ? m.querySelector('.modal-body[tabindex="0"]') : card.querySelector('.btn-close');
        (first || card).focus({ preventScroll: true });
    },
    closeModal(id, reframe = true) {
        const m = $(id);
        if (m.classList.contains('hidden')) return;
        m.classList.add('hidden');
        if (id === 'arc-modal') {
            $('side').classList.remove('has-pair'); $('menu-csv-pair').disabled = true; $('side-k').textContent = STATE.selectedCountry ? 'Economy' : 'Summary';
            (STATE.selectedCountry ? ['insight-panel'] : ['world-panel', 'kpi-bar', 'corridor-list']).forEach((x, k) => enter($(x), { y: 4, delay: k * 30 }));   // what was there comes back
            this.renderPeek();
            // phone: a flow chosen on its own gives the map back (peek); with an economy the sheet stays at half
            if (reframe && sheetMode()) { if (!STATE.selectedCountry && this._sheet === 'half') this.setSheet('peek'); this.frameSheet(); }
            this.syncBack();
        }
        let r = this._modalReturn;
        this._modalReturn = null;
        // the row may have been drawn again while the dialog was open: find the same row
        if (r && !document.contains(r) && r.dataset?.pair) r = document.querySelector(`[data-pair="${r.dataset.pair}"]`);
        if (r && !document.contains(r) && r.dataset?.key) r = document.querySelector(`.cl-row[data-key="${r.dataset.key}"] .cl-main`);
        if (r && !document.contains(r) && r.dataset?.detail) r = document.querySelector(`.cl-row[data-key="${r.dataset.detail}"] .cl-more`);
        if (r && document.contains(r) && r.offsetParent !== null) r.focus({ preventScroll: true });
    },

    // The explorer was hidden behind the story: measure the map again.
    afterStory() {
        this.setLayer('explore');
        Hash.write();
        this.syncMode();
        if (this._sized) return;
        this._sized = true;
        this.layoutStage();
        TradeMap.init();
        this.render();
        this.showFirstHint();
    },

    async showFromCard(show) {
        this._sized = true;
        this._fromQ = null;
        this.setLayer('explore');
        this.layoutStage();   // the stage is not measured behind the story (mobile M14)
        this.syncMode();
        if (show.visibility) { TradeMap.init(); this.render(); this.openVisibility({ scope: show.scope, flow: show.flow }); return; }
        this.closeCountry(false);
        this.applyState(show, false);
        this.renderControls();
        // the story map and the explorer map are the same flat projection: the story's map cell grows into the
        // explorer's map (Story calls this inside App.layerSwap, docs/design/MOTION_V6.md)
        TradeMap.init();
        TradeMap.zoomToRegion('Global');
        await this.update();
        if (show.country) this.openCountry(show.country);
        this.showHandoverHint();
    },

    // ── Data + render ───────────────────────────────────────────────
    async update() {
        const seq = ++this._seq;
        const flows = await DataLoader.loadFlows(STATE.product, STATE.year);
        const summary = await DataLoader.loadSummary(STATE.product);
        if (seq !== this._seq) return; // a newer update superseded this one
        this._flows = flows;
        this._summary = summary;
        DataLoader.filterData(flows);
        this.render();
        Hash.write();
        if (STATE.selectedCountry && $('insight-panel').classList.contains('open')) this.fillCountry(STATE.selectedCountry);
    },

    render() {
        const isMatrix = STATE.view === 'matrix', isGap = STATE.view === 'gap', isMap = STATE.view === 'map', isTable = STATE.view === 'table';
        $('map-container').classList.toggle('hidden', !isMap);
        $('matrix-container').classList.toggle('hidden', !isMatrix);
        $('gap-container').classList.toggle('hidden', !isGap);
        $('table-container').classList.toggle('hidden', !isTable);
        document.body.classList.toggle('view-matrix', isMatrix);
        document.body.classList.toggle('view-gap', isGap);
        document.body.dataset.view = STATE.view;
        document.documentElement.dataset.view = STATE.view;
        // Weight-flagged economies are hatched on the map (spec 5.4)
        const flagged = new Set();
        if (STATE.metric === 'weight') {
            Object.entries(this._summary?.economies || {}).forEach(([iso, ys]) => {
                const r = ys[String(STATE.year)];
                if (r && (r.xflag || r.mflag)) flagged.add(iso);
            });
        }
        TradeMap.setFlagged(flagged);
        // Economies that did not report for the year: "no data" hatch on the land
        TradeMap.setNoData(new Set(Object.keys(STATE.eco).filter(iso => !(STATE.meta.reporting[iso]?.[String(STATE.year)] || '').length)));
        const viewChanged = this._lastView !== STATE.view;
        this._lastView = STATE.view;
        if (isMatrix) {
            MatrixView.render(this._flows || []);
        } else if (isGap) {
            GapView.render();
        } else if (isTable) {
            TableView.render();
        } else if (this.layer === 'explore') {   // behind another layer the map waits (afterStory draws it on entry)
            // The map container was hidden (matrix view) or never measured: re-measure it.
            if (!TradeMap.width || viewChanged) TradeMap.init();
            TradeMap.renderFlows();
            const fk = `${STATE.product}|${STATE.year}|${STATE.metric}|${STATE.preset}|${STATE.topN}`;
            if (isPhone() && !STATE.selectedCountry && this._fitKey !== fk) { this._fitKey = fk; TradeMap.fitFlows(); }
        }
        CorridorList.render();
        this.renderWorldPanel();
        this.renderScopeChip();
        this.renderCtlLabels();
        this.renderKPI();
        this.renderBasis();
        this.renderStatus();
        this.renderLegend();
        this.renderFooter();
        if (this._pop === 'year') Timeline.render(this._summary);
        else { Timeline._last = this._summary; $('year-out').textContent = STATE.year; $('year-prov').textContent = isProvisional(STATE.year) ? 'provisional' : ''; }
        if (this._pop === 'eco') this.renderEcoList();
    },

    // Details panel, no economy selected: what is shown, then the ranked flows (CorridorList)
    renderWorldPanel() {
        const p = DataLoader.product();
        const scope = STATE.preset !== 'GLOBAL' ? STATE.meta.presets[STATE.preset].label : STATE.region !== 'Global' ? `${STATE.region} (both ends in the region)` : 'All economies';
        $('world-panel').innerHTML = `<h2>${esc(p.label)}</h2>
            <p class="sub">${esc(scope)} &middot; ${STATE.year}${isProvisional(STATE.year) ? ' <span class="prov">(provisional)</span>' : ''} &middot; ${METRIC_FORMAT[STATE.metric].label.toLowerCase()} &middot; HS ${esc(hsShow(p.hs))}</p>
            <p class="side-hint">Select an economy on the map, or a flow below, for its details.</p>`;
        $('side-k').textContent = !$('arc-modal').classList.contains('hidden') ? 'Flow' : STATE.selectedCountry ? 'Economy' : 'Summary';
        this.renderPeek();
    },

    // Phone: the sheet's head says in one line what the sheet holds (v8: at peek the sheet is its handle and this line)
    renderPeek() {
        const el = $('side-line');
        if (!el) return;
        const y = String(STATE.year), isW = STATE.metric === 'weight';
        let html;
        if (!$('arc-modal').classList.contains('hidden') && this._pair) {
            html = `<b>${esc(nm(this._pair[0]))} ⇄ ${esc(nm(this._pair[1]))}</b> · both reports by year`;
        } else if (STATE.selectedCountry) {
            const r = this._summary?.economies?.[STATE.selectedCountry]?.[y] || {};
            const v = k => (!r[k + 's'] || r[k + 's'] === 'none' ? null : (isW ? r[k + 'w'] : r[k]));
            const parts = [['imports', v('m'), r.ms], ['exports', v('x'), r.xs]].filter(p => p[1] != null).sort((a, b) => b[1] - a[1])
                .map(([l, val, st]) => `${l} ${fmtMetric(val)}${st === 'mirror' ? '†' : ''}`);
            html = `<b>${esc(nm(STATE.selectedCountry))}</b> · ${parts.length ? parts.join(' · ') : `no report for ${y}`}`;
        } else {
            const w = this._summary?.world?.[y] || {};
            const wE = DataLoader.estActive() ? (isW ? w.xwe : w.xe) : null;
            const tot = wE != null ? `≈${fmtMetric(wE)} (est.)` : (isW ? w.xw : w.x) != null ? fmtMetric(isW ? w.xw : w.x) : '';
            html = `<b>Summary</b>${tot ? ` · world exports ${tot}` : ''}`;
        }
        if (el.innerHTML !== html) el.innerHTML = html;
    },

    renderScopeChip() {
        const el = $('scope-chip');
        const iso = STATE.selectedCountry;
        el.classList.toggle('hidden', !iso);
        if (!iso) { el.innerHTML = ''; return; }
        el.innerHTML = `<button class="btn-x" type="button" aria-label="Close ${esc(nm(iso))}" title="Back to all economies"><span class="sr-only">${esc(nm(iso))}</span>&times;</button>`;
        el.querySelector('button').onclick = () => this.closeCountry();
    },

    renderKPI() {
        const y = String(STATE.year);
        const w = this._summary?.world?.[y] || {};
        const isW = STATE.metric === 'weight';
        const val = d => DataLoader.val(d);
        const scopeTot = d3.sum(STATE.scopeFlows, d => val(d) || 0);
        const shown = d3.sum(STATE.filteredData, val);
        const dagShown = d3.sum(STATE.filteredData.filter(d => d.src === 'm'), val);
        const members = DataLoader.presetMembers();
        const ecos = this._summary?.economies || {};
        const top = (k) => {
            let best = null;
            Object.entries(ecos).forEach(([iso, ys]) => {
                if (members && !members.includes(iso)) return;
                const r = ys[y];
                if (!r || r[k + 's'] !== 'own') return;           // own reports only (spec 7.4)
                if (isW && r[k + 'flag']) return;                  // flagged weights left out of rankings
                const v = isW ? r[k + 'w'] : r[k];
                if (v > 0 && (!best || v > best[1])) best = [iso, v];
            });
            return best;
        };
        const tx = top('x'), tm = top('m');
        const p = DataLoader.product();
        const scopeName = STATE.selectedCountry ? nm(STATE.selectedCountry)
            : STATE.preset !== 'GLOBAL' ? STATE.meta.presets[STATE.preset].label
                : STATE.region !== 'Global' ? `${STATE.region} (both ends)` : 'Global';
        const excl = isW ? (w.xw_excl || 0) : 0;
        const est = DataLoader.estActive();                         // estimated mode AND estimates exist for this measure
        const noEstForMeasure = STATE.basis === 'estimated' && !est;
        const estShown = est ? d3.sum(STATE.filteredData.filter(d => DataLoader.isEst(d)), val) : 0;
        const estScope = est ? d3.sum(STATE.scopeFlows.filter(d => DataLoader.isEst(d)), d => val(d) || 0) : 0;
        const wE = est ? (isW ? w.xwe : w.xe) : null;
        const wEdiff = wE != null && Math.abs(wE - (isW ? w.xw : w.x)) > 0.5;
        const ap = on => (on ? '≈' : '');                          // "≈" only when the total includes an estimate
        const items = [
            est && wE != null
                ? ['World exports (est.)', `${ap(wEdiff)}${fmtMetric(wE)}${wEdiff ? ` <span class="kpi-sub">reported ${fmtMetric(isW ? w.xw : w.x)}</span>` : ''}`,
                    isW ? `Reporters’ own export weights for ${y}, with weights that failed quality checks replaced and missing weights filled (experimental estimates), so the total can be lower or higher than the reported one. See Methodology.`
                        : `Reporters’ own export reports plus experimental estimates for ${w.nxe ?? 'the'} economies that did not report (${y}). See Methodology.`, true]
                : ['World exports (reporters’ totals)', fmtMetric(isW ? w.xw : w.x), `Sum of the reporting economies’ own export reports for ${y}${excl ? `; ${excl} economies with weights flagged as unreliable left out` : ''}. Flows marked † are not added.`, true],
            ['All flows in this selection (incl. †)', `${ap(estScope > 0)}${fmtMetric(scopeTot)}`, 'Sum of the directed flows in this selection: the exporter’s report, or the importer’s (†) where the exporter did not report. It is not the same as World exports, the reporting economies’ own totals: it includes importers’ reports and leaves out flows without a weight and partners not specified.'],
            [`Shown on the map (top ${STATE.filteredData.length})`, STATE.filteredData.length ? `${ap(estShown > 0)}${fmtMetric(shown)} <span class="kpi-sub">${scopeTot ? Math.round(100 * shown / scopeTot) : 0}%</span>` : '—', 'Flows drawn on the map and listed at the side'],
            ['Importers’ reports (†)', shown ? fpct(dagShown / shown) : '—', 'Share of the flows shown that come from importers’ reports (†), used where the exporter did not report for the year.', false, true],
            ...(est ? [['Estimated share', shown ? `${(100 * estShown / shown).toFixed(1)}%` : '—', 'Share of the shown flows that are experimental estimates (marked est.; dotted on the map)', false, true]] : []),
            ...(noEstForMeasure ? [['Estimates', `<span class="kpi-none">None for ${STATE.metric}</span>`, `No ${STATE.metric} estimates in this build; ${isW ? 'weights' : 'values'} are as reported.`, false, true]] : []),
            ['Reporters', `${w.nx ?? '—'}`, `Economies that reported exports for ${y} (imports: ${w.nm ?? '—'})`, false, true],
            [`Largest exporter${members ? ' (in group)' : ''}`, tx ? esc(nm(tx[0])) : '—', 'Largest exporter by its own report', false, true],
            [`Largest importer${members ? ' (in group)' : ''}`, tm ? esc(nm(tm[0])) : '—', 'Largest importer by its own report', false, true],
        ];
        const ctx = `<div class="kpi-ctx"><b title="${esc(p.label)}">${esc(shortLabel(p.id))}</b><span>${esc(scopeName)} &middot; ${y}${isProvisional(y) ? ' <span class="prov">provisional</span>' : ''}</span></div>`;
        const tile = ([l, v, t, lead]) => `<div class="kpi-divider"></div><div class="kpi-item${lead ? ' kpi-lead' : ''}" data-tip="${esc(t)}" tabindex="0" aria-label="${esc(l)}: ${esc(String(v).replace(/<[^>]+>/g, ' '))}. ${esc(t)}"><span class="kpi-label">${l}</span><span class="kpi-value">${v}</span></div>`;
        const more = !!this._kpiMore;
        void ctx;
        $('kpi-inner').innerHTML = items.filter(i => !i[4]).map(tile).join('')
            + `<span class="kpi-extra" id="kpi-extra" ${more ? '' : 'hidden'}>${items.filter(i => i[4]).map(tile).join('')}</span>`
            + `<button class="btn-line kpi-more-btn" id="kpi-more-btn" type="button" aria-expanded="${more}" aria-controls="kpi-extra">${more ? 'Fewer figures' : 'More figures'}</button>`;
        // a figure that changed settles into place (the text is final at once; only its opacity and 3 px move)
        const was = this._kpiVals || {}, now = {};
        $('kpi-inner').querySelectorAll('.kpi-item').forEach(it => {
            const l = it.querySelector('.kpi-label').textContent, v = it.querySelector('.kpi-value');
            now[l] = v.textContent;
            if (was[l] != null && was[l] !== now[l]) enter(v, { y: 3, from: 0.15, ms: MS.ui });
        });
        this._kpiVals = now;
    },

    renderLegend() {
        const isMatrix = STATE.view === 'matrix';
        const cats = Object.keys(CONFIG.flowColors).map(k => {
            const on = STATE.flowFilters.has(k);
            return `<button class="legend-flow-item lg-chip ${on ? '' : 'off'}" data-fc="${k}" type="button" title="Show or hide" aria-pressed="${on}">
                <span class="legend-flow-dot fc-bg-${k}"></span><span class="legend-flow-label">${CONFIG.flowShort[k]}</span></button>`;
        }).join('');
        const lines = CONFIG.topN.options.map(n => `<button class="btn-toggle ${STATE.topN === n ? 'active' : ''}" data-ctl="topn" data-val="${n}" type="button" aria-pressed="${STATE.topN === n}">${n}</button>`).join('');
        const est = STATE.basis === 'estimated';
        document.body.classList.toggle('legend-empty', isMatrix || STATE.view === 'gap');   // the two reports view has its own key and row tabs
        $('legend-content').innerHTML = isMatrix
            ? ''
            : STATE.view === 'gap'
                ? `<div class="legend-section"><span class="legend-section-label">Flows (exporter → importer)</span><div class="legend-flows">${cats}</div></div>
                   <div class="legend-section"><span class="legend-section-label">Rows</span><div class="tb-seg">${lines}</div></div>`
                : `<div class="legend-section"><span class="legend-section-label">Flows, exporter → importer</span><div class="legend-flows">${cats}</div></div>
               <div class="legend-section lg-keys">
                 <span class="lg-key"><span class="lg-solid"></span><span class="lg-text">Exporter’s report</span></span>
                 <span class="lg-key"><span class="lg-dash"></span><span class="lg-text"><span class="lg-dag">†</span> Importer’s report</span></span>
                 ${est ? '<span class="lg-key"><span class="lg-dot"></span><span class="lg-text">Experimental estimate</span></span>' : ''}
                 <span class="lg-key"><span class="lg-node exp"></span><span class="lg-node imp"></span><span class="lg-text">Circle size = trade; net exporter, net importer</span></span>
                 ${STATE.metric === 'weight' ? '<span class="lg-key"><span class="lg-flag"></span><span class="lg-text">Weight flagged as unreliable</span></span>' : ''}
                 <span class="lg-key"><span class="lg-hatch"></span><span class="lg-text">No data for ${STATE.year}</span></span>
               </div>`;
        $('legend-content').querySelectorAll('[data-fc]').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.fc;
            if (STATE.flowFilters.has(k)) STATE.flowFilters.delete(k); else STATE.flowFilters.add(k);
            DataLoader.filterData(this._flows || []);
            const fk = this.focusKey();
            this.render();
            this.restoreFocus(fk);
        }));
    },

    // One line on what is on screen, announced to screen readers
    renderStatus() {
        const p = DataLoader.product();
        const view = { map: 'Map', matrix: 'Matrix', gap: 'Two reports' }[STATE.view] || STATE.view;
        const scope = STATE.selectedCountry ? nm(STATE.selectedCountry) : STATE.preset === 'GLOBAL' ? (STATE.region !== 'Global' ? STATE.region : 'All economies') : STATE.meta.presets[STATE.preset]?.label || 'All economies';
        const yr = `${STATE.year}${isProvisional(STATE.year) ? ' (provisional)' : ''}`;
        const txt = `${p.label}, ${yr}, ${METRIC_FORMAT[STATE.metric].label.toLowerCase()}, ${view}, ${scope}${STATE.basis === 'estimated' ? ', with experimental estimates' : ''}.`;
        if (txt !== this._lastStatus) { this._lastStatus = txt; $('sr-status').textContent = txt; }
    },

    renderFooter() {
        const bi = STATE.buildInfo;
        $('footer-source').innerHTML = `<strong>Source:</strong> UN Comtrade; UNCTAD calculations. Data extracted from UN Comtrade on ${esc(longDate(bi.extracted))}.`;
        const p = DataLoader.product();
        const notes = [
            `${esc(p.label)}.`,
            isProvisional(STATE.year) ? `${STATE.year} data are provisional (ᵖ).` : '',
            `Each flow is the exporter’s report; † = reported by the importer because the exporter did not report for the year.`,
            STATE.metric === 'weight' ? 't = tonnes; kt = thousand tonnes; Mt = million tonnes.' : '',
            DataLoader.basisSentence(),
            p.group === 'BAT' ? 'HS 8507 covers new and used batteries (used batteries that can still be used or recharged are not "spent").' : '',
            p.id === 'SPENT_13' ? 'HS 8549.13 is not a lithium-ion code: it covers all spent batteries sorted by chemical type and not containing lead, cadmium or mercury.' : '',
            DataLoader.estActive() ? '<b>Estimated values are shown:</b> flows marked est. (dotted on the map) are experimental estimates with 90% intervals, kept apart from the reported data; see Methodology.' : '',
        ].filter(Boolean);
        $('footer-notes').innerHTML = notes.join(' ');
        // a marker on the chart itself, so a screenshot keeps the basis
        const eb = $('map-estbadge');
        const on = STATE.basis === 'estimated';
        eb.classList.toggle('hidden', !on);
        eb.textContent = on ? (DataLoader.estActive() ? 'Includes experimental estimates (est.) — not official statistics' : `Estimated view: no ${STATE.metric} estimates in this build; ${STATE.metric === 'weight' ? 'weights' : 'values'} as reported`) : '';
    },

    // ── Tooltips (fixed to the window) ───────────────────────────────
    // mousemove fires this for every pixel: the text and its size are set/measured only when the text changes.
    showTooltip(event, html) {
        const t = $('tooltip');
        if (this._ttHtml !== html || t.style.display !== 'block') {
            t.innerHTML = html;
            t.style.display = 'block';
            const r = t.getBoundingClientRect();
            this._ttHtml = html;
            this._ttSize = { w: r.width, h: r.height };
        }
        const { w, h } = this._ttSize;
        let x = event.clientX + 14, y = event.clientY + 14;
        if (x + w > window.innerWidth - 8) x = Math.max(8, event.clientX - w - 14);
        if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
        t.style.left = `${x}px`;
        t.style.top = `${y}px`;
    },
    hideTooltip() { $('tooltip').style.display = 'none'; },

    tooltipFlow(event, d) {
        const isW = STATE.metric === 'weight';
        const f = (v, w) => (isW ? METRIC_FORMAT.weight.fmt(w) : METRIC_FORMAT.value.fmt(v));
        this.showTooltip(event, `
            <div class="tt-title">${esc(nm(d.e))} → ${esc(nm(d.i))}${d.src === 'm' ? ' †' : ''}</div>
            <div class="tt-big">${DataLoader.isEst(d) ? '≈' : ''}${fmtMetric(DataLoader.val(d))}</div>
            <div class="tt-note">${d.src === 'm' ? CONFIG.daggerNote : 'Exporter’s report'}${isW && d.wb === 'comtrade_estimate' ? ' · weight estimated by UN Comtrade' : ''}</div>
            <div class="tt-row"><span>Exporter’s report</span><span>${d.xv == null ? 'no record' : f(d.xv, d.xw)}</span></div>
            <div class="tt-row"><span>Importer’s report</span><span>${d.mv == null ? 'no record' : f(d.mv, d.mw)}</span></div>
            ${this.estLines(d)}
            <div class="tt-sub">${CONFIG.flowLabels[d.fc] || ''} · click for history</div>`);
    },

    // Estimate details for tooltips (estimated mode only).
    estLines(d) {
        if (STATE.basis === 'estimated' && DataLoader.estAvailableFor() && DataLoader.nearlyReported(d)) {
            return '<div class="tt-note">Almost all reported; the estimated part is very small.</div>';
        }
        if (!DataLoader.isEst(d)) return '';
        const iv = DataLoader.interval(d);
        const isW = STATE.metric === 'weight';
        // Method names come from meta.json (estimation.*.codes) when present.
        const codes = STATE.meta?.estimation?.[isW ? 'weight' : 'value']?.codes || {};
        const FALLBACK = isW
            ? { C: 'UN Comtrade’s own estimate, kept', K: 'from the quantity field', B: 'model estimate using the partner’s report', U: 'model estimate without a partner weight', Q: 'reported weight replaced after a quality check' }
            : { M: 'estimated from the importer’s report', E: 'no report on either side; estimated from the same pair’s other years' };
        const key = isW ? d.wm : (d.src === 'e' ? 'E' : d.vm);
        const how = codes[key] || FALLBACK[key] || 'model estimate';
        return `<div class="tt-est"><span class="est-badge">est.</span> ${esc(how)}: <b>${fmtMetric(DataLoader.val(d))}</b>${iv ? `<br>90% interval ${fmtMetric(iv[0])} – ${fmtMetric(iv[1])}` : ''}</div>`;
    },

    tooltipCountry(event, iso) {
        const s = STATE.nodeStats[iso] || { exp: 0, imp: 0 };
        this.showTooltip(event, `<div class="tt-title">${esc(nm(iso))}</div>
            <div class="tt-row"><span>Exports in selection</span><span>${fmtMetric(s.exp)}</span></div>
            <div class="tt-row"><span>Imports in selection</span><span>${fmtMetric(s.imp)}</span></div>
            <div class="tt-sub">Click for the economy panel</div>`);
    },

    // ── Country panel (right column) ─────────────────────────────────
    async openCountry(iso) {
        if (!STATE.eco[iso]) return;
        this._hintDone?.();
        STATE.selectedCountry = iso;
        $('panel-country-name').textContent = nm(iso);
        $('panel-body').innerHTML = '<div class="cp-loading">Loading&hellip;</div>';
        if (!$('insight-panel').classList.contains('open')) enter($('insight-panel'), { y: 4 });   // the economy replaces the summary
        $('insight-panel').classList.add('open');
        $('insight-panel').inert = false;
        document.body.classList.add('insight-open');
        if (!$('arc-modal').classList.contains('hidden')) this.closeModal('arc-modal', false);   // the economy frames itself below
        if (sheetMode()) { if (this._sheet === 'peek') this.setSheet('half'); } else if (!this.sideOpen) { this.sideOpen = true; this.layoutStage(); this.refitMap(); }
        this.syncBack();
        $('side-body').scrollTop = 0;
        TradeMap.setFocus(iso);
        await this.update();
        if (STATE.view === 'map') TradeMap.frameFlows(iso);
        this.fillCountry(iso);
    },

    async fillCountry(iso) {
        const r = await CountryPanel.build(iso);
        if (STATE.selectedCountry !== iso) return;
        $('panel-country-meta').textContent = r.meta;
        $('panel-body').innerHTML = r.html;
        enter($('panel-body'), { y: 0, ms: MS.ui });   // "Loading" gives way to the figures
        CountryPanel.drawSeries($('cp-ts'), iso, r.series.sb, r.series.ss);
    },

    closeCountry(rerender = true) {
        if ($('insight-panel').classList.contains('open')) ['world-panel', 'kpi-bar', 'corridor-list'].forEach((id, k) => enter($(id), { y: 4, delay: k * 30 }));
        $('insight-panel').classList.remove('open');
        $('insight-panel').inert = true;
        document.body.classList.remove('insight-open');
        const was = STATE.selectedCountry;
        STATE.selectedCountry = null;
        if (sheetMode() && this._sheet === 'half' && $('arc-modal').classList.contains('hidden')) this.setSheet('peek');   // the map comes back
        this.syncBack();
        TradeMap.clearFocus();
        if (was && STATE.view === 'map') TradeMap.zoomToRegion(STATE.region || 'Global');
        if (rerender) this.update();
    },

    // ── Pair history (both directions, both sides' reports) ─────────
    async openPair(a, b) {
        this._hintDone?.();
        this._pair = [a, b];
        const p = DataLoader.product();
        $('arc-modal-title').textContent = `${nm(a)} ⇄ ${nm(b)}`;
        $('arc-modal-meta').textContent = `${p.label} · ${METRIC_FORMAT[STATE.metric].label} · pair history`;
        $('arc-modal-body').innerHTML = '<div class="cp-loading">Loading&hellip;</div>';
        this.openModal('arc-modal');
        STATE.highlightPair = (STATE.filteredData || []).some(d => d.e === a && d.i === b) ? `${a}|${b}` : (STATE.filteredData || []).some(d => d.e === b && d.i === a) ? `${b}|${a}` : STATE.highlightPair;
        if (STATE.view === 'map') { TradeMap.setHighlight(STATE.highlightPair); CorridorList.render(); }
        $('menu-csv-pair').disabled = false;
        $('side-k').textContent = 'Flow';
        this.renderPeek();
        this.hideTooltip();
        const all = await DataLoader.loadAllYears(p.id);
        const isW = STATE.metric === 'weight';
        const fx = (d) => (d ? (isW ? d.xw : d.xv) : undefined);
        const fm = (d) => (d ? (isW ? d.mw : d.mv) : undefined);
        const cell = (v, reported) => (v == null ? `<span class="muted">${reported ? 'no record' : 'did not report'}</span>` : fmtMetric(v));
        const rows = Object.entries(all).map(([y, flows]) => {
            const ab = flows.find(d => d.e === a && d.i === b);
            const ba = flows.find(d => d.e === b && d.i === a);
            const R = (iso, f) => DataLoader.reported(iso, y, f);
            return `<tr><td class="al">${y}${isProvisional(y) ? 'ᵖ' : ''}</td>
              <td class="ar">${cell(fx(ab), R(a, 'X'))}</td><td class="ar">${cell(fm(ab), R(b, 'M'))}${ab?.src === 'm' ? ' <sup class="dag">†</sup>' : ''}</td>
              <td class="ar">${cell(fx(ba), R(b, 'X'))}</td><td class="ar">${cell(fm(ba), R(a, 'M'))}${ba?.src === 'm' ? ' <sup class="dag">†</sup>' : ''}</td></tr>`;
        }).join('');
        $('arc-modal-body').innerHTML = `
            <p class="si-sublabel"><b>No record</b>: the economy reported for that year, but not this flow (an exporter-side “no record” means the map shows 0). <b>Did not report</b>: no report for that year.</p>
            <p class="si-sublabel">† marks the importer’s report used on the map because the exporter did not report for that year. ${esc(twoReportsNote(STATE.metric))}</p>
            <div class="pair-scroll" tabindex="0" role="region" aria-label="Both directions, both reports, by year"><table class="si-table pair-table"><thead>
              <tr><th><span class="sr-only">Direction</span></th><th class="ac" colspan="2">${esc(nm(a))} → ${esc(nm(b))}</th><th class="ac" colspan="2">${esc(nm(b))} → ${esc(nm(a))}</th></tr>
              <tr><th class="al">Year</th><th class="ar">Exporter’s report<span class="sr-only"> (${esc(nm(a))})</span></th><th class="ar">Importer’s report<span class="sr-only"> (${esc(nm(b))})</span></th>
                  <th class="ar">Exporter’s report<span class="sr-only"> (${esc(nm(b))})</span></th><th class="ar">Importer’s report<span class="sr-only"> (${esc(nm(a))})</span></th></tr></thead>
              <tbody>${rows}</tbody></table></div>
            <div id="pair-chart"></div>`;
        enter($('arc-modal-body'), { y: 0, ms: MS.ui });
        this.drawPairChart($('pair-chart'), all, a, b, isW);
    },

    drawPairChart(el, all, a, b, isW) {
        const years = Object.keys(all).map(Number);
        const get = (y, e, i, side) => {
            const d = all[y].find(x => x.e === e && x.i === i);
            if (!d) return null;
            return side === 'x' ? (isW ? d.xw : d.xv) : (isW ? d.mw : d.mv);
        };
        // Two small multiples (one per direction) on one scale. Each year: filled dot = exporter's
        // report, open dot = importer's report, joined by a line ("two reports of the same trade").
        const dirs = [[a, b], [b, a]].map(([e, i]) => ({ e, i, d: years.map(y => ({ y, x: get(y, e, i, 'x'), m: get(y, e, i, 'm'), dag: all[y].find(q => q.e === e && q.i === i)?.src === 'm' })) }));
        const vals = dirs.flatMap(s => s.d.flatMap(p => [p.x, p.m])).filter(v => v > 0);
        if (!vals.length) return;
        const Wt = el.clientWidth || 600, gap = 24, W = Math.max(240, (Wt - gap) / 2), H = 190, m = { t: 26, r: 8, b: 22, l: 54 };
        const y = d3.scaleLinear().domain([0, d3.max(vals)]).nice().range([H - m.b, m.t]);
        d3.select(el).append('div').attr('class', 'stc-legend pc-legend')
            .html('<span><i class="dot db-x"></i>Exporter’s report</span><span><i class="dot db-m"></i>Importer’s report</span><span><b class="dag">†</b> used on the map (the exporter did not report)</span>');
        const row = d3.select(el).append('div').attr('class', 'pc-row');
        dirs.forEach(s => {
            const x = d3.scalePoint().domain(years).range([m.l, W - m.r]).padding(0.4);
            const svg = row.append('svg').attr('width', W).attr('height', H).attr('class', 'ts-svg pc-svg')
                .attr('role', 'img').attr('aria-label', `${nm(s.e)} to ${nm(s.i)}: exporter and importer reports by year`);
            svg.append('text').attr('class', 'pc-title').attr('x', m.l).attr('y', 12).text(`${nm(s.e)} → ${nm(s.i)}`);
            svg.append('g').attr('class', 'stc-grid').attr('transform', `translate(${m.l},0)`)
                .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(v => tickFmt(v)))
                .call(g => g.select('.domain').remove());
            svg.append('g').attr('class', 'ts-axis').attr('transform', `translate(0,${H - m.b})`)
                .call(d3.axisBottom(x).tickFormat(v => (years.length <= 5 || v % 2 === 0 ? String(v) : '')).tickSizeOuter(0));
            const g = svg.selectAll('.pc-y').data(s.d).enter().append('g').attr('transform', p => `translate(${x(p.y)},0)`);
            g.filter(p => p.x > 0 && p.m > 0).append('line').attr('class', 'db-link').attr('y1', p => y(p.x)).attr('y2', p => y(p.m));
            g.filter(p => p.m > 0).append('circle').attr('class', 'db-m').attr('r', 4).attr('cy', p => y(p.m));
            g.filter(p => p.x > 0).append('circle').attr('class', 'db-x').attr('r', 4).attr('cy', p => y(p.x));
            g.filter(p => p.dag && p.m > 0).append('text').attr('class', 'pc-dag').attr('x', 6).attr('y', p => y(p.m) + 4).text('†');
            g.append('title').text(p => `${p.y}: exporter report ${p.x == null ? 'no record' : fmtMetric(p.x)}; importer report ${p.m == null ? 'no record' : fmtMetric(p.m)}`);
        });
    },

    // ── Visibility panel ────────────────────────────────────────────
    async openVisibility(opts = {}) {
        $('visibility-title').textContent = VISIBILITY_TEXT.heading;
        this.openModal('visibility-modal');
        await VisibilityPanel.render($('visibility-body'), { scope: opts.scope || VisibilityPanel.defaultScope(), flow: opts.flow || 'X' });
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
// Handles for the tests (tests/*.spec.js); not used by the page itself.
window.__bm = { App, STATE, DataLoader, MatrixView, TradeMap, GapView, Story, hhi, STORY_CARDS, Pages, QUESTIONS, Findings };
