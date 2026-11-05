import * as d3 from 'd3';
import { STATE } from './config.js';

// The UN base map, shared by the explorer map (src/map.js) and the story map (src/storyMap.js).
// Adapted from the Non-plastic dashboard (UNCTAD, ../Non-plastic/dashboard/js/map.js), same team, same rules:
//   Equal Earth; the UN TopoJSON (public/assets/worldmap-economies-4326.topo.json) is shifted back by
//   +11.314 deg in DataLoader, so it is projected without rotation and the graticule is in real coordinates;
//   white borders (plain / dashed / dotted / dash-dotted) for borders whose status is not final; Aksai Chin
//   hatched; "no data" is a hatch so it can never be read as a low value; a sphere outline and a faint graticule.
// Colours are CSS tokens (src/styles/tokens.css), read at run time.

// Colour tokens never change at run time (src/styles/tokens.css, :root), so each one is read once. Reading a
// computed style for every arc, node and land polygon forced a style recalculation each time.
const _cssVars = new Map();
export const cssVar = (name) => {
    let v = _cssVars.get(name);
    if (v === undefined) {
        v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        if (v) _cssVars.set(name, v);   // an empty answer (stylesheet not applied yet) is not kept
    }
    return v;
};

// TopoJSON geometry codes (UN M49) -> ISO3. Used ONLY for the map polygons; trade data arrive in ISO3.
export const ISO_MAP = {
    "4": "AFG", "8": "ALB", "12": "DZA", "24": "AGO", "32": "ARG", "51": "ARM", "36": "AUS",
    "40": "AUT", "31": "AZE", "44": "BHS", "48": "BHR", "50": "BGD", "52": "BRB", "112": "BLR",
    "56": "BEL", "84": "BLZ", "204": "BEN", "64": "BTN", "68": "BOL", "70": "BIH", "72": "BWA",
    "76": "BRA", "96": "BRN", "100": "BGR", "854": "BFA", "108": "BDI", "116": "KHM", "120": "CMR",
    "124": "CAN", "140": "CAF", "148": "TCD", "152": "CHL", "156": "CHN", "170": "COL", "174": "COM",
    "178": "COG", "180": "COD", "188": "CRI", "384": "CIV", "191": "HRV", "192": "CUB", "196": "CYP",
    "203": "CZE", "208": "DNK", "262": "DJI", "214": "DOM", "218": "ECU", "818": "EGY", "222": "SLV",
    "226": "GNQ", "232": "ERI", "233": "EST", "231": "ETH", "242": "FJI", "246": "FIN", "250": "FRA",
    "266": "GAB", "270": "GMB", "268": "GEO", "276": "DEU", "288": "GHA", "300": "GRC", "304": "GRL",
    "308": "GRD", "320": "GTM", "324": "GIN", "624": "GNB", "328": "GUY", "332": "HTI", "340": "HND",
    "344": "HKG", "348": "HUN", "352": "ISL", "356": "IND", "360": "IDN", "364": "IRN", "368": "IRQ",
    "372": "IRL", "376": "ISR", "380": "ITA", "388": "JAM", "392": "JPN", "400": "JOR", "398": "KAZ",
    "404": "KEN", "408": "PRK", "410": "KOR", "414": "KWT", "417": "KGZ", "418": "LAO", "428": "LVA",
    "422": "LBN", "426": "LSO", "430": "LBR", "434": "LBY", "440": "LTU", "442": "LUX", "807": "MKD",
    "450": "MDG", "454": "MWI", "458": "MYS", "462": "MDV", "466": "MLI", "470": "MLT", "478": "MRT",
    "480": "MUS", "484": "MEX", "498": "MDA", "496": "MNG", "499": "MNE", "504": "MAR", "508": "MOZ",
    "104": "MMR", "516": "NAM", "524": "NPL", "528": "NLD", "540": "NCL", "554": "NZL", "558": "NIC",
    "562": "NER", "566": "NGA", "578": "NOR", "512": "OMN", "586": "PAK", "591": "PAN", "598": "PNG",
    "600": "PRY", "604": "PER", "608": "PHL", "616": "POL", "620": "PRT", "630": "PRI", "634": "QAT",
    "642": "ROU", "643": "RUS", "646": "RWA", "682": "SAU", "686": "SEN", "688": "SRB", "694": "SLE",
    "702": "SGP", "703": "SVK", "705": "SVN", "90": "SLB", "706": "SOM", "710": "ZAF", "728": "SSD",
    "724": "ESP", "144": "LKA", "729": "SDN", "740": "SUR", "748": "SWZ", "752": "SWE", "756": "CHE",
    "760": "SYR", "158": "TWN", "762": "TJK", "834": "TZA", "764": "THA", "626": "TLS", "768": "TGO",
    "780": "TTO", "788": "TUN", "792": "TUR", "795": "TKM", "800": "UGA", "804": "UKR", "784": "ARE",
    "826": "GBR", "840": "USA", "858": "URY", "860": "UZB", "548": "VUT", "862": "VEN", "704": "VNM",
    "732": "ESH", "887": "YEM", "894": "ZMB", "716": "ZWE",
};
export const isoOf = (f) => (f && f.properties ? ISO_MAP[parseInt(f.properties.code, 10)] || null : null);

