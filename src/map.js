import * as d3 from 'd3';
import { CONFIG, STATE, fmtMetric, flowVal, isPhone } from './config.js';
import { RegionConfig } from './regions.js';
import { ISO_MAP, isoOf, cssVar, makeDefs, drawBase, setBorderDetail, landFill, arcD, arcGeom, arcPoint, placeHeadGeom, outlineD } from './baseMap.js';
// md() = motionDuration: every D3 transition runs through it so that under
// prefers-reduced-motion (or with motion switched off) the end state is applied instantly (0 ms).
import { motionDuration as md, prefersReducedMotion, MS, EASE } from './motion.js';

// Explorer map (spec 7.2). v2 look (docs/design/REDESIGN_V2.md): the UN base map on Equal Earth (src/baseMap.js,
// after the Non-plastic dashboard), sphere and graticule, economies that did not report for the year hatched.
// Flows as before: one arc per direction (A->B and B->A are separate), arrowheads sized with the line, dagger
// flows dashed, estimates dotted, highlight from the ranked list, the importer's report as a twin strand,
// nodes = total trade (blue net exporter, red net importer), hatched nodes for flagged weights, moving dots
// along the selected economy's corridors (none under reduced motion).
const P = 'm';   // pattern id prefix

// Marks that leave (arcs, arrowheads, labels) fade out and are then removed for certain. d3's transition.remove()
// skips the removal while another transition is active or pending on the element, and the arcs' opacity
// transition ('op', 600 ms) often still is: the arc stayed, and that transition then brought it back to full
// opacity (an economy chosen right after a change left unrelated arcs on the map; fixed 2026-11-05).
function leave(sel, ms) {
    return sel.interrupt().interrupt('op')
        .transition().duration(md(ms)).style('opacity', 0)
        .on('end interrupt', function () { this.remove(); });
}

