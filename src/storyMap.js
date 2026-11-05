import * as d3 from 'd3';
import { STATE, fmtMetric } from './config.js';
import { cssVar, makeDefs, drawBase, setBorderDetail, landFill, arcD, arcGeom, placeHeadGeom, isoOf, outlineD } from './baseMap.js';
import { md, motionOn, MS, EASE } from './motion.js';
import { swapping, afterSwap } from './transitions.js';

// The story's map: the same flat UN base map as the explorer (src/baseMap.js, Equal Earth), replacing the
// three.js globe and the 2D canvas globe. Same interface as the old stage (setView, setLand, setFlows,
// setFocus, setLabels, setFlowFilter, onHover), so the scenes (src/storyMode.js) keep their content.
//   flows: [{ e, i, a:[lon,lat], b:[lon,lat], v, x, m, dagger, color, colorM, metric }]
//   twin:  each flow drawn twice: the exporter's report (solid, filled arrow) and the importer's report
//          (outlined strand, open arrow); one line if the two agree within 10%.
//
// Motion (docs/design/MOTION_V6.md): a chapter is one sequence, set with batch(fn): what leaves fades out at once;
// the camera glides along a smooth zoom path (d3.interpolateZoom) from wherever it is; the corridors of the new
// state draw on from exporter to importer, the largest first, as the camera lands; labels appear once the camera
// has settled. The same corridor or spike keeps its identity (keyed) and moves to its new width or height. A new
// change interrupts the running one from where it is. Per camera frame only the transform of the map and the few
// attributes that depend on the zoom (line widths, arrowheads, nodes, spikes) are written; the base map is not
// touched (perf: one shared drawing, baseMap.js). Under reduced motion every state lands at once.
let _maps = 0;