// d3 needs clockwise outer rings; reverse anything larger than a hemisphere (Non-plastic map.js)
function rewind(f) {
    const g = f.geometry;
    if (!g) return f;
    const fix = poly => (d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI ? poly.map(r => r.slice().reverse()) : poly);
    if (g.type === 'Polygon') g.coordinates = fix(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(fix);
    return f;
}
let _rewound = false;
export function features() {
    if (!_rewound && STATE.geoData) { STATE.geoData.features.forEach(rewind); _rewound = true; }
    return STATE.geoData ? STATE.geoData.features : [];
}

// ── The base map is projected once (perf v6, docs/design/PERF_V6.md)
// Projecting the 1 MB UN map (d3 resampling and clipping of every ring, then 1.8 MB of path text) took 100-250 ms
// on an ordinary laptop, and it was done again on every story chapter, every question page and every change of the
// explorer's free zone. Every map here is Equal Earth without rotation, fitted with scale and translate only, so a
// map at scale s and translate t is the same drawing as the canonical one (scale S0, translate 0) scaled by s / S0
// and moved by t: the paths are projected once, shared by all maps, and each map only sets a transform on its
// `g.base-geo`. Strokes there are non-scaling (CSS vector-effect), the hatches are compensated (setBase), so the
// pixels are the same. S0 is larger than the scale of any common screen, so the drawing is never coarser than
// before (d3 resamples curves to about 0.7 px of the scale they are projected at).
export const S0 = 600;
let _canon = null;
export function canon() {
    if (_canon || !STATE.geoData) return _canon;
    const path = d3.geoPath(d3.geoEqualEarth().scale(S0).translate([0, 0]));
    const feats = features();
    const borders = {};
    [['plain', 'border-plain'], ['dashed', 'border-dashed'], ['dotted', 'border-dotted'], ['dashDotted', 'border-dash-dotted']].forEach(([k, cls]) => {
        const fc = STATE.borderLayers?.[k];
        if (fc) borders[cls] = path(fc);
    });
    _canon = {
        path,
        land: new Map(feats.map(f => [f, path(f)])),
        borders,
        lod: new Map([[0, borders['border-plain']]]),   // canonical eps -> simplified plain border
        parsed: null,                                     // the plain border read into numbers (levelJob)
        tiles: new Map(),                                 // canonical eps -> the plain border in tiles (zoomed in)
        outline: new Map(),                               // outlines of economies (hover, selection)
    };
    return _canon;
}
// Outline of a set of features in canonical units (drawn inside g.base-geo), cached by key.
export function outlineD(key, feats) {
    const C = canon();
    if (!C || !key) return null;
    let d = C.outline.get(key);
    if (d === undefined) { d = feats.length ? C.path({ type: 'FeatureCollection', features: feats }) : null; C.outline.set(key, d); }
    return d;
}
const _hatchRot = new WeakMap();

// Hatches: "no data" (warm grey lines on off-white), Aksai Chin, and flagged weights on nodes.
export function makeDefs(svg, p) {
    const defs = svg.append('defs');
    const hatch = (id, bg, line, sw, size = 5, rot = 45) => {
        const pt = defs.append('pattern').attr('id', id).attr('width', size).attr('height', size)
            .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', `rotate(${rot})`);
        _hatchRot.set(pt.node(), rot);
        if (bg) pt.append('rect').attr('width', size).attr('height', size).attr('fill', bg);
        pt.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', size).attr('stroke', line).attr('stroke-width', sw);
    };
    hatch(`${p}-nodata`, cssVar('--nodata'), cssVar('--nodata-line'), 1.3);
    hatch(`${p}-aksai`, null, cssVar('--grey-text'), 1.1, 4, 60);
    hatch(`${p}-flag`, null, cssVar('--white'), 1.2, 3);
    hatch(`${p}-status`, cssVar('--un-blue-lightest'), cssVar('--un-blue-light'), 1.4);
    return defs;
}

// Level of detail of the plain border line. It is one path of about 50,000 points (790 KB of text) and it was
// the most expensive element to repaint while the map is zoomed, panned or hovered (measured: about half of the
// time). It is drawn with the points that are at least `eps` map units (= pixels at zoom 1) apart, and with every
// point once the map is zoomed in: the error on screen stays under about 0.75 px at any zoom (eps x the top of
// each zoom band). Measured on the 1500 x 900 map: 5 of 1.35 million pixels differ from the full line.
const BORDER_LOD = [[1.5, 0.5], [3, 0.25], [6, 0.12], [Infinity, 0]];
const PATH_POINT = /([ML])(-?[\d.]+(?:e[-+]?\d+)?),(-?[\d.]+(?:e[-+]?\d+)?)/g;

// Thin out a path made of M/L commands (as d3.geoPath writes lines): keeps the first and the last point of every
// piece and the points that are at least eps from the previous kept point. Paths with Z are returned unchanged.
// The path is read once into numbers (and the place of each point's text); each level is then one loop that copies
// the kept points' text, so the output is the same text as before, about five times faster than a regex pass.
// The work is written as resumable steps (generators): a step that is needed now runs to its end at once
// (`runJob`), the others run in slices of idle time (`idleJob`), so none of it becomes a long task.
const SLICE = 4000;   // points per resumable step
function* parseGen(d) {
    let n = 0;
    for (let i = 0; i < d.length; i++) { const c = d.charCodeAt(i); if (c === 77 || c === 76) n++; if ((i & 0x3ffff) === 0x3ffff) yield; }   // M, L
    const P = { n, x: new Float64Array(n), y: new Float64Array(n), m: new Uint8Array(n), a: new Int32Array(n), b: new Int32Array(n) };
    let k = 0;
    const rx = new RegExp(PATH_POINT.source, 'g');
    for (let mm; (mm = rx.exec(d)) && k < n; k++) {
        P.m[k] = mm[1] === 'M' ? 1 : 0;
        P.x[k] = +mm[2]; P.y[k] = +mm[3];
        P.a[k] = mm.index + 1; P.b[k] = mm.index + mm[0].length;
        if (k % SLICE === SLICE - 1) yield;
    }
    P.n = k;
    return P;
}
// The level eps of a parsed path, as one text and, for the tiles (setBorderDetail), as texts per tile. Every piece
// starts with M, which every level keeps, so a piece belongs to the tile of its first point at every level.
function* levelGen(d, P, eps, tiles) {
    const e2 = eps * eps, out = [], cells = tiles ? new Map() : null;
    let lx = 0, ly = 0, tail = -1, cell = null;
    const put = (c, txt) => { out.push(c, txt); if (cell) cell.push(c, txt); };
    for (let k = 0; k < P.n; k++) {
        const x = P.x[k], y = P.y[k];
        if (P.m[k]) {
            if (tail >= 0) { put('L', d.slice(P.a[tail], P.b[tail])); tail = -1; }
            if (cells) { const key = `${Math.floor(x / TILE)}|${Math.floor(y / TILE)}`; cell = cells.get(key); if (!cell) cells.set(key, cell = []); }
            put('M', d.slice(P.a[k], P.b[k]));
            lx = x; ly = y;
        } else if (!eps || (x - lx) * (x - lx) + (y - ly) * (y - ly) >= e2) {
            put('L', d.slice(P.a[k], P.b[k]));
            lx = x; ly = y; tail = -1;
        } else tail = k;
        if (k % SLICE === SLICE - 1) yield;
    }
    if (tail >= 0) put('L', d.slice(P.a[tail], P.b[tail]));
    return { d: out.join(''), tiles: cells ? [...cells].map(([id, a]) => ({ id, d: a.join('') })) : null };
}
const _parsed = new Map();
function parsePath(d) {
    let P = _parsed.get(d);
    if (!P) { P = drain(parseGen(d)); if (_parsed.size > 4) _parsed.clear(); _parsed.set(d, P); }
    return P;
}
export function simplifyPath(d, eps) {
    if (!eps || d.indexOf('Z') >= 0) return d;
    return drain(levelGen(d, parsePath(d), eps, false)).d;
}

// ── resumable jobs: run now, or in slices of idle time
function drain(it) { for (;;) { const r = it.next(); if (r.done) return r.value; } }
const _jobs = new Map(), _queue = [];
let _pumping = false;
function runJob(key, make) {
    const it = _jobs.get(key) || make();
    _jobs.delete(key);
    return drain(it);
}
function idleJob(key, make) {
    if (_jobs.has(key)) return;
    _jobs.set(key, make());
    _queue.push(key);
    if (!_pumping) { _pumping = true; _idle(pump); }
}
function pump(deadline) {
    const left = () => (deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() : 8);
    while (_queue.length && left() > 3) {
        const key = _queue[0], it = _jobs.get(key);
        if (!it) { _queue.shift(); continue; }            // finished meanwhile by runJob
        const r = it.next();
        if (r.done) { _jobs.delete(key); _queue.shift(); }
    }
    if (_queue.length) _idle(pump); else _pumping = false;
}
// no timeout: the work waits for real idle time (a timeout would run it in the middle of an interaction)
const _idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : setTimeout(() => fn(null), 200));

