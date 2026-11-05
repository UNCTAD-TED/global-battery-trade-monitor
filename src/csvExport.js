import { CONFIG, STATE } from './config.js';
import { DataLoader } from './dataLoader.js';

// CSV export (spec 7.9). Source flags and both sides' reports are included; one file <= 100,000 rows.
const MAX_ROWS = 100000;

function cell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name, header, rows) {
    const bi = STATE.buildInfo || {};
    const lines = [
        `# Global Battery Trade Monitor (v1, prototype). Source: UN Comtrade; UNCTAD calculations. Data extracted ${bi.extracted || ''}.`,
        '# source_side: x = exporter\'s report; m = importer\'s report used because the exporter did not report for the year (shown with a dagger on screen).',
        '# Values in current US dollars: exporters report FOB; importers usually CIF (the importer\'s FOB value is used when every part has one). Weights are net weights in tonnes.',
        '# weight_basis: reported; comtrade_estimate = weight estimated by UN Comtrade; missing = value without a weight; no_record = no record of this flow.',
        '# exports_source, imports_source (economy totals): own = the economy\'s own report; mirror = sum of partners\' reports (dagger); none = no data.',
        '# *_weight_flag (economy totals): missing = value without weight; partners = partner weights exceed the World total; unitvalue = unusual value per tonne. Flagged weights are left out of world weight totals and weight rankings on screen.',
        '# *_estimated_weight_share (economy totals): share of the value whose weight UN Comtrade estimated (not an UNCTAD estimate).',
        '# hs_codes: HS 6-digit codes without dots (854911 = 8549.11). Spent batteries are 8548.10 for economies reporting in HS 2017 or earlier and 8549.11-8549.19 in HS 2022.',
        `# Basis of this file: ${DataLoader.basisSentence()} Reported columns (value_usd, weight_t, *_reported_*) never contain estimates.`,
        '# Unit values are not provided. 2024 data are provisional.',
        ...(DataLoader._hasEstCols ? [`# View basis: ${STATE.basis}. Estimate columns (*_est, *_lo90, *_hi90, *_method) are model results, kept apart from the reported columns; method codes: value X exporter report, M from importer report (mirror model), E no report (time series); weight R reported, C UN Comtrade's own estimate (a reported weight: no experimental estimate or range), K from the quantity field, B model using the partner report, U model without a partner weight, Q replaced after a quality check. See Methodology.`] : []),
        header.join(','),
        ...rows.slice(0, MAX_ROWS).map(r => r.map(cell).join(',')),
    ];
    if (rows.length > MAX_ROWS) lines.push(`# Truncated to ${MAX_ROWS} rows.`);
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

const FLOW_HEADER = ['year', 'product_id', 'hs_codes', 'exporter_iso3', 'exporter', 'importer_iso3', 'importer',
    'flow_category', 'value_usd', 'weight_t', 'source_side', 'dagger', 'weight_basis',
    'exporter_reported_value_usd', 'importer_reported_value_usd', 'exporter_reported_weight_t', 'importer_reported_weight_t'];

const EST_HEADER = ['value_usd_est', 'value_usd_lo90', 'value_usd_hi90', 'value_method', 'weight_t_est', 'weight_t_lo90', 'weight_t_hi90', 'weight_method'];
const header = () => (DataLoader._hasEstCols ? FLOW_HEADER.concat(EST_HEADER) : FLOW_HEADER);

function flowRow(d, year, p) {
    const n = iso => STATE.countryNames[iso] || iso;
    const row = [year, p.id, p.hs, d.e, n(d.e), d.i, n(d.i), CONFIG.flowShort[d.fc] || '', d.v, d.w, d.src,
        d.src === 'm' ? '†' : '', d.wb, d.xv, d.mv, d.xw, d.mw];
    if (DataLoader._hasEstCols) row.push(d.ve, d.vlo, d.vhi, d.vm, d.we, d.wlo, d.whi, d.wm);
    return row;
}

export const CsvExport = {
    // Every directed flow in the current scope (the top-N display limit is not applied).
    viewFlows() {
        const p = DataLoader.product();
        const rows = STATE.scopeFlows.map(d => flowRow(d, STATE.year, p));
        download(`battery-monitor_${p.id}_${STATE.year}_${STATE.preset}${STATE.selectedCountry ? '_' + STATE.selectedCountry : ''}_flows.csv`, header(), rows);
    },

    async countryTotals() {
        const p = DataLoader.product();
        const sum = await DataLoader.loadSummary(p.id);
        const header = ['year', 'product_id', 'iso3', 'economy', 'exports_usd', 'exports_source', 'exports_t', 'exports_weight_flag',
            'exports_estimated_weight_share', 'imports_usd', 'imports_source', 'imports_t', 'imports_weight_flag',
            'imports_estimated_weight_share', 'hs_version'];
        const rows = [];
        Object.entries(sum.economies).forEach(([iso, years]) => Object.entries(years).forEach(([y, r]) => {
            rows.push([y, p.id, iso, STATE.countryNames[iso] || iso, r.x, r.xs, r.xw, r.xflag, r.xest,
                r.m, r.ms, r.mw, r.mflag, r.mest, r.hs]);
        }));
        rows.sort((a, b) => a[0] - b[0] || String(a[2]).localeCompare(String(b[2])));
        download(`battery-monitor_${p.id}_country_totals.csv`, header, rows);
    },

    async country(iso) {
        const p = DataLoader.product();
        const all = await DataLoader.loadAllYears(p.id);
        const rows = [];
        Object.entries(all).forEach(([y, flows]) => flows.forEach(d => {
            if (d.e === iso || d.i === iso) rows.push(flowRow(d, y, p));
        }));
        download(`battery-monitor_${p.id}_${iso}_all_years.csv`, header(), rows);
    },

    async pair(a, b) {
        const p = DataLoader.product();
        const all = await DataLoader.loadAllYears(p.id);
        const rows = [];
        Object.entries(all).forEach(([y, flows]) => flows.forEach(d => {
            if ((d.e === a && d.i === b) || (d.e === b && d.i === a)) rows.push(flowRow(d, y, p));
        }));
        download(`battery-monitor_${p.id}_${a}-${b}.csv`, header(), rows);
    },
};
