import * as d3 from 'd3';
import { CONFIG, STATE, METRIC_FORMAT, fmtMetric, isProvisional } from './config.js';
import { DataLoader } from './dataLoader.js';
import { cssVar } from './baseMap.js';
import { prefersReducedMotion, motionOn, MS } from './motion.js';
import { EASE_CSS } from './transitions.js';

// The time line at the foot (after the Non-plastic dashboard, UNCTAD, ../Non-plastic/dashboard/js/timeline.js):
// play, the year, and the years as columns of world exports (sum of the reporters' own reports, current product
// and measure). The year that is on is navy; the provisional year is hatched. Each column is a button
// (arrow keys move between years). Years without the product (HS 2022 codes before 2022) are greyed.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const Timeline = {
    el: null,
    onYear: null,
    _timer: null,

    init(el, { onYear }) {
        this.el = el;
        this.onYear = onYear;
        const play = document.getElementById('play');
        play.addEventListener('click', () => (this._timer ? this.stop() : this.play()));
        el.addEventListener('keydown', (e) => {
            const c = e.target.closest('.tl-col');
            if (!c) return;
            const yrs = DataLoader.productYears();
            const y = +c.dataset.val;
            let n = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') n = yrs[Math.min(yrs.length - 1, yrs.indexOf(y) + 1)];
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') n = yrs[Math.max(0, yrs.indexOf(y) - 1)];
            else if (e.key === 'Home') n = yrs[0];
            else if (e.key === 'End') n = yrs[yrs.length - 1];
            else if (e.key === 'Enter' || e.key === ' ') n = y;
            if (n == null) return;
            e.preventDefault();
            this._refocus = true;
            if (yrs.includes(n)) this.onYear?.(n);
        });
        el.addEventListener('click', (e) => {
            const c = e.target.closest('.tl-col');
            if (!c || c.classList.contains('off')) return;
            this.onYear?.(+c.dataset.val);
        });
        new ResizeObserver(() => { if (this._last) this.render(this._last); }).observe(el);
    },

    play() {
        const yrs = DataLoader.productYears();
        let i = yrs.indexOf(STATE.year);
        if (i < 0 || i >= yrs.length - 1) i = -1;
        const btn = document.getElementById('play');
        btn.innerHTML = '&#10074;&#10074;';
        btn.setAttribute('aria-label', 'Pause');
        btn.setAttribute('aria-pressed', 'true');
        const step = () => {
            i++;
            if (i >= yrs.length) { this.stop(); return; }
            this.onYear?.(yrs[i]);
        };
        step();
        this._timer = setInterval(step, prefersReducedMotion() ? 1600 : 1200);
    },

    stop() {
        clearInterval(this._timer);
        this._timer = null;
        const btn = document.getElementById('play');
        btn.innerHTML = '&#9654;';
        btn.setAttribute('aria-label', 'Play the years');
        btn.setAttribute('aria-pressed', 'false');
    },

    async render(summary) {
        this._last = summary;
        const el = this.el;
        if (!el) return;
        const y0 = STATE.year;
        document.getElementById('year-out').textContent = y0;
        document.getElementById('year-prov').textContent = isProvisional(y0) ? 'provisional' : '';
        const had = el.contains(document.activeElement) || this._refocus;
        this._refocus = false;
        const isW = STATE.metric === 'weight';
        const yrs = DataLoader.productYears();
        const rows = CONFIG.years.map(y => ({ y, v: yrs.includes(y) ? (summary?.world?.[String(y)]?.[isW ? 'xw' : 'x'] ?? null) : null, on: yrs.includes(y) }));
        const W = Math.max(200, el.clientWidth), H = Math.max(50, el.clientHeight);
        const m = { t: 16, b: 15, l: 2, r: 2 };
        const x = d3.scaleBand().domain(rows.map(r => r.y)).range([m.l, W - m.r]).paddingInner(0.22).paddingOuter(0.05);
        const ymax = d3.max(rows, r => r.v) || 1;
        const y = d3.scaleLinear().domain([0, ymax]).range([H - m.b, m.t + 10]);
        const svg = d3.select(el).selectAll('svg').data([0]).join('svg').attr('viewBox', `0 0 ${W} ${H}`);
        let defs = svg.select('defs');
        if (defs.empty()) {
            defs = svg.append('defs');
            const pt = defs.append('pattern').attr('id', 'tl-hatch').attr('width', 5).attr('height', 5).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
            pt.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5).attr('stroke', cssVar('--white')).attr('stroke-width', 1.6).attr('stroke-opacity', 0.8);
        }
        const p = DataLoader.product();
        // a narrow chart (phones) has the short caption: the product is on its control just above (the long one ran off)
        const unit = isW ? 'tonnes' : 'US$';
        svg.selectAll('text.tl-cap').data([0]).join('text').attr('class', 'tl-cap').attr('x', m.l).attr('y', 10)
            .text(W < 480 ? `World exports, exporters’ reports · ${unit}` : `World exports, as reported by exporters: ${p.label.charAt(0).toLowerCase() + p.label.slice(1)} · ${unit}`);
        const fmt = METRIC_FORMAT[STATE.metric].fmt;
        const g = svg.selectAll('g.tl-col').data(rows, r => r.y).join(enter => {
            const e = enter.append('g').attr('class', 'tl-col');
            e.append('rect').attr('class', 'hit').attr('fill', 'transparent');
            e.append('rect').attr('class', 'v');
            e.append('rect').attr('class', 'pv');
            e.append('text').attr('class', 'tl-val');
            e.append('text').attr('class', 'tl-lab');
            return e;
        });
        g.attr('class', r => `tl-col${r.y === y0 ? ' on' : ''}${isProvisional(r.y) ? ' prov' : ''}${r.on ? '' : ' off'}`)
            .attr('data-ctl', 'year').attr('data-val', r => r.y)
            .attr('role', 'button')
            .attr('tabindex', r => (r.y === y0 ? 0 : -1))
            .attr('aria-pressed', r => String(r.y === y0))
            .attr('aria-disabled', r => (r.on ? null : 'true'))
            .attr('aria-label', r => `${r.y}${isProvisional(r.y) ? ' (provisional)' : ''}: ${r.on ? (r.v == null ? 'no data' : fmt(r.v)) : 'this code exists from 2022'}`);
        g.select('rect.hit').attr('x', r => x(r.y) - 3).attr('width', x.bandwidth() + 6).attr('y', 0).attr('height', H);
        const bh = r => (r.v > 0 ? Math.max(1.5, y(0) - y(r.v)) : (r.on ? 1 : 0));
        g.select('rect.v').attr('x', r => x(r.y)).attr('width', x.bandwidth()).attr('y', r => y(0) - bh(r)).attr('height', bh);
        g.select('rect.pv').attr('x', r => x(r.y)).attr('width', x.bandwidth()).attr('y', r => y(0) - bh(r)).attr('height', r => (isProvisional(r.y) ? bh(r) : 0));
        g.select('text.tl-val').attr('x', r => x(r.y) + x.bandwidth() / 2).attr('y', r => y(0) - bh(r) - 3)
            .text(r => (r.v > 0 && (r.y === y0 ? x.bandwidth() > 44 || W > 300 : W > 700) ? fmtMetric(r.v) : ''));
        const short = x.bandwidth() < 34;   // narrow: '16, '17 …
        g.select('text.tl-lab').attr('x', r => x(r.y) + x.bandwidth() / 2).attr('y', H - 2).text(r => `${short ? '’' + String(r.y).slice(2) : r.y}${isProvisional(r.y) ? 'ᵖ' : ''}`);
        if (had) el.querySelector('.tl-col.on')?.focus({ preventScroll: true });
        // the columns grow from the baseline the first time, and take their new height after a change of product or
        // measure (transform only, docs/design/MOTION_V6.md)
        const was = this._h || {};
        this._h = {};
        g.each(function (r) {
            const h1 = bh(r), h0 = was[r.y] ?? 0;
            Timeline._h[r.y] = h1;
            if (!motionOn() || !h1 || Math.abs(h1 - h0) < 0.5) return;
            this.querySelectorAll('rect.v, rect.pv').forEach(b => {
                b.style.transformBox = 'fill-box';
                b.style.transformOrigin = '50% 100%';
                b.animate([{ transform: `scaleY(${(h0 / h1).toFixed(4)})` }, { transform: 'none' }], { duration: MS.ui + 80, easing: EASE_CSS.out });
            });
        });
    },

    label() { return esc(String(STATE.year)); },
};