export const TradeMap = {
    isoMap: ISO_MAP,
    svg: null,
    g: null,
    projection: null,
    path: null,
    zoomBehavior: null,
    width: 0,
    height: 0,
    focusedIso: null,
    highlightKey: null,
    _noData: new Set(),
    _outlineCache: new Map(),
    _zoomRaf: null,
    _pendingZoomK: 1,

    // ── 1. Initialization
    init() {
        const container = document.getElementById('map-container');
        const r = container.getBoundingClientRect();
        this.width = Math.max(200, r.width);
        this.height = Math.max(160, r.height);
        if (!this.svg) this.init2D(container);
        // The base map (about 1.7 MB of path data) only changes with the size of the stage and the free zone.
        // init() is called from many places (fonts, panel, resize, view switch): redraw only when something changed.
        const z = this.zone();
        const sig = [this.width, this.height, z.top, z.right, z.bottom, z.left].join('|');
        if (sig === this._staticSig && this.projection && this.g.select('.land-layer').select('path.land').size()) return;
        this._staticSig = sig;
        this.updateDimensions();
        this.updateProjection();
        this.renderStaticMap();
    },

    init2D(container) {
        this.svg = d3.select(container).append('svg')
            .attr('class', 'map-2d-layer')
            .attr('role', 'img')
            .attr('aria-label', 'World map (UN boundaries) with the largest directed flows')
            .style('touch-action', 'none');
        makeDefs(this.svg, P);
        this.g = this.svg.append('g');
        // The moving dots (SMIL) live in their own transparent svg above the map, on its own compositor layer
        // (will-change in the CSS). Inside the map svg every dot repainted the map tiles under it on every frame
        // (about 40% of a core while an economy was selected); here only the dots are painted.
        this.fx = d3.select(container).append('svg')
            .attr('class', 'map-fx-layer')
            .attr('aria-hidden', 'true')
            .attr('focusable', 'false');
        this.gfx = this.fx.append('g');
        // While the map moves (a camera glide, the wheel, a drag) nothing on it reacts to the pointer: Chrome tests the
        // pointer against the map after every frame, and over a large economy that meant walking its whole outline
        // (and mouse-overs drawing hover outlines under a still pointer). A click without a drag is not affected.
        this.zoomBehavior = d3.zoom()
            .scaleExtent([0.8, 12])
            .on('start.still', (event) => { const se = event.sourceEvent; if (!se || se.type === 'wheel') this._moving(true); })
            .on('end.still', () => this._moving(false))
            .on('end.detail', (event) => setBorderDetail(this.g.select('.land-layer'), event.transform.k))   // finer border line once the map rests
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
                this.gfx.attr('transform', event.transform);
                if (event.sourceEvent && /move/.test(event.sourceEvent.type)) this._moving(true);   // a drag that moves
                this._pendingZoomK = event.transform.k;
                if (this._zoomRaf) return;
                this._zoomRaf = requestAnimationFrame(() => {
                    this._zoomRaf = null;
                    const k = this._pendingZoomK;
                    setBorderDetail(this.g.select('.land-layer'), k, true);
                    // the arcs keep their width and dashes on screen by themselves (vector-effect: non-scaling-stroke);
                    // only what has a size in map units follows k here
                    this.g.selectAll('.country-node, .node-flag').attr('r', function () {
                        return (+this.getAttribute('data-original-radius') || 3) / k;
                    }).attr('stroke-width', 1 / k);
                    this.g.selectAll('.economy-point').attr('r', 1.8 / k);
                    this.g.selectAll('.map-label')
                        .attr('font-size', (10.5 / Math.sqrt(k)) + 'px')
                        .attr('stroke-width', 3 / k);
                    this._placeHeads(k);
                });
            });
        this.svg.call(this.zoomBehavior).on('dblclick.zoom', null);
        this.svg.on('click', (event) => {
            if (event.target === this.svg.node() || event.target.classList?.contains('sphere') || event.target.classList?.contains('graticule')) {
                document.dispatchEvent(new CustomEvent('bm:background-click'));
            }
        });
        // Touch (mobile M06): arcs are 1–3 px wide and the dots 5–7 px, so a finger often lands beside them, on the
        // land under them. On a tap that hits neither, the nearest dot within 16 px, or else the nearest arc within
        // 12 px (away from its ends), is chosen from the computed geometry. Nothing is added to the map and nothing
        // runs per frame; a mouse click is unchanged.
        const svgNode = this.svg.node();
        svgNode.addEventListener('pointerdown', (e) => { this._ptype = e.pointerType; }, { capture: true, passive: true });
        svgNode.addEventListener('click', (e) => {
            if (this._ptype !== 'touch' && this._ptype !== 'pen') return;
            if (e.target.closest?.('.trade-arc, .node-layer')) return;   // a direct hit
            const hit = this._touchHit(e);
            if (!hit) return;
            e.stopPropagation();
            if (hit.iso) document.dispatchEvent(new CustomEvent('bm:country-click', { detail: hit.iso }));
            else document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e: hit.e, i: hit.i } }));
        }, true);
    },

    // the dot or arc nearest to a tap, in the map's own units (see the touch note in init2D)
    _touchHit(event) {
        if (!this.g || !this._geom || !this.projection) return null;
        const [x, y] = d3.pointer(event, this.g.node());
        const k = d3.zoomTransform(this.svg.node()).k || 1;
        let best = null, bd = 16 / k;
        this.g.select('.node-layer').selectAll('.country-node').each(function (iso) {
            if (this.classList.contains('exiting')) return;
            const p = TradeMap.projection(STATE.countryCoords[iso]);
            const dd = p ? Math.hypot(p[0] - x, p[1] - y) : Infinity;
            if (dd < bd) { bd = dd; best = { iso }; }
        });
        if (best) return best;
        bd = 12 / k;
        const gap = 16 / k, step = 4 / k;
        for (const d of this.g.select('.flow-layer').selectAll('.trade-arc:not(.exiting)').data()) {
            const g = this._geom.get(`${d.e}|${d.i}`);
            if (!g || g.L <= 2 * gap) continue;
            const n = Math.min(160, Math.ceil((g.L - 2 * gap) / step));
            for (let j = 0; j <= n; j++) {
                const p = arcPoint(g, gap + (g.L - 2 * gap) * j / n);
                const dd = Math.hypot(p[0] - x, p[1] - y);
                if (dd < bd) { bd = dd; best = { e: d.e, i: d.i }; }
            }
        }
        return best;
    },

    _moving(on) {
        if (!this.g || this._isMoving === on) return;
        this._isMoving = on;
        this.g.attr('pointer-events', on ? 'none' : null);
    },

    // E4: the free zone changed (the details panel opened or closed): the map glides to its new fit instead of
    // jumping. The new fit is the same drawing scaled and moved, so the camera starts where the old fit was on
    // screen and moves to the user's zoom relative to the new fit. Resolves true when it settles, false if interrupted.
    refit(ms = MS.camera) {
        const old = this.projection ? { s: this.projection.scale(), t: this.projection.translate() } : null;
        this.init();
        const pr = this.projection;
        if (!old || !pr || !this.svg) return Promise.resolve(true);
        const s1 = pr.scale(), t1 = pr.translate();
        if (s1 === old.s && t1[0] === old.t[0] && t1[1] === old.t[1]) return Promise.resolve(true);
        const T = d3.zoomTransform(this.svg.node());
        const k0 = T.k * old.s / s1;
        const start = d3.zoomIdentity.translate(T.k * old.t[0] + T.x - k0 * t1[0], T.k * old.t[1] + T.y - k0 * t1[1]).scale(k0);
        const dur = md(ms);
        this.svg.interrupt();
        this.svg.call(this.zoomBehavior.transform, start);
        this.renderFlows();
        if (!dur) { this.svg.call(this.zoomBehavior.transform, T); this.renderFlows(); return Promise.resolve(true); }
        return new Promise(res => {
            this.svg.transition().duration(dur).ease(EASE.inOut).call(this.zoomBehavior.transform, T)
                .on('end', () => { this.renderFlows(); res(true); })
                .on('interrupt', () => res(false));
        });
    },

    updateDimensions() {
        this.svg.attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${this.width} ${this.height}`);
        this.fx.attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${this.width} ${this.height}`);
    },

    // v4: the stage is the whole screen; the map is fitted to the part that the control bar, the details panel and
    // the view switcher leave free (main.js visibleZone), and selections are centred in that part.
    zone() {
        const z = this.zoneFn ? this.zoneFn() : null;
        return z && this.width > 0 ? z : { top: 10, right: 10, bottom: 10, left: 10 };
    },
    zoneCentre() {
        const z = this.zone();
        return [z.left + (this.width - z.left - z.right) / 2, z.top + (this.height - z.top - z.bottom) / 2, this.width - z.left - z.right, this.height - z.top - z.bottom];
    },

    updateProjection() {
        const z = this.zone();
        const x1 = Math.max(z.left + 120, this.width - z.right), y1 = Math.max(z.top + 80, this.height - z.bottom);
        this.projection = d3.geoEqualEarth()
            .fitExtent([[z.left, z.top], [x1, y1]], { type: 'Sphere' });
        this.path = d3.geoPath().projection(this.projection);
    },

    // Selected economy: bring it to the middle of the map.
    focusView(iso, k = 1.5) {
        if (!this.zoomBehavior || !STATE.countryCoords[iso]) return;
        const p = this.projection(STATE.countryCoords[iso]);
        if (!p) return;
        const [cx, cy] = this.zoneCentre();
        const t = d3.zoomIdentity.translate(cx - p[0] * k, cy - p[1] * k).scale(k);
        this.svg.transition().duration(md(900)).call(this.zoomBehavior.transform, t)
            .on('end', () => this.renderFlows());
    },

    // An economy is selected: frame the economy and all its drawn partners (no partner outside the frame).
    frameFlows(iso, pad = 28) {
        if (!this.zoomBehavior) return;
        const isos = new Set([iso, ...(STATE.filteredData || []).flatMap(d => [d.e, d.i])]);
        const pts = [...isos].map(i => STATE.countryCoords[i]).filter(Boolean).map(c => this.projection(c)).filter(Boolean);
        if (!pts.length) return;
        const [x0, x1] = d3.extent(pts, p => p[0]), [y0, y1] = d3.extent(pts, p => p[1]);
        const [zx, zy, zw, zh] = this.zoneCentre();
        const k = Math.max(1, Math.min(4, Math.min((zw - 2 * pad) / Math.max(1, x1 - x0), (zh - 2 * pad) / Math.max(1, y1 - y0))));
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        let tx = zx - cx * k, ty = zy - cy * k;
        if (k === 1) { tx = 0; ty = 0; }
        this.svg.transition().duration(md(900)).call(this.zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(k))
            .on('end', () => this.renderFlows());
    },

    // Phones: zoom to the bounding box of the drawn flows (the whole world is a thin strip there)
    fitFlows(pad = 20) {
        if (!this.zoomBehavior || !isPhone()) return;
        const pts = (STATE.filteredData || []).flatMap(d => [STATE.countryCoords[d.e], STATE.countryCoords[d.i]]).filter(Boolean).map(c => this.projection(c)).filter(Boolean);
        if (pts.length < 2) return;
        const [x0, x1] = d3.extent(pts, p => p[0]), [y0, y1] = d3.extent(pts, p => p[1]);
        const [zx, zy, zw, zh] = this.zoneCentre();
        const k = Math.max(1.2, Math.min(3, Math.min((zw - 2 * pad) / Math.max(1, x1 - x0), (zh - 2 * pad) / Math.max(1, y1 - y0))));
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const t = d3.zoomIdentity.translate(zx - cx * k, zy - cy * k).scale(k);
        this.svg.transition().duration(md(700)).call(this.zoomBehavior.transform, t)
            .on('end', () => this.renderFlows());   // place labels again for the new view
    },

    zoomToRegion(regionName) {
        if (!this.zoomBehavior) return;
        const config = RegionConfig.regions[regionName];
        if (!config) return;
        if (regionName === 'Global') {
            this.svg.transition().duration(md(900)).call(this.zoomBehavior.transform, d3.zoomIdentity);
            return;
        }
        const p = this.projection(config.center);
        if (!p) return;
        const k = Math.max(0.8, config.scale * 0.9);
        const [cx, cy] = this.zoneCentre();
        const t = d3.zoomIdentity.translate(cx - p[0] * k, cy - p[1] * k).scale(k);
        this.svg.transition().duration(md(1000)).call(this.zoomBehavior.transform, t);
    },

    // Zoom to a [lon, lat] centre with scale k (used by presets).
    zoomTo(center, scale, duration = 1000) {
        if (!this.zoomBehavior) return;
        const p = this.projection(center);
        if (!p) return;
        const k = Math.max(0.8, scale);
        const t = d3.zoomIdentity.translate(this.width / 2 - p[0] * k, this.height / 2 - p[1] * k).scale(k);
        this.svg.transition().duration(md(duration)).call(this.zoomBehavior.transform, t);
    },

    zoomBy(f) {
        if (!this.zoomBehavior) return;
        this.svg.transition().duration(md(250)).call(this.zoomBehavior.scaleBy, f);
    },

    // ── Static map (land polygons)
    _fill(d) {
        const iso = isoOf(d);
        return iso && this._noData.has(iso) ? 'nodata' : null;
    },

    renderStaticMap() {
        if (!STATE.geoData || !this.g) return;
        const lands = drawBase(this.g, this.path, { p: P, k: d3.zoomTransform(this.svg.node()).k, fillOf: d => this._fill(d), hit: d => !!STATE.eco[isoOf(d)] });
        lands.on('mouseover', (event, d) => {
            const iso = isoOf(d);
            if (!iso || !STATE.eco[iso]) return;
            this._hoverOutline(iso);
        }).on('mouseout', () => this._hoverOutline(null))
            .on('click', (event, d) => {
                const iso = isoOf(d);
                if (iso && STATE.eco[iso]) {
                    event.stopPropagation();
                    document.dispatchEvent(new CustomEvent('bm:country-click', { detail: iso }));
                }
            });
        // the outlines are drawn in the shared canonical units (inside g.base-geo), so they survive a new projection
        const geo = this.g.select('.land-layer').select('.base-geo');
        if (geo.select('.sel-outline').empty()) {
            geo.append('path').attr('class', 'sel-outline');
            geo.append('path').attr('class', 'hover-outline');
        }
        this._drawSel();
    },

    // Economies that did not report for the year (neither exports nor imports): hatched "no data".
    setNoData(set) {
        const next = set || new Set();
        const same = next.size === this._noData.size && [...next].every(iso => this._noData.has(iso));
        this._noData = next;
        if (!this.g || same) return;   // render() calls this on every change; the fills only change with the year
        this.g.selectAll('path.land').attr('fill', d => landFill(d, x => this._fill(x), P));
    },

    _featuresOf(iso) {
        const group = new Set([iso]);
        if (iso === 'CHN') ['TWN', 'HKG', 'MAC'].forEach(x => group.add(x));   // UNCTAD map convention: shaded with China on hover
        return (STATE.geoData?.features || []).filter(f => group.has(isoOf(f)));
    },
    // Outline path of an economy. Building it walks the whole polygon (thousands of points for the large ones) and
    // was repeated on every mouse-over; the string is projected once, in canonical units, and shared (baseMap.js).
    _outlineD(iso, grouped) {
        if (!iso) return null;
        return outlineD(`${grouped ? 'g' : 's'}:${iso}`, grouped ? this._featuresOf(iso) : (STATE.geoData?.features || []).filter(f => isoOf(f) === iso));
    },
    _hoverOutline(iso) {
        if (!this.g) return;
        this.g.select('.hover-outline').attr('d', this._outlineD(iso, true));
    },
    _drawSel() {
        if (!this.g) return;
        this.g.select('.sel-outline').attr('d', this._outlineD(this.focusedIso, false));
    },

    // ── Flows
    _dash(widthPx, k = 1) {
        const a = Math.max(4, widthPx * 2.2), b = Math.max(3, widthPx * 1.4);
        return `${a / k},${b / k}`;
    },

    // Estimates (estimated mode only): round dots, clearly different from the dagger dashes.
    _dot(widthPx, k = 1) {
        return `${0.01 / k},${Math.max(3, widthPx * 1.9) / k}`;
    },

    _arcEnds(d) {
        const s = STATE.countryCoords[d.e], t = STATE.countryCoords[d.i];
        if (!s || !t) return null;
        const p1 = this.projection(s), p2 = this.projection(t);
        return p1 && p2 ? [p1, p2] : null;
    },

    _arcD(d) {
        const ends = this._arcEnds(d);
        return ends ? arcD(ends[0], ends[1], 1.3) : null;
    },

    renderFlows() {
        if (!this.g) return;
        const flows = STATE.filteredData || [];
        const val = d => flowVal(d);
        const isEst = d => this._isEst ? this._isEst(d) : false;
        const k = this.svg ? d3.zoomTransform(this.svg.node()).k : 1;
        const col = fc => cssVar(`--flow-${fc}`) || cssVar('--grey');

        let flowLayer = this.g.select('.flow-layer');
        if (flowLayer.empty()) flowLayer = this.g.append('g').attr('class', 'flow-layer');
        let headLayer = this.g.select('.head-layer');
        if (headLayer.empty()) headLayer = this.g.append('g').attr('class', 'head-layer');
        let nodeLayer = this.g.select('.node-layer');
        if (nodeLayer.empty()) nodeLayer = this.g.append('g').attr('class', 'node-layer');
        let labelLayer = this.g.select('.label-layer');
        if (labelLayer.empty()) labelLayer = this.g.append('g').attr('class', 'label-layer');

        const visible = flows.filter(d => STATE.countryCoords[d.e] && STATE.countryCoords[d.i]);
        const vmax = d3.max(visible, val) || 1;
        const maxEdge = Math.max(Math.min(this.width * 0.0085, 9), 2);
        const widthScale = d3.scaleSqrt().domain([0, vmax]).range([0.8, maxEdge]).clamp(true);
        this._widthScale = widthScale;
        const key = d => `${d.e}|${d.i}`;

        // geometry of every drawn arc, for the arrowheads (computed, not measured on the DOM)
        this._geom = new Map();
        visible.forEach(d => { const ends = this._arcEnds(d); if (ends) this._geom.set(key(d), arcGeom(ends[0], ends[1], 1.3)); });

        // --- arcs. Widths and dashes are in screen pixels (vector-effect: non-scaling-stroke), so a zoom or a camera
        // glide does not touch them. Leaving arcs fade out on their own (they are not joined again: E5); colours,
        // widths and opacity tween together (E3); an arc that changes between solid and dashed dips out and back.
        const D = md(600), ease = EASE.out;
        const arcs = flowLayer.selectAll('.trade-arc:not(.exiting)').data(visible, key);
        leave(arcs.exit().classed('exiting', true).attr('id', null).style('pointer-events', 'none'), MS.micro + 150);
        const arcsEnter = arcs.enter().append('path')
            .attr('class', 'trade-arc')
            .attr('vector-effect', 'non-scaling-stroke')
            .style('mix-blend-mode', 'multiply')
            .style('opacity', 0)
            .on('mouseover', (event, d) => document.dispatchEvent(new CustomEvent('bm:arc-hover', { detail: { event, flow: d } })))
            .on('mousemove', (event, d) => document.dispatchEvent(new CustomEvent('bm:arc-hover', { detail: { event, flow: d } })))
            .on('mouseout', () => document.dispatchEvent(new CustomEvent('bm:hoverend')))
            .on('click', (event, d) => {
                event.stopPropagation();
                document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e: d.e, i: d.i } }));
            });
        const dashOf = d => (isEst(d) ? this._dot(widthScale(val(d))) : d.src === 'm' ? this._dash(widthScale(val(d))) : null);
        const typeOf = d => (isEst(d) ? 'est' : d.src === 'm' ? 'dag' : 'x');
        arcsEnter.attr('stroke', d => col(d.fc)).attr('stroke-width', d => widthScale(val(d))).property('__type', typeOf);
        const merged = arcsEnter.merge(arcs)
            .attr('id', d => `arc-${d.e}-${d.i}`)
            .classed('dagger', d => d.src === 'm' && !isEst(d))
            .classed('est', d => isEst(d))
            .attr('data-key', key)
            .attr('data-original-width', d => widthScale(val(d)))
            .attr('d', d => this._arcD(d))
            .attr('stroke-dasharray', dashOf);
        // opacity has its own transition ('op'), shared with setHighlight: a highlight made while the flows are still
        // settling replaces their fade, and does not stop the width / colour tween
        merged.transition().duration(D).ease(ease)
            .attr('stroke-width', d => widthScale(val(d)))
            .attr('stroke', d => col(d.fc));
        merged.transition('op').duration(D).ease(ease).style('opacity', d => this._arcOpacity(d));
        // solid <-> dashed (the exporter's report replaces the importer's, or the reverse): a short dip (the
        // transition above starts from this opacity on its first frame)
        if (D) arcs.filter(function (d) { return this.__type !== typeOf(d); }).style('opacity', 0.1);
        merged.property('__type', typeOf);
        merged.sort((a, b) => val(a) - val(b)); // big arcs on top

        // --- nodes: economies in the drawn flows (+ the selected one), sized by scope totals
        const stats = STATE.nodeStats || {};
        const nodeSet = new Set(visible.flatMap(d => [d.e, d.i]));
        if (STATE.selectedCountry) nodeSet.add(STATE.selectedCountry);
        const nodesArr = [...nodeSet].filter(iso => STATE.countryCoords[iso]);
        const tmax = d3.max(nodesArr, iso => stats[iso]?.total || 0) || 1;
        const maxR = Math.max(Math.min(this.width * 0.009, 13), 3);
        const rScale = d3.scaleSqrt().domain([0, tmax]).range([2.2, maxR]).clamp(true);
        const netColor = d3.scaleLinear().domain([-1, -0.15, 0, 0.15, 1])
            .range([cssVar('--net-imp'), cssVar('--net-imp-light'), cssVar('--net-mid'), cssVar('--net-exp-light'), cssVar('--net-exp')])
            .interpolate(d3.interpolateHcl).clamp(true);
        const netShare = iso => {
            const s = stats[iso];
            return s && s.total ? (s.exp - s.imp) / s.total : 0;
        };
        const flagged = this._flagged || new Set();
        const proj = iso => this.projection(STATE.countryCoords[iso]) || [-999, -999];

        const nodes = nodeLayer.selectAll('.country-node:not(.exiting)').data(nodesArr, d => d);
        nodes.exit().classed('exiting', true).style('pointer-events', 'none').interrupt().interrupt('op')
            .transition().duration(md(400)).attr('r', 0).on('end interrupt', function () { this.remove(); });
        const nodesEnter = nodes.enter().append('circle')
            .attr('class', 'country-node')
            .attr('stroke', cssVar('--white'))
            .on('mouseover', (event, d) => document.dispatchEvent(new CustomEvent('bm:country-hover', { detail: { event, iso: d } })))
            .on('mouseout', () => document.dispatchEvent(new CustomEvent('bm:hoverend')))
            .on('click', (event, d) => { event.stopPropagation(); document.dispatchEvent(new CustomEvent('bm:country-click', { detail: d })); });
        nodesEnter.merge(nodes)
            .attr('data-original-radius', d => rScale(stats[d]?.total || 0))
            .attr('cx', d => proj(d)[0]).attr('cy', d => proj(d)[1])
            .transition().duration(D).ease(ease)
            .attr('r', d => rScale(stats[d]?.total || 0) / k)
            .attr('fill', d => netColor(netShare(d)))
            .attr('stroke-width', 1 / k)
            .style('opacity', 1);

        const fl = nodeLayer.selectAll('.node-flag').data(nodesArr.filter(d => flagged.has(d)), d => d);
        fl.exit().remove();
        fl.enter().append('circle').attr('class', 'node-flag')
            .attr('fill', `url(#${P}-flag)`).style('pointer-events', 'none')
            .merge(fl)
            .attr('data-original-radius', d => rScale(stats[d]?.total || 0))
            .attr('cx', d => proj(d)[0]).attr('cy', d => proj(d)[1])
            .attr('r', d => rScale(stats[d]?.total || 0) / k);

        this._nodeRadius = iso => rScale(stats[iso]?.total || 0);

        // --- arrowheads: they follow their line (E1): they fade in and out with it, and their size and the place of
        // the tip (the node edge) tween with the line's width and the node's radius. No DOM reads: arcGeom.
        const heads = headLayer.selectAll('.arc-head').data(visible, key);
        leave(heads.exit().attr('class', 'arc-head-out').style('pointer-events', 'none'), MS.micro + 150);
        const headsEnter = heads.enter().append('path').attr('class', 'arc-head').style('opacity', 0);
        const self = this;
        const rEndOf = d => (this._nodeRadius ? this._nodeRadius(d.i) : 3) + 1;
        const hm = headsEnter.merge(heads)
            .attr('data-key', key)
            .attr('data-original-width', d => widthScale(val(d)));
        headsEnter.attr('fill', d => col(d.fc)).each(function (d) {
            this.__w = widthScale(val(d)); this.__r = rEndOf(d);
            placeHeadGeom(this, self._geom.get(key(d)), this.__w, this.__r, k, false, true);
        });
        hm.transition('op').duration(D).ease(ease).style('opacity', d => this._arcOpacity(d));
        hm.transition().duration(D).ease(ease)
            .attr('fill', d => col(d.fc))
            .tween('head', function (d) {
                const w0 = this.__w ?? widthScale(val(d)), w1 = widthScale(val(d)), r0 = this.__r ?? rEndOf(d), r1 = rEndOf(d), g = self._geom.get(key(d)), el = this;
                return t => {
                    el.__w = w0 + (w1 - w0) * t; el.__r = r0 + (r1 - r0) * t;
                    placeHeadGeom(el, g, el.__w, el.__r, self._k(), false, true);
                };
            });

        // --- labels: the largest economies only (and the selected one)
        const ranked = nodesArr.slice().sort((a, b) => (stats[b]?.total || 0) - (stats[a]?.total || 0));
        if (STATE.selectedCountry) ranked.unshift(STATE.selectedCountry);
        const maxLabels = isPhone() ? 5 : this.width < 760 ? 7 : 10;
        // Greedy placement: biggest nodes first, skip labels that would overlap one already placed.
        const fs = 10.5 / Math.sqrt(k);
        const boxes = [];
        const labelSet = new Set();
        const side = {};
        const zt = this.svg ? d3.zoomTransform(this.svg.node()) : d3.zoomIdentity;
        const zz = this.zone();
        const inView = b => zt.applyX(b[0]) >= zz.left && zt.applyX(b[2]) <= this.width - zz.right && zt.applyY(b[1]) >= zz.top - 6 && zt.applyY(b[3]) <= this.height - zz.bottom + 6;
        for (const iso of ranked) {
            if (labelSet.size >= maxLabels) break;
            if (labelSet.has(iso)) continue;
            const pt = proj(iso);
            const text = STATE.countryNames[iso] || iso;
            const r = rScale(stats[iso]?.total || 0) / k;
            const w = text.length * fs * 0.56, y0 = pt[1] - fs * 0.6;
            const right = [pt[0] + r + 4, y0, pt[0] + r + 4 + w, y0 + fs * 1.25];
            const left = [pt[0] - r - 4 - w, y0, pt[0] - r - 4, y0 + fs * 1.25];
            const free = b => !boxes.some(q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
            const b = [right, left].find(c => inView(c) && free(c));
            if (!b) continue;
            side[iso] = b === right ? 'r' : 'l';
            boxes.push(b);
            labelSet.add(iso);
        }
        // E2: labels that leave fade out; new ones fade in once the flows have mostly settled; kept ones stay
        const labels = labelLayer.selectAll('.map-label:not(.exiting)').data([...labelSet], d => d);
        leave(labels.exit().classed('exiting', true), MS.micro);
        const labelsEnter = labels.enter().append('text').attr('class', 'map-label').style('opacity', md(1) ? 0 : 1);
        labelsEnter.transition().delay(md(MS.ui)).duration(md(MS.ui)).ease(ease).style('opacity', 1);
        labelsEnter.merge(labels)
            .text(d => STATE.countryNames[d] || d)
            .classed('sel', d => d === STATE.selectedCountry)
            .attr('font-weight', d => (d === STATE.selectedCountry ? 800 : 600))
            .attr('text-anchor', d => (side[d] === 'l' ? 'end' : 'start'))
            .attr('x', d => proj(d)[0] + (side[d] === 'l' ? -1 : 1) * (rScale(stats[d]?.total || 0) / k + 4))
            .attr('y', d => proj(d)[1] + 4)
            .attr('font-size', (10.5 / Math.sqrt(k)) + 'px')
            .attr('stroke-width', 3 / k);

        if (this.highlightKey) this.setHighlight(this.highlightKey);
        if (this.focusedIso) this._renderParticles(this.focusedIso, visible);
    },

    _k() { return this.svg ? d3.zoomTransform(this.svg.node()).k : 1; },

    _arcOpacity(d) {
        if (this.highlightKey) return `${d.e}|${d.i}` === this.highlightKey ? 0.95 : 0.08;
        return 0.75;
    },

    // Arrowhead at the importer end; the tip stops at the node edge. Runs on every zoom frame, so it reads nothing
    // from the DOM: the arc geometry was computed in renderFlows. `shape` = also (re)draw the outline.
    _placeHeads(k = 1, shape = false) {
        if (!this.g || !this._geom) return;
        const self = this;
        this.g.selectAll('.arc-head').each(function (d) {
            const wpx = this.__w ?? (+this.getAttribute('data-original-width') || 1);
            const rEnd = this.__r ?? (self._nodeRadius ? self._nodeRadius(d.i) : 3) + 1;
            placeHeadGeom(this, self._geom.get(`${d.e}|${d.i}`), wpx, rEnd, k, false, shape);
        });
    },

    // Highlight one corridor (from the ranked list); null clears.
    setHighlight(key) {
        this.highlightKey = key;
        if (!this.g) return;
        // the 'op' transition: it replaces a running fade of renderFlows, not its width / colour tween
        this.g.selectAll('.trade-arc:not(.exiting), .arc-head').transition('op').duration(md(250))
            .style('opacity', d => this._arcOpacity(d));
        if (key) {
            this.g.select(`#arc-${key.replace('|', '-')}`).raise();
        }
        this._renderTwin(key);
    },

    // "Double entry" on the map: the drawn arc is the exporter's report; the importer's report of the
    // same flow is drawn beside it as an outlined strand (same scale), bowing a little more.
    _renderTwin(key) {
        if (!this.g) return;
        this.g.selectAll('.twin-layer').remove();
        if (!key || STATE.basis === 'estimated') return;
        const d = (STATE.filteredData || []).find(f => `${f.e}|${f.i}` === key);
        if (!d || d.src !== 'x') return;
        const isW = STATE.metric === 'weight';
        const m = isW ? d.mw : d.mv, x = isW ? d.xw : d.xv;
        if (!(m > 0) || !(x > 0) || Math.abs(m / x - 1) <= 0.1 || !this._widthScale) return;
        const s = STATE.countryCoords[d.e], t = STATE.countryCoords[d.i];
        const p1 = this.projection(s), p2 = this.projection(t);
        if (!p1 || !p2) return;
        const k = this._k();
        const pathD = arcD(p1, p2, 0.95);          // tighter radius = more bow than the main arc (1.3)
        const geom = arcGeom(p1, p2, 0.95);        // its length and midpoint, computed (no measuring of the DOM)
        const w = this._widthScale(m);
        const layer = this.g.insert('g', '.node-layer').attr('class', 'twin-layer').style('pointer-events', 'none');
        layer.append('path').attr('d', pathD).attr('class', 'twin-outer').attr('vector-effect', 'non-scaling-stroke')
            .attr('stroke-width', w + 2.4).attr('fill', 'none');
        layer.append('path').attr('d', pathD).attr('class', 'twin-inner').attr('vector-effect', 'non-scaling-stroke')
            .attr('stroke-width', Math.max(0.6, w - 0.8)).attr('fill', 'none');
        const rEnd = (this._nodeRadius ? this._nodeRadius(d.i) : 3) + 1;
        const head = layer.append('path').attr('class', 'twin-head').attr('fill', 'none').attr('stroke-width', 1.8 / k).node();
        placeHeadGeom(head, geom, w + 1, rEnd, k, true);
        const mid = geom ? arcPoint(geom, geom.L / 2) : p1;
        layer.append('text').attr('class', 'twin-label').attr('x', mid[0]).attr('y', mid[1] - (w + 6) / k)
            .attr('text-anchor', 'middle').attr('font-size', 10.5 / Math.sqrt(k)).attr('stroke-width', 3 / k)
            .text(`importer’s report ${fmtMetric(m)} · exporter’s ${fmtMetric(x)}`);
    },

    setFlagged(set) { this._flagged = set; },
    setEstTest(fn) { this._isEst = fn; },

    // ── Focus (selected economy): a pale blue wash with a navy hairline (Non-plastic)
    setFocus(iso) {
        this.focusedIso = iso;
        this._drawSel();
    },

    clearFocus() {
        this.focusedIso = null;
        this._drawSel();
        this._clearParticles();
    },

    // Moving dots along the top 25 corridors of the selected country (SHC); none under reduced motion.
    _renderParticles(iso, visible) {
        this._clearParticles();
        if (!this.gfx || prefersReducedMotion()) return;
        const val = d => flowVal(d);
        const top = (visible || []).filter(d => d.e === iso || d.i === iso)
            .sort((a, b) => val(b) - val(a)).slice(0, 25);
        if (!top.length) return;
        const maxV = val(top[0]) || 1;
        const layer = this.gfx.append('g').attr('class', 'particle-layer').style('pointer-events', 'none');
        const white = cssVar('--white');
        top.forEach(d => {
            const intensity = Math.min(1, val(d) / maxV);
            const count = 1 + Math.round(intensity * 2);
            const dur = (5 - intensity * 2.3).toFixed(2) + 's';
            for (let n = 0; n < count; n++) {
                const p = layer.append('circle').attr('class', 'trade-particle')
                    .attr('r', 1.5).attr('fill', cssVar(`--flow-${d.fc}`) || cssVar('--un-blue'))
                    .attr('stroke', white).attr('stroke-width', 0.4).attr('opacity', 0.9);
                p.append('animateMotion').attr('dur', dur).attr('repeatCount', 'indefinite')
                    .attr('rotate', 'auto').attr('begin', (n / count * parseFloat(dur)).toFixed(2) + 's')
                    .append('mpath').attr('href', `#arc-${d.e}-${d.i}`);
            }
        });
    },

    _clearParticles() { if (this.gfx) this.gfx.selectAll('.particle-layer').remove(); },
};