// Set the detail of the plain border for zoom level k (layer = the selection of the land layer). While the map is
// moving (onlyCoarser) the line only gets coarser, never finer: the finer line is drawn when the map rests.
// The screen tolerance of BORDER_LOD is turned into canonical units (S0 / the map's scale) and rounded down to a
// step of LOD_STEPS, so the simplified lines are shared by every map and never coarser than BORDER_LOD asks.
const LOD_STEPS = [32, 22, 16, 11, 8, 5.6, 4, 2.8, 2, 1.4, 1, 0.7, 0.5, 0.35, 0.25, 0];
// Zoomed in (k >= TILE_K) most of the line is outside the frame, but one path is painted whole: there the line
// is drawn as tiles (its pieces grouped by where they start, TILE canonical units a side), and the browser skips
// the tiles outside the frame. The pieces and their text are the same, so the pixels are too.
const TILE_K = 3, TILE = 120;
// a level's text and its tiles are separate jobs (the tiles are only needed zoomed in, and cost more); the
// canonical parse is shared by all levels
function* levelJob(C, eps, tiles) {
    if (!C.parsed) C.parsed = yield* parseGen(C.borders['border-plain']);
    if (!tiles && !eps) { C.lod.set(0, C.borders['border-plain']); return; }
    const r = yield* levelGen(C.borders['border-plain'], C.parsed, eps, tiles);
    if (!C.lod.has(eps)) C.lod.set(eps, eps ? r.d : C.borders['border-plain']);
    if (tiles) C.tiles.set(eps, r.tiles);
}
const lodText = (C, eps) => {
    if (!C.lod.has(eps)) runJob(`lod${eps}`, () => levelJob(C, eps, false));
    return C.lod.get(eps);
};
function borderTiles(C, eps) {
    if (!C.tiles.has(eps)) runJob(`tile${eps}`, () => levelJob(C, eps, true));
    return C.tiles.get(eps);
}
export function setBorderDetail(layer, k = 1, onlyCoarser = false) {
    const el = layer.select('path.border-plain').node();
    const C = canon();
    if (!el || !C || !layer.node().__scale) return;
    const want = BORDER_LOD.find(([max]) => k < max)[1] * S0 / layer.node().__scale;
    const fine = LOD_STEPS.find(e => e <= want);
    const eps = onlyCoarser && el.__eps != null ? Math.max(fine, el.__eps) : fine;   // moving: never finer
    const tiled = k >= TILE_K;
    if (el.__eps === eps && el.__tiled === tiled) return;
    el.__eps = eps; el.__tiled = tiled;
    const host = d3.select(el.parentNode);
    let tg = host.select('g.border-tiles');
    // a path's text is written only when its level changed (the browser parses it again on every write)
    if (tiled) {
        if (tg.empty()) tg = host.insert('g', () => el.nextSibling).attr('class', 'border-tiles');
        if (tg.node().__eps !== eps) {
            tg.node().__eps = eps;
            tg.selectAll('path').data(borderTiles(C, eps), t => t.id).join('path')
                .attr('class', 'border').style('stroke-linecap', 'butt').attr('d', t => t.d);
        }
        tg.style('display', null);
        el.style.display = 'none';
    } else {
        if (!tg.empty()) tg.style('display', 'none');
        if (el.__dEps !== eps) { el.__dEps = eps; el.setAttribute('d', lodText(C, eps)); }
        el.style.display = '';
    }
}

