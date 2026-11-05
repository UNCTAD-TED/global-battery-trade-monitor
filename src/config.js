import * as d3 from 'd3';

// Global configuration. Colours on screen come from src/styles/tokens.css (--flow-*); flowColors is kept for reference.
export const CONFIG = {
    geoJsonUrl: 'assets/worldmap-economies-4326.topo.json',

    // Flow category = development status of exporter -> importer (UNCTADstat: 1500 developed, 1400 developing).
    // Codes come from scripts/build/export_json.py (FC).
    flowColors: {
        DG: '#009EDB',  // UNCTAD Blue
        GD: '#72BF44',  // UNCTAD Green
        GG: '#FBAF17',  // UNCTAD Yellow
        DD: '#AEA29A',  // UNCTAD Warm Grey
    },
    // Neutral labels (spec 0.4): UNCTAD statistical group names only.
    flowLabels: {
        DG: 'Developed → Developing economies',
        GD: 'Developing → Developed economies',
        GG: 'Developing → Developing economies',
        DD: 'Developed → Developed economies',
    },
    flowShort: { DG: 'Developed → Developing', GD: 'Developing → Developed',
                 GG: 'Developing → Developing', DD: 'Developed → Developed' },

    topN: { default: 20, options: [20, 40] },
    years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
    provisionalYears: [2024],
    defaults: { product: 'SPENT_ALL', year: 2024, metric: 'weight', view: 'map', preset: 'GLOBAL' },

    // Tooltip text for dagger flows (spec 7.2)
    daggerNote: 'Reported by the importer (the exporter did not report for this year)',
};

// UN map disclaimer: one wording for every map and globe (final text subject to UN map clearance)
export const MAP_DISCLAIMER = 'The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations. Dotted and dashed boundary lines represent approximate borders for which the final status has not yet been determined.';

// An estimate whose 90% range is narrower than this share of the estimate is "almost all reported"
// (only a tiny HS6 part of the pair is estimated): it is shown as reported, with a short note.
export const EST_MIN_REL_WIDTH = 0.01;

export const STATE = {
    // data
    geoData: null,
    borderLayers: null,
    countryPoints: null,
    countryCoords: {},
    countryNames: {},
    meta: null,
    products: null,
    buildInfo: null,
    eco: {},              // iso -> economy record from meta.json

    // selection
    product: CONFIG.defaults.product,
    year: CONFIG.defaults.year,
    metric: CONFIG.defaults.metric,     // 'value' | 'weight'
    view: CONFIG.defaults.view,         // 'map' | 'matrix'
    preset: CONFIG.defaults.preset,     // 'GLOBAL' | 'JAI' | 'SAS'
    region: 'Global',                   // existing SHC region filter (only with the Global preset)
    topN: CONFIG.topN.default,
    selectedCountry: null,
    highlightPair: null,                // "E|I"
    basis: 'reported',                  // 'reported' | 'estimated' (docs/overnight/DATA_CONTRACT.md)
    flowFilters: new Set(['DG', 'GD', 'GG', 'DD']),

    // derived for the current view
    scopeFlows: [],       // every directed flow in the current scope (before top N)
    filteredData: [],     // flows drawn on the map (top N)
    nodeStats: {},
};

// Metric display formatting. Values arrive in USD, weights in tonnes.
export const METRIC_FORMAT = {
    value: {
        label: 'Value', unit: 'USD',
        fmt: (v) => {
            if (v == null || Number.isNaN(v)) return '—';
            const a = Math.abs(v), s = v < 0 ? '-' : '';
            if (a >= 1e9) return s + '$' + d3.format('.2f')(a / 1e9) + 'B';
            if (a >= 1e6) return s + '$' + d3.format('.2f')(a / 1e6) + 'M';
            if (a >= 1e3) return s + '$' + d3.format('.1f')(a / 1e3) + 'K';
            return s + '$' + d3.format(',.0f')(a);
        },
    },
    weight: {
        label: 'Weight', unit: 'tonnes',
        fmt: (t) => {
            if (t == null || Number.isNaN(t)) return '—';
            const a = Math.abs(t), s = t < 0 ? '-' : '';
            if (a >= 1e6) return s + d3.format('.2f')(a / 1e6) + ' Mt';
            if (a >= 1e3) return s + d3.format('.1f')(a / 1e3) + ' kt';
            if (a >= 1) return s + d3.format(',.0f')(a) + ' t';
            if (a > 0) return '<1 t';
            return '0 t';
        },
    },
};

export const fmtMetric = (v, metric = STATE.metric) => METRIC_FORMAT[metric].fmt(v);
// Axis ticks: the same format without trailing zero decimals ($150.00B -> $150B, 20.0 kt -> 20 kt).
export const tickFmt = (v, metric = STATE.metric) => METRIC_FORMAT[metric].fmt(v).replace(/\.0+(?=\D|$)/, '');

// Metric value of a flow under the current basis. Reported mode = v1 fields; estimated mode uses
// ve / we where an estimate exists (DATA_CONTRACT.md section 2).
export function flowVal(d, metric = STATE.metric) {
    if (STATE.basis === 'estimated') {
        const e = STATE.meta?.estimation;
        // weight: experimental estimates only for K, U, B, Q; C rows keep the reported weight
        if (metric === 'weight') return e?.weight?.available && ['K', 'U', 'B', 'Q'].includes(d.wm) ? (d.we ?? d.w) : d.w;
        return (d.vm ? d.ve : d.v) ?? d.v;
    }
    return metric === 'weight' ? d.w : d.v;
}
export const isProvisional = (y) => CONFIG.provisionalYears.includes(+y);

// Phone layout (as in the Non-plastic dashboard; the same query is in index.html, set before the first paint)
export const PHONE_Q = '(max-width: 700px), (max-width: 1050px) and (pointer: coarse), (max-height: 500px) and (pointer: coarse)';
export const isPhone = () => document.documentElement.classList.contains('phone');