export function createStoryMap(el) {
    // each map has its own hatch patterns: their tiles are fitted to this map's scale (baseMap.js setBase), and a
    // pattern in a hidden page's svg would not paint
    const P = _maps++ ? `s${_maps}` : 's';
    const svg = d3.select(el).append('svg').attr('class', 'flatmap').attr('aria-hidden', 'true').attr('focusable', 'false');
    makeDefs(svg, P);
    const g = svg.append('g');
    const gLand = g.append('g');
    const gFlow = g.append('g').attr('class', 'st-flows');
    const gHead = g.append('g');
    const gNode = g.append('g');
    const gSpike = g.append('g').attr('class', 'st-spikes');
    const gLab = g.append('g');
    let W = 0, H = 0, proj = null, path = null, T = d3.zoomIdentity;
    let flows = [], opts = {}, filter = null, labels = [], focus = null, land = { name: 'base', fill: null }, view = null, hover = null, spikes = null;
    let batching = 0, pending = null;     // batch(): what changed, drawn once at the end
    let flying = null;                     // the running camera move: { t1, end: Promise }
    let landShown = land;                  // the land colours on screen (a new chapter's colours wait for the camera)
    let landTimer = null;
    let resized = false;                   // the cell changed size since the last draw (leaving marks are moved to the new units)

    const fillOf = d => {
        if (landShown.name === 'base' || !landShown.fill) return null;
        const v = landShown.fill(d.properties.code);
        return v === 'hatch' ? 'status' : v || null;
    };
    const P2 = ll => (ll ? proj(ll) : null);
    const on = () => motionOn();
    // the end of a leaving mark's fade (explicit: d3's transition.remove() keeps an element that has another
    // transition scheduled, such as a corridor still waiting to draw on)
    function gone() { this.remove(); }

    // Called on every chapter (the grid may have changed): when the cell has the same size, nothing is drawn again.
    // When it changed, the projection is fitted to the new cell and the camera is corrected so that what is on the
    // screen stays where it is; the camera then glides from there (no jump).
    // measure(): read the cell's size; when it changed, fit the projection and correct the camera. True = changed.
    function measure() {
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) return false;
        if (proj && r.width === W && r.height === H) return false;
        const old = proj ? { s: proj.scale(), t: proj.translate() } : null;
        W = r.width; H = r.height;
        svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H);
        proj = d3.geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' });
        path = d3.geoPath(proj);
        if (old) {
            // the new projection is the old one scaled and moved: x' = a x + b. T' = T after the inverse of that.
            const a = proj.scale() / old.s, [tx, ty] = proj.translate();
            const bx = tx - a * old.t[0], by = ty - a * old.t[1];
            stopCamera();
            T = d3.zoomIdentity.translate(T.x - T.k * bx / a, T.y - T.k * by / a).scale(T.k / a);
            g.attr('transform', T);
            resized = true;
            // marks drawn in the old units: those that were leaving go now, those drawing on finish
            [gFlow, gHead, gNode, gSpike, gLab].forEach(l => l.selectAll('*').filter(function () { return this.__leaving; }).remove());
            gFlow.selectAll('path').interrupt('draw').each(finishDraw).attr('opacity', 1);
        }
        drawBase(gLand, path, { p: P, k: T.k, fillOf });
        return true;
    }
    // resize(): the cell may have changed (a new grid, a window resize). Without a batch running, the camera glides
    // from the corrected picture to the view's framing in the new cell.
    function resize() {
        if (!measure() || batching) return !!proj;
        if (view) commit({ ms: MS.ui + 140 }); else { drawOver(false); resized = false; }
        return true;
    }

    function shown() { return filter ? flows.filter(filter) : flows; }

    // ── geometry of the marks, from the current projection (no DOM reads)
    const dashFor = (w, k) => `${Math.max(4, w * 2.2) / k},${Math.max(3, w * 1.4) / k}`;
    function strandsOf(list) {
        const vmax = d3.max(list, f => f.v) || 1;
        const ws = d3.scaleSqrt().domain([0, vmax]).range([1, Math.max(3, Math.min(8, W * 0.007))]).clamp(true);
        const out = [];
        list.forEach(f => {
            const p1 = P2(f.a), p2 = P2(f.b);
            if (!p1 || !p2) return;
            if (opts.twin) {
                const both = f.x > 0 && f.m > 0, agree = both && Math.abs(f.m / f.x - 1) <= 0.1;
                if (f.x > 0) out.push({ f, side: agree ? 'both' : 'x', bend: 1.3, w: ws(f.x), col: f.color, v: f.x });
                if (f.m > 0 && !agree) out.push({ f, side: 'm', bend: f.x > 0 ? 0.95 : 1.3, w: ws(f.m), col: f.colorM || f.color, open: true, v: f.m });
            } else {
                out.push({ f, side: null, bend: 1.3, w: ws(f.v), col: f.color, dag: f.dagger, open: f.dagger, v: f.v });
            }
        });
        out.forEach(s => { const p1 = P2(s.f.a), p2 = P2(s.f.b); s.d = arcD(p1, p2, s.bend); s.g = arcGeom(p1, p2, s.bend); s.key = `${s.f.e}|${s.f.i}|${s.side}`; });
        // rank for the order of drawing on: the largest first
        out.slice().sort((a, b) => b.w - a.w).forEach((s, k) => { s.rank = k; });
        return out.sort((a, b) => a.w - b.w);   // painting order: the largest on top
    }
    const lineW = (s, w) => (s.open && opts.twin ? w + 2.2 : w);
    // a corridor that started to leave while it was drawing on, and is wanted again (Back right after Next): it
    // draws on to the end from where it stopped
    function resumeDraw() {
        this.__leaving = false;
        if (!this.__drawCut) return;
        this.__drawCut = false;
        d3.select(this).transition('draw').duration(md(MS.ui)).ease(EASE.out).attr('stroke-dashoffset', 0).on('end', finishDraw).on('interrupt', finishDraw);
    }
    function finishDraw() {
        if (!this.__drawing || this.__leaving) return;   // a leaving corridor keeps its partial line while it fades
        this.__drawing = false;
        const s = d3.select(this).datum();
        this.setAttribute('stroke-dashoffset', 0);
        if (this.classList.contains('st-twin-in')) this.removeAttribute('stroke-dasharray');
        else if (s?.dag) this.setAttribute('stroke-dasharray', dashFor(this.__w ?? s.w, T.k)); else this.removeAttribute('stroke-dasharray');
    }

    // The attributes that depend on the zoom, for zoom k (every camera frame; reads nothing from the DOM)
    function applyK(k) {
        gFlow.selectAll('path.st-arc').each(function (s) {
            const w = this.__w ?? s.w;
            this.setAttribute('stroke-width', lineW(s, w) / k);
            if (s.dag && !this.__drawing && !this.__leaving) this.setAttribute('stroke-dasharray', dashFor(w, k));
        });
        gFlow.selectAll('path.st-twin-in').each(function (s) { this.setAttribute('stroke-width', Math.max(0.6, (this.__w ?? s.w) - 0.6) / k); });
        gHead.selectAll('path.st-head').each(function (s) {
            placeHeadGeom(this, s.g, this.__w ?? s.w, 3, k, s.open, false);
            if (s.open) this.setAttribute('stroke-width', 1.6 / k);
        });
        gNode.selectAll('circle.st-node').attr('r', 2.6 / k).attr('stroke-width', 1 / k);
        gSpike.selectAll('path.spike').each(function (d) { this.setAttribute('d', spikeD(d, this.__h ?? d.h, k)); this.setAttribute('stroke-width', 0.8 / k); });
    }

    // ── flows: keyed by exporter | importer | report. tr = { delay } to animate (the delay lets the camera lead),
    //    false for the end state at once.
    function drawOver(tr = { delay: 0 }) {
        if (!proj) return;
        const anim = tr !== false && on();
        const delay = anim ? tr.delay || 0 : 0;
        const k = T.k;
        const list = shown();
        const strands = strandsOf(list);
        const key = s => s.key;
        const dur = md(MS.data);
        const startOf = s => delay + Math.min(s.rank, MS.staggerMax) * MS.stagger;

        // leaving: a quick fade where they are. If the cell has just changed size, they are first moved to the new
        // projection's units (the camera was corrected for it), so they fade in place instead of jumping.
        const leave = (sel) => {
            sel.each(function () { this.__leaving = true; if (this.__drawing) this.__drawCut = true; }).attr('pointer-events', 'none').on('mouseover mousemove mouseout', null)
                .interrupt('draw').interrupt('w');
            if (!anim) { sel.remove(); return; }
            if (resized) {
                sel.filter('path.st-arc, path.st-twin-in').attr('d', s => (s?.f ? arcD(P2(s.f.a), P2(s.f.b), s.bend) : null));
                sel.filter('path.st-head').each(function (s) { if (!s?.f) return; s.g = arcGeom(P2(s.f.a), P2(s.f.b), s.bend); placeHeadGeom(this, s.g, this.__w ?? s.w, 3, T.k, s.open, true); });
                sel.filter('circle.st-node').each(function (iso) { const p = P2(STATE.countryCoords[iso]); if (p) { this.setAttribute('cx', p[0]); this.setAttribute('cy', p[1]); } });
            }
            sel.interrupt('w').transition('fade').duration(md(MS.micro)).ease(EASE.in).attr('opacity', 0).on('end', gone);
        };
        const arcs = gFlow.selectAll('path.st-arc').data(strands, key).join(
            enter => enter.append('path').attr('class', 'st-arc')
                .each(function (s) { this.__w = s.w; })
                .attr('d', s => s.d)
                .attr('stroke', s => s.col)
                .attr('stroke-opacity', 0.85)
                .attr('stroke-width', s => lineW(s, s.w) / k)
                .call(sel => {
                    if (!anim) { sel.attr('stroke-dasharray', s => (s.dag ? dashFor(s.w, k) : null)); return; }
                    // solid strands draw on from the exporter to the importer; dashed ones (a dash pattern cannot draw on) fade in
                    sel.filter(s => !s.dag).each(function (s) { this.__drawing = true; })
                        .attr('stroke-dasharray', s => `${s.g.L} ${s.g.L}`).attr('stroke-dashoffset', s => s.g.L)
                        .transition('draw').delay(startOf).duration(dur).ease(EASE.out).attr('stroke-dashoffset', 0)
                        .on('end', finishDraw).on('interrupt', finishDraw);
                    sel.filter(s => s.dag).attr('stroke-dasharray', s => dashFor(s.w, k)).attr('opacity', 0)
                        .transition('draw').delay(s => startOf(s) + dur * 0.15).duration(dur * 0.7).ease(EASE.out).attr('opacity', 1);
                }),
            update => update.interrupt('fade').attr('opacity', 1).each(resumeDraw).attr('d', s => s.d)
                .each(function (s) {
                    if (this.__drawing) return;
                    if (s.dag) this.setAttribute('stroke-dasharray', dashFor(this.__w ?? s.w, T.k)); else this.removeAttribute('stroke-dasharray');
                })
                .call(sel => {
                    // the same corridor: its width and colour move to the new values
                    if (!anim) { sel.each(function (s) { this.__w = s.w; }).attr('stroke', s => s.col).attr('stroke-width', s => lineW(s, s.w) / T.k); return; }
                    sel.transition('w').duration(md(MS.ui)).ease(EASE.inOut).attr('stroke', s => s.col)
                        .tween('w', function (s) { const i = d3.interpolateNumber(this.__w ?? s.w, s.w); return (u) => { this.__w = i(u); this.setAttribute('stroke-width', lineW(s, this.__w) / T.k); }; });
                }),
            exit => exit.call(leave),
        )
            .attr('class', s => `st-arc${s.dag ? ' dag' : ''}${s.open ? ' m' : ''}`)
            .on('mouseover mousemove', (ev, s) => hover && hover({ ...s.f, side: opts.twin ? s.side : null }, ev))
            .on('mouseout', () => hover && hover(null))
            .order();
        void arcs;
        // the outlined strand: a white core inside the coloured line, drawn on with it
        gFlow.selectAll('path.st-twin-in').data(strands.filter(s => s.open && opts.twin), key).join(
            enter => enter.append('path').attr('class', 'st-twin-in').each(function (s) { this.__w = s.w; })
                .attr('d', s => s.d).attr('stroke-width', s => Math.max(0.6, s.w - 0.6) / k)
                .call(sel => {
                    if (!anim) return;
                    sel.each(function () { this.__drawing = true; }).attr('stroke-dasharray', s => `${s.g.L} ${s.g.L}`).attr('stroke-dashoffset', s => s.g.L)
                        .transition('draw').delay(startOf).duration(dur).ease(EASE.out).attr('stroke-dashoffset', 0)
                        .on('end', finishDraw).on('interrupt', finishDraw);
                }),
            update => update.interrupt('fade').attr('opacity', 1).each(resumeDraw).attr('d', s => s.d).call(sel => {
                if (!anim) { sel.each(function (s) { this.__w = s.w; }).attr('stroke-width', s => Math.max(0.6, s.w - 0.6) / T.k); return; }
                sel.transition('w').duration(md(MS.ui)).ease(EASE.inOut)
                    .tween('w', function (s) { const i = d3.interpolateNumber(this.__w ?? s.w, s.w); return (u) => { this.__w = i(u); this.setAttribute('stroke-width', Math.max(0.6, this.__w - 0.6) / T.k); }; });
            }),
            exit => exit.call(leave),
        );
        gFlow.selectAll('path.st-twin-in').raise();
        // nodes: the economies at the ends; they arrive with their corridor
        const nodes = new Set(list.flatMap(f => [f.e, f.i]));
        const ends = {};
        list.forEach(f => { ends[f.e] = f.a; ends[f.i] = f.b; });
        const firstAt = {};
        strands.forEach(s => { [s.f.e, s.f.i].forEach(i => { firstAt[i] = Math.min(firstAt[i] ?? Infinity, startOf(s) + (i === s.f.i ? dur * 0.8 : 0)); }); });
        gNode.selectAll('circle.st-node').data([...nodes].filter(i => ends[i]), d => d).join(
            enter => enter.append('circle').attr('class', 'st-node').attr('r', 2.6 / k).attr('stroke-width', 1 / k)
                .call(sel => { if (anim) sel.attr('opacity', 0).transition('fade').delay(d => firstAt[d] || delay).duration(md(MS.micro)).attr('opacity', 1); }),
            update => update.interrupt('fade').attr('opacity', 1).each(function () { this.__leaving = false; }),
            exit => exit.call(leave),
        )
            .attr('class', d => `st-node${focus && d === focus.iso ? ' focus' : ''}`)
            .attr('cx', d => P2(ends[d])[0]).attr('cy', d => P2(ends[d])[1]);
        // arrowheads: placed from the arc's geometry; a new one appears as its line reaches the importer
        gHead.selectAll('path.st-head').data(strands, key).join(
            enter => enter.append('path').each(function (s) { this.__w = s.w; })
                .call(sel => { if (anim) sel.attr('opacity', 0).transition('fade').delay(s => startOf(s) + dur * 0.82).duration(md(MS.micro)).attr('opacity', 1); }),
            update => update.interrupt('fade').attr('opacity', 1).each(function () { this.__leaving = false; })
                .call(sel => {
                    if (!anim) { sel.each(function (s) { this.__w = s.w; }); return; }
                    sel.transition('w').duration(md(MS.ui)).ease(EASE.inOut).attr('fill', s => (s.open ? 'none' : s.col)).attr('stroke', s => (s.open ? s.col : 'none'))
                        .tween('w', function (s) { const i = d3.interpolateNumber(this.__w ?? s.w, s.w); return (u) => { this.__w = i(u); placeHeadGeom(this, s.g, this.__w, 3, T.k, s.open, true); }; });
                }),
            exit => exit.call(leave),
        )
            .attr('class', s => `st-head${s.open ? ' open' : ''}`)
            .attr('fill', s => (s.open ? 'none' : s.col)).attr('stroke', s => (s.open ? s.col : 'none'))
            .each(function (s) { placeHeadGeom(this, s.g, this.__w ?? s.w, 3, k, s.open, true); if (s.open) this.setAttribute('stroke-width', 1.6 / k); else this.removeAttribute('stroke-width'); });
        drawFocus();
    }

    // Spikes (Non-plastic): one per economy, height = value; the largest are labelled with name and value.
    //   spikes: { items: [{ iso, lonlat, v, name }], fmt, labels: n, color, vmax?, fit?, ref? }
    //   vmax: one scale across years; fit: the tallest spike (or ref = { lonlat, v }, the largest of all years)
    //   keeps its tip and label inside the frame, so the scale is lowered where the frame is short
    // Keyed by economy: a spike grows from the ground, takes its new height when the year changes, shrinks away.
    const spikeD = (d, h, k) => `M${d.x - d.w / k},${d.y}L${d.x},${d.y - h / k}L${d.x + d.w / k},${d.y}Z`;
    function spikeData(t) {
        const items = spikes ? spikes.items.filter(d => d.v > 0 && d.lonlat) : [];
        const vmax = spikes?.vmax || d3.max(items, d => d.v) || 1;
        let hmax = Math.min(150, H * 0.3);
        if (spikes?.fit && items.length) {
            const ref = spikes.ref || items.reduce((a, d) => (d.v > a.v ? d : a), items[0]);
            const p = P2(ref.lonlat);
            if (p) hmax = Math.max(24, Math.min(hmax, (t.applyY(p[1]) - 36) * vmax / ref.v));
        }
        return items.map(d => { const p = P2(d.lonlat); const h = Math.max(1.5, hmax * d.v / vmax); return p ? { ...d, x: p[0], y: p[1], h, w: Math.max(1.4, Math.min(3.8, 1 + h * 0.022)) } : null; })
            .filter(Boolean).sort((a, b) => a.y - b.y);
    }
    function drawSpikes(tr = { delay: 0 }, t = T) {
        if (!proj) return [];
        const anim = tr !== false && on();
        const k = t.k;
        const sp = spikeData(t);
        const col = spikes?.color || cssVar('--un-blue-dark');
        const byRank = new Map(sp.slice().sort((a, b) => b.v - a.v).map((d, r) => [d.iso, r]));
        const grow = (sel, from, ms, delayOf) => sel.transition('h').delay(delayOf).duration(md(ms)).ease(EASE.out)
            .tween('h', function (d) { const i = d3.interpolateNumber(from(this, d), d.h); return (u) => { this.__h = i(u); this.setAttribute('d', spikeD(d, this.__h, T.k)); }; });
        gSpike.selectAll('path.spike').data(sp, d => d.iso).join(
            enter => enter.append('path').attr('class', 'spike')
                .each(function (d) { this.__h = anim ? 0 : d.h; }).attr('d', function (d) { return spikeD(d, this.__h, k); })
                .call(sel => { if (anim) grow(sel, () => 0, MS.data, d => (tr.delay || 0) + Math.min(byRank.get(d.iso), 30) * 12); }),
            update => update.interrupt('fade').attr('opacity', 1).each(function () { this.__leaving = false; }).call(sel => {
                if (!anim) { sel.each(function (d) { this.__h = d.h; }).attr('d', d => spikeD(d, d.h, k)); return; }
                grow(sel, (el, d) => el.__h ?? d.h, Math.min(MS.ui + 60, 320), () => tr.delay || 0);
            }),
            exit => exit.each(function () { this.__leaving = true; }).attr('pointer-events', 'none').call(sel => {
                if (!anim) { sel.interrupt('h').remove(); return; }
                if (resized) sel.each(function (d) { const p = P2(d.lonlat); if (p) { d.x = p[0]; d.y = p[1]; } });
                grow(sel.interrupt('h'), (el, d) => el.__h ?? d.h, MS.micro * 0.9, () => 0);
                sel.each(function (d) { d.h = 0; }).transition('fade').duration(md(MS.micro)).attr('opacity', 0).on('end', gone);
            }),
        )
            .attr('fill', col).attr('fill-opacity', 0.55).attr('stroke', col).attr('stroke-width', 0.8 / k).attr('stroke-linejoin', 'round')
            .selectAll('title').data(d => [d]).join('title').text(d => `${d.name}: ${spikes.fmt ? spikes.fmt(d.v) : d.v}`);
        return sp;
    }
    // the spikes' labels, placed for transform t (the end of a camera move), fading in after `delay`
    function drawSpikeLabels(sp, t, delay = 0, anim = on()) {
        const k = t.k;
        const lab = [], boxes = [];
        for (const d of sp.slice().sort((a, b) => b.v - a.v)) {
            if (lab.length >= (spikes?.labels ?? 6)) break;
            const t2 = spikes.fmt ? spikes.fmt(d.v) : String(d.v);
            const wd = (Math.max(d.name.length, t2.length) * 6 + 6) / k, tip = d.y - d.h / k;
            // above the tip, or (when the tip is near the top of the frame) beside it
            const cands = [[d.x - wd / 2, tip - 28 / k, 'middle', d.x], [d.x + 5 / k, tip + 4 / k, 'start', d.x + 5 / k]];
            const c = cands.map(([x0, y0, anchor, tx]) => ({ x0, y0, x1: x0 + wd, y1: y0 + 26 / k, anchor, tx }))
                .find(b => t.applyY(b.y0) >= 2 && t.applyX(b.x0) >= 0 && t.applyX(b.x1) <= W && !boxes.some(q => b.x0 < q[2] && b.x1 > q[0] && b.y0 < q[3] && b.y1 > q[1]));
            if (!c) continue;
            boxes.push([c.x0, c.y0, c.x1, c.y1]);
            lab.push({ ...d, t2, ly: c.y0 + 11 / k, lx: c.tx, anchor: c.anchor });
        }
        const L = gSpike.selectAll('text.spike-lbl').data(lab, d => d.iso).join(
            enter => enter.append('text').attr('class', 'spike-lbl').attr('y', d => d.ly)
                .call(sel => { if (anim) sel.attr('opacity', 0).transition('fade').delay(delay).duration(md(MS.ui)).ease(EASE.out).attr('opacity', 1); }),
            update => update.interrupt('fade').each(function () { this.__leaving = false; }).call(sel => {
                // a label that stays (playing the years) rises and falls with its spike's tip
                if (anim && !delay) sel.attr('opacity', 1).transition('move').duration(md(Math.min(MS.ui + 60, 320))).ease(EASE.out).attr('y', d => d.ly);
                else if (anim) sel.interrupt('move').attr('y', d => d.ly).attr('opacity', 0).transition('fade').delay(delay).duration(md(MS.ui)).attr('opacity', 1);
                else sel.interrupt('move').attr('opacity', 1).attr('y', d => d.ly);
            }),
            exit => exit.call(sel => { sel.each(function () { this.__leaving = true; }); return anim ? sel.interrupt('fade').transition('fade').duration(md(MS.micro)).attr('opacity', 0).on('end', gone) : sel.remove(); }),
        )
            .attr('x', d => d.lx).style('text-anchor', d => d.anchor).style('font-size', `${10.5 / k}px`).style('stroke-width', `${3 / k}px`);
        L.selectAll('tspan').remove();
        L.append('tspan').attr('x', d => d.lx).text(d => d.name);
        L.append('tspan').attr('class', 'v').attr('x', d => d.lx).attr('dy', '1.15em').text(d => d.t2);
    }

    // the outline is drawn in canonical units inside g.base-geo (projected once, shared: baseMap.js)
    function drawFocus() {
        if (!proj) return;
        const fs = focus?.iso ? (STATE.geoData?.features || []).filter(f => isoOf(f) === focus.iso) : [];
        gLand.select('.base-geo').selectAll('path.sel-outline').data(fs.length ? [focus.iso] : []).join('path').attr('class', 'sel-outline')
            .attr('d', iso => outlineD(`s:${iso}`, fs));
    }

    // Labels, placed for transform t (where the camera lands), fading in after `delay`. Labels that are kept stay.
    function drawLabels(t = T, delay = 0, anim = on()) {
        if (!proj) return;
        const k = t.k;
        const fsz = 10.5 / k, big = 12 / k;
        const boxes = [];
        const placed = [];
        labels.forEach(l => {
            const p = P2(l.lonlat);
            if (!p) return;
            const f = l.cls === 'focus' ? big : fsz;
            const w = l.text.length * f * 0.56;
            const sx = t.applyX(p[0]), sy = t.applyY(p[1]);
            const cand = [[p[0] + 5 / k, 'start'], [p[0] - 5 / k, 'end']];
            for (const [x, anchor] of cand) {
                const x0 = anchor === 'start' ? x : x - w, x1 = x0 + w, y0 = p[1] - f * 0.7, y1 = p[1] + f * 0.5;
                const sx0 = t.applyX(x0), sx1 = t.applyX(x1);
                if (sx0 < 2 || sx1 > W - 2 || sy < 6 || sy > H - 4) continue;
                if (boxes.some(b => x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1])) continue;
                boxes.push([x0, y0, x1, y1]);
                placed.push({ ...l, x, y: p[1] + f * 0.35, anchor, f });
                break;
            }
        });
        gLab.selectAll('text.st-label').data(placed, d => d.text).join(
            enter => enter.append('text').call(sel => { if (anim) sel.attr('opacity', 0).transition('fade').delay(delay).duration(md(MS.ui)).ease(EASE.out).attr('opacity', 1); }),
            update => update.interrupt('fade').attr('opacity', 1).each(function () { this.__leaving = false; }),
            exit => exit.call(sel => { sel.each(function () { this.__leaving = true; }); return anim ? sel.interrupt('fade').transition('fade').duration(md(MS.micro)).attr('opacity', 0).on('end', gone) : sel.remove(); }),
        )
            .attr('class', d => `st-label${d.cls ? ` ${d.cls}` : ''}`)
            .attr('x', d => d.x).attr('y', d => d.y).attr('text-anchor', d => d.anchor)
            .style('font-size', d => `${d.f}px`).style('stroke-width', `${3 / k}px`)
            .text(d => d.text);
    }
    // labels of the view the camera leaves: out of the way before it moves
    function hideLabels() {
        const sel = d3.selectAll([...gLab.selectAll('text.st-label').nodes(), ...gSpike.selectAll('text.spike-lbl').nodes()]);
        if (!on()) { sel.remove(); return; }
        sel.each(function () { this.__leaving = true; }).interrupt('fade').interrupt('move').transition('fade').duration(md(MS.micro)).ease(EASE.in).attr('opacity', 0).on('end', gone);
    }

    // view: { lon, lat, dist, only? } — flat map: the whole world (dist >= 1), a zoom on a centre, or
    // (with a flow filter) the box of the flows that are shown
    // view: { box: [[lon0, lat0], [lon1, lat1]] } frames a region (the region fits the cell; flows to the rest of
    // the world leave the frame); { world: true, maxK } shows the world and fills the cell's height where it can,
    // cutting the polar seas and, up to maxK, the Pacific edges. The sphere always covers the frame where it can.
    function target(v) {
        if (!proj || !v) return d3.zoomIdentity;
        const [[sx0, sy0], [sx1, sy1]] = path.bounds({ type: 'Sphere' });
        const sh = sy1 - sy0;
        let k, cx, cy;
        if (v.box) {
            const [[a0, b0], [a1, b1]] = v.box, pts = [];
            for (let i = 0; i <= 12; i++) {
                const t = i / 12;
                pts.push([a0 + (a1 - a0) * t, b0], [a0 + (a1 - a0) * t, b1], [a0, b0 + (b1 - b0) * t], [a1, b0 + (b1 - b0) * t]);
            }
            const xy = pts.map(p => proj(p)).filter(Boolean);
            const [x0, x1] = d3.extent(xy, p => p[0]), [y0, y1] = d3.extent(xy, p => p[1]);
            k = Math.min(8, 0.94 * Math.min(W / (x1 - x0), H / (y1 - y0)));
            cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
        } else {
            // the world: zoom in to fill the height only as far as every drawn flow stays in the frame
            const pts = shown().flatMap(f => [P2(f.a), P2(f.b)]).filter(Boolean);
            let kf = v.maxK ?? 1.5, c = proj([v.lon ?? 10, v.lat ?? 8]);
            if (pts.length) {
                const [x0, x1] = d3.extent(pts, p => p[0]), [y0, y1] = d3.extent(pts, p => p[1]);
                kf = Math.min(kf, 0.9 * Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0)));
                c = [(x0 + x1) / 2, (y0 + y1) / 2];
            }
            k = Math.max(1, Math.min(kf, H / (sh * 0.8)));
            cx = c[0]; cy = c[1];
        }
        k = Math.max(1, Math.max(k, Math.min(H / sh, 8) * (v.box ? 1 : 0)));   // a region never leaves an empty band above or below
        const fit = (c, a0, a1, size) => ((a1 - a0) * k <= size ? size / 2 - k * (a0 + a1) / 2 : Math.min(-k * a0, Math.max(size - k * a1, size / 2 - k * c)));
        return d3.zoomIdentity.translate(fit(cx, sx0, sx1, W), fit(cy, sy0, sy1, H)).scale(k);
    }

    // ── the camera
    const same = (a, b) => Math.abs(a.k - b.k) < 1e-3 * a.k && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
    function stopCamera() { g.interrupt('cam'); }
    function jump(t) {
        stopCamera();
        T = t;
        g.attr('transform', t);
        setBorderDetail(gLand, t.k);
        applyK(t.k);
    }
    // Glide from where the camera is to t along a smooth zoom path (van Wijk & Nuij, d3.interpolateZoom). Resolves
    // true when it lands, false when a newer move interrupted it.
    function fly(t1, ms = 'auto') {
        const t0 = T;
        const vOf = t => [(W / 2 - t.x) / t.k, (H / 2 - t.y) / t.k, W / t.k];
        const iz = d3.interpolateZoom(vOf(t0), vOf(t1));
        const dur = ms === 'auto' ? Math.max(MS.cameraMin, Math.min(MS.cameraMax, iz.duration * 0.6)) : ms;
        setBorderDetail(gLand, Math.min(t0.k, t1.k), true);   // while it moves the border line only gets coarser
        return {
            dur, t1,
            end: new Promise(resolve => {
                g.interrupt('cam').transition('cam').duration(dur).ease(EASE.inOut)
                    .tween('cam', () => (u) => {
                        if (u >= 1) { T = t1; } else { const [cx, cy, w] = iz(u), k = W / w; T = d3.zoomIdentity.translate(W / 2 - cx * k, H / 2 - cy * k).scale(k); }
                        g.attr('transform', T);
                        applyK(T.k);
                    })
                    .on('end', () => { T = t1; setBorderDetail(gLand, t1.k); applyK(t1.k); resolve(true); })
                    .on('interrupt', () => resolve(false));
            }),
        };
    }

    // One sequence: what leaves fades out; the camera moves (if the view changed); the new corridors and spikes
    // arrive as it lands; the labels after it has settled.
    function applyLand() {
        landTimer?.stop();
        landTimer = null;
        landShown = land;
        if (proj) gLand.selectAll('path.land').attr('fill', d => landFill(d, fillOf, P));   // solid fills crossfade (CSS)
    }
    function commit(o = {}, changed = null) {
        if (!proj) return Promise.resolve(false);
        if (landTimer) applyLand();              // a previous chapter's colours, still waiting: now
        const instant = o.instant || !on();
        const t1 = view ? target(view) : T;
        const moving = !instant && !same(T, t1);
        if (changed?.land && !moving) applyLand();
        if (instant) {
            jump(t1);
            drawOver(false);
            const sp = drawSpikes(false, t1);
            resized = false;
            drawLabels(t1, 0, false);
            drawSpikeLabels(sp, t1, 0, false);
            flying = null;
            return Promise.resolve(true);
        }
        if (!moving) {
            jump(t1);
            drawOver({ delay: 0 });
            const sp = drawSpikes({ delay: 0 }, t1);
            resized = false;
            const settle = MS.data * 0.6 + MS.stagger * 4;
            drawLabels(t1, settle);
            drawSpikeLabels(sp, t1, settle);
            flying = null;
            return Promise.resolve(true);
        }
        hideLabels();
        const f = fly(t1, o.ms ?? 'auto');
        const lead = f.dur * 0.45;               // the corridors start to draw as the camera slows down
        if (changed?.land) landTimer = d3.timeout(applyLand, lead);   // and the land takes the chapter's colours
        drawOver({ delay: lead });
        const sp = drawSpikes({ delay: lead }, t1);
        resized = false;
        flying = f;
        f.end.then(ok => {
            if (!ok || flying !== f) return;
            flying = null;
            drawLabels(T, 80);
            drawSpikeLabels(sp, T, 80);
        });
        return f.end;
    }

    // Standalone setters animate on their own; inside batch(fn) they only record, and one sequence runs at the end.
    function change(what, draw) {
        if (batching) { pending = pending || {}; pending[what] = true; return; }
        draw();
    }
    function batch(fn, o = {}) {
        batching++;
        try { fn(); } finally { batching--; }
        if (batching) return Promise.resolve(true);
        const changed = pending;
        pending = null;
        measure();
        if (!o.instant && on() && swapping()) {
            // a change of page is holding the old picture: start when the new page is on screen (clocks run while it
            // is held, so a sequence started now would be half over when it appears)
            const token = (batch._t = (batch._t || 0) + 1);
            return afterSwap().then(() => { if (token !== batch._t) return false; measure(); return commit(o, changed); });
        }
        batch._t = (batch._t || 0) + 1;
        return commit(o, changed);
    }

    function setView(v, ms = 1200) {
        view = v;
        if (batching) { pending = pending || {}; pending.view = true; return Promise.resolve(true); }
        if (!proj) return Promise.resolve(false);
        return commit({ instant: !md(ms), ms: ms === 'auto' ? 'auto' : ms });
    }

    new ResizeObserver(() => { clearTimeout(resize._t); resize._t = setTimeout(resize, 60); }).observe(el);
    resize();

    return {
        kind: '2d',
        start() {}, stop() {},
        resize() { resize(); },
        setView,
        batch,
        prepareLand() {},
        setLand(name, fill) {
            land = { name: name || 'base', fill };
            change('land', applyLand);
        },
        setFlows(list, o = {}) { flows = list || []; opts = o; change('flows', () => { drawOver({ delay: 0 }); drawLabels(T, MS.data); }); },
        setFocus(lonlat, iso) { focus = lonlat ? { lonlat, iso } : null; change('focus', () => { drawOver(false); }); },
        setLabels(l) {
            labels = l || [];
            change('labels', () => {
                if (!flying) { drawLabels(T, 0); return; }
                const f = flying;   // the camera is moving: the labels wait until it has landed
                f.end.then(ok => { if (ok && flying === null) drawLabels(T, 80); });
            });
        },
        setSpikes(sp) {
            spikes = sp;
            change('spikes', () => {
                // while the camera moves, the spikes are sized for where it lands, and labelled once it has landed
                const f = flying, d = drawSpikes({ delay: 0 }, f ? f.t1 : T);
                if (!f) { drawSpikeLabels(d, T, 0); return; }
                f.end.then(ok => { if (ok && flying === null) drawSpikeLabels(drawSpikes({ delay: 0 }, T), T, 80); });
            });
        },
        setFlowFilter(fn) { filter = fn; change('filter', () => drawOver({ delay: 0 })); },
        onHover(cb) { hover = cb; },
        fmt: fmtMetric,
        color: name => cssVar(name),
    };
}