// The levels (and their tiles) that a map of this scale needs for its zoom bands are prepared in idle time, so a
// zoom or a camera move does not wait for one.
function warmBorderLod(scale) {
    const C = canon();
    if (!C || !C.borders['border-plain']) return;
    const lv = e => LOD_STEPS.find(x => x <= e * S0 / scale);
    const levels = [...new Set(BORDER_LOD.map(([, e]) => lv(e)))];
    levels.filter(e => !C.lod.has(e)).forEach(e => idleJob(`lod${e}`, () => levelJob(C, e, false)));
    levels.filter(e => !C.tiles.has(e)).forEach(e => idleJob(`tile${e}`, () => levelJob(C, e, true)));
}

// Place the canonical drawing for a map whose projection is `proj` (scale and translate of Equal Earth): the
// transform of g.base-geo, and the hatches drawn inside it (their tiles stay where and as large as they were).
function setBase(layer, geo, proj, p) {
    const s = proj.scale(), [tx, ty] = proj.translate(), f = s / S0;
    if (layer.node().__scale !== s) warmBorderLod(s);
    layer.node().__scale = s;
    const key = `${f}|${tx}|${ty}`;
    if (geo.node().__key === key) return;
    geo.node().__key = key;
    geo.attr('transform', `translate(${tx},${ty}) scale(${f})`);
    const svg = layer.node().ownerSVGElement;
    ['nodata', 'aksai', 'status'].forEach(h => {
        const pt = svg && svg.querySelector(`pattern[id="${p}-${h}"]`);
        if (pt) pt.setAttribute('patternTransform', `scale(${1 / f}) translate(${-tx},${-ty}) rotate(${_hatchRot.get(pt) ?? 45})`);
    });
}

// Draw the static layers into g. fillOf(feature) -> CSS colour or null (= land). k = current zoom (border detail).
// The paths are created once per map; later calls only move the drawing (setBase) and set the fills.
export function drawBase(g, path, { p, k = 1, fillOf = () => null, hit = () => false } = {}) {
    let layer = g.select('.land-layer');
    if (layer.empty()) layer = g.insert('g', ':first-child').attr('class', 'land-layer');
    const C = canon();
    let geo = layer.select('g.base-geo');
    if (geo.empty()) geo = layer.insert('g', ':first-child').attr('class', 'base-geo');
    const feats = features();
    if (C && !geo.node().__drawn) {
        geo.node().__drawn = true;
        geo.selectAll('path.land').data(feats, d => d.properties && d.properties.code).join('path')
            .attr('class', 'land')
            .attr('data-code', d => d.properties.code)
            .attr('d', d => C.land.get(d));
        const aks = feats.filter(f => f.properties && f.properties.code === 'C00002');
        geo.selectAll('path.aksai').data(aks).join('path').attr('class', 'aksai').style('pointer-events', 'none').attr('d', d => C.land.get(d));
        Object.entries(C.borders).forEach(([cls, d]) => geo.append('path').attr('class', `border ${cls}`).attr('d', cls === 'border-plain' ? null : d));
    }
    if (C) setBase(layer, geo, path.projection(), p);
    // the sphere and the graticule are curves that d3 resamples at the scale they are projected at: they are small
    // (60 KB), so they are drawn with this map's own projection, exactly as before
    const pk = `${path.projection().scale()}|${path.projection().translate()}`;
    if (layer.node().__pk !== pk) {
        layer.node().__pk = pk;
        layer.selectAll('path.sphere').data([{ type: 'Sphere' }]).join(e => e.insert('path', '.base-geo')).attr('class', 'sphere').attr('d', path);
        layer.selectAll('path.graticule').data([d3.geoGraticule10()]).join(e => e.insert('path', '.base-geo')).attr('class', 'graticule').attr('d', path);
    }
    // class and fill are written only where they change (a write of the same value still restyles the element)
    const lands = geo.selectAll('path.land').each(function (d) {
        const c = `land${hit(d) ? '' : ' nohit'}`, f = landFill(d, fillOf, p);
        if (this.getAttribute('class') !== c) this.setAttribute('class', c);
        if (this.getAttribute('fill') !== f) this.setAttribute('fill', f);
    });
    geo.selectAll('path.aksai').attr('fill', `url(#${p}-aksai)`);
    setBorderDetail(layer, k);
    if (STATE.countryPoints) {
        const poly = new Set(feats.map(f => String(f.properties.code)));
        const pts = STATE.countryPoints.features.filter(f => !poly.has(String(f.properties && f.properties.code)));
        layer.selectAll('circle.economy-point').data(pts, d => d.properties && d.properties.code).join('circle')
            .attr('class', 'economy-point').attr('r', 1.8)
            .attr('cx', d => (path.projection()(d.geometry.coordinates) || [])[0])
            .attr('cy', d => (path.projection()(d.geometry.coordinates) || [])[1]);
    }
    return lands;
}

export function landFill(d, fillOf, p) {
    const f = fillOf(d);
    if (f === 'nodata') return `url(#${p}-nodata)`;
    if (f === 'status') return `url(#${p}-status)`;
    return f || cssVar('--land');
}

// A curved directed line from p1 to p2 (clockwise bend, so A->B and B->A never overlap).
export function arcD(p1, p2, bend = 1.3) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const dr = Math.sqrt(dx * dx + dy * dy) * bend;
    return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
}

// The arc drawn by arcD(p1, p2, bend) is a circular arc (SVG "A" command, sweep 1, small arc), so its length and
// the point at a given distance along it can be computed. The explorer map moves its arrowheads on every zoom
// frame; measuring the path (getTotalLength / getPointAtLength) forced a layout for each arc each time.
export function arcGeom(p1, p2, bend = 1.3) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const c = Math.hypot(dx, dy);
    if (!c) return null;
    const R = c * bend;
    const half = Math.asin(Math.min(1, c / (2 * R)));
    const h = R * Math.cos(half);                       // chord midpoint to centre
    const ux = dx / c, uy = dy / c;
    const cx = (p1[0] + p2[0]) / 2 - uy * h, cy = (p1[1] + p2[1]) / 2 + ux * h;   // centre for sweep-flag 1
    return { cx, cy, R, a1: Math.atan2(p1[1] - cy, p1[0] - cx), L: 2 * half * R };
}
const arcAt = (g, s) => { const a = g.a1 + s / g.R; return [g.cx + g.R * Math.cos(a), g.cy + g.R * Math.sin(a)]; };
export const arcPoint = arcAt;   // the point at distance s along an arc of arcGeom

// Same result as placeHead() for a path made by arcD, from the geometry only (no DOM reads). `shape` = also set
// the arrowhead outline (it depends on the line width only, so zoom frames leave it alone).
export function placeHeadGeom(headEl, g, wpx, rEnd, k = 1, open = false, shape = true) {
    if (!g || !g.L) return;
    const sel = d3.select(headEl);
    if (shape) {
        const hl = Math.max(7, 4 + wpx * 1.7), hw = Math.max(3.2, hl * 0.42);
        sel.attr('d', open ? `M${-hl},${hw} L0,0 L${-hl},${-hw}` : `M0,0 L${-hl},${hw} L${-hl * 0.78},0 L${-hl},${-hw} Z`);
    }
    const tipAt = Math.max(0, g.L - rEnd / k);
    const tip = arcAt(g, tipAt), back = arcAt(g, Math.max(0, tipAt - 1 / k));
    const ang = Math.atan2(tip[1] - back[1], tip[0] - back[0]) * 180 / Math.PI;
    sel.attr('transform', `translate(${tip[0]},${tip[1]}) rotate(${ang}) scale(${1 / k})`);
}

// Arrowhead at the end of a path element; its size follows the line width with a minimum, so thin lines
// still show their direction (Jenny et al.); the tip stops at rEnd (screen px) before the end.
export function placeHead(headEl, pathEl, wpx, rEnd, k = 1, open = false) {
    if (!pathEl || !pathEl.getTotalLength) return;
    const L = pathEl.getTotalLength();
    if (!L) return;
    const hl = Math.max(7, 4 + wpx * 1.7), hw = Math.max(3.2, hl * 0.42);
    const tipAt = Math.max(0, L - rEnd / k);
    const tip = pathEl.getPointAtLength(tipAt), back = pathEl.getPointAtLength(Math.max(0, tipAt - 1 / k));
    const ang = Math.atan2(tip.y - back.y, tip.x - back.x) * 180 / Math.PI;
    d3.select(headEl)
        .attr('d', open ? `M${-hl},${hw} L0,0 L${-hl},${-hw}` : `M0,0 L${-hl},${hw} L${-hl * 0.78},0 L${-hl},${-hw} Z`)
        .attr('transform', `translate(${tip.x},${tip.y}) rotate(${ang}) scale(${1 / k})`);
}
