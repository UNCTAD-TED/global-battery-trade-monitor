import * as d3 from 'd3';
import { CONFIG, STATE, METRIC_FORMAT, fmtMetric, isProvisional } from './config.js';
import { DataLoader } from './dataLoader.js';
import { POLICY_TIMELINE, SOURCES, cite } from './storyData.js';
import { twoReportsNote } from './storyFindings.js';
import { motionOn, MS } from './motion.js';
import { EASE_CSS } from './transitions.js';

// Country panel (spec 7.5).
const DEV = { 1500: 'Developed economy', 1400: 'Developing economy' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nm = iso => STATE.countryNames[iso] || iso;
const dag = s => (s === 'mirror' ? '<sup class="dag" title="Reported by partners (the economy did not report for this year)">†</sup>' : '');

// HHI from the shares of directed totals (spec 7.5; not SHC's net method).
// Comtrade HS version codes in words (H6 = HS 2022)
const HS_YEAR = { H0: '1992', H1: '1996', H2: '2002', H3: '2007', H4: '2012', H5: '2017', H6: '2022' };
export const hsName = h => (HS_YEAR[h] ? `HS ${HS_YEAR[h]}` : 'an earlier HS version');

export function hhi(values) {
    const tot = d3.sum(values);
    if (!tot) return null;
    return Math.round(d3.sum(values, v => (v / tot) ** 2) * 10000);
}

// Estimated mode: model-based totals next to the reported ones (DATA_CONTRACT.md section 3).
function estTotals(rec, metric) {
    if (STATE.basis !== 'estimated') return '';
    const line = (k, lab) => {
        const isW = metric === 'weight';
        if (!DataLoader.estAvailableFor(metric)) return '';
        const v = isW ? rec[k + 'we'] : rec[k + 'e'];
        if (v == null) return '';
        const rep = isW ? rec[k + 'w'] : rec[k];
        // show only when the estimate changes the total (weights can be replaced after a quality check
        // even for an economy's own report)
        if (rec[k + 's'] === 'own' && !(rec[k + 'es'] > 0) && rep != null && Math.abs(v - rep) <= Math.max(0.5, 0.005 * Math.abs(rep))) return '';
        const lo = isW ? rec[k + 'welo'] : rec[k + 'elo'], hi = isW ? rec[k + 'wehi'] : rec[k + 'ehi'];
        const share = isW ? null : rec[k + 'es'];
        return `<div class="cp-hint tt-est"><span class="est-badge">est.</span> ${lab} with experimental estimates: <b>≈${fmtMetric(v)}</b>${lo != null && hi != null ? ` (90% range ${fmtMetric(lo)} – ${fmtMetric(hi)})` : ''}${share != null ? `; ${Math.round(share * 100)}% estimated` : ''}${rep != null ? `; as reported: ${fmtMetric(rep)}` : ''}.</div>`;
    };
    return line('x', 'Exports') + line('m', 'Imports');
}

// The panel in two layers (user, 2026-11-05: "too much at once"): what is always shown (the economy, its two
// totals and one sentence on its main partners), then tabs, one at a time: Partners, Over time, Both reports,
// Notes (and Policy for Bangladesh). The tab chosen is kept from one economy to the next while the page is open.
const TABS = [['partners', 'Partners'], ['trend', 'Over time'], ['reports', 'Two reports'], ['notes', 'Notes'], ['policy', 'Policy']];   // Policy: SMEP reports, Bangladesh only
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const b = e.target.closest?.('[data-cptab]');
        if (b) CountryPanel.selectTab(b.dataset.cptab, false);
    });
    document.addEventListener('keydown', (e) => {
        const b = e.target.closest?.('.cp-tabs [role="tab"]');
        if (!b) return;
        const tabs = [...b.parentElement.querySelectorAll('[role="tab"]')];
        let k = tabs.indexOf(b);
        if (e.key === 'ArrowRight') k = (k + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') k = (k + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') k = 0;
        else if (e.key === 'End') k = tabs.length - 1;
        else return;
        e.preventDefault();
        CountryPanel.selectTab(tabs[k].dataset.cptab, true);
    });
}

export const CountryPanel = {
    _tab: 'partners',

    selectTab(id, focus) {
        const root = document.getElementById('panel-body');
        if (!root || !root.querySelector(`[data-cptab="${id}"]`)) return;
        this._tab = id;
        root.querySelectorAll('[data-cptab]').forEach(t => {
            const on = t.dataset.cptab === id;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
            t.classList.toggle('active', on);
        });
        root.querySelectorAll('.cp-tabpanel').forEach(p => { p.hidden = p.dataset.cppanel !== id; });
        if (focus) root.querySelector(`[data-cptab="${id}"]`)?.focus({ preventScroll: true });
        // the chart is drawn at the width of its tab, so it is drawn (again) when its tab is shown
        if (id === 'trend' && this._series) this.drawSeries(document.getElementById('cp-ts'), ...this._series);
        // the tabs stay at the top of the panel: bring the start of the tab back into view if it was scrolled past
        const tabs = root.querySelector('.cp-tabs'), body = document.getElementById('side-body');
        if (tabs && body && tabs.getBoundingClientRect().top < body.getBoundingClientRect().top) tabs.scrollIntoView({ block: 'start' });
    },

    async build(iso) {
        const p = DataLoader.product();
        const metric = STATE.metric;
        const y = STATE.year;
        const flows = await DataLoader.loadFlows(p.id, y);
        const sum = await DataLoader.loadSummary(p.id);
        const [sb, ss] = await Promise.all([DataLoader.loadSummary('BAT_ALL'), DataLoader.loadSummary('SPENT_ALL')]);
        const rec = sum.economies[iso]?.[String(y)] || {};
        const eco = STATE.eco[iso] || {};
        const region = STATE.meta.regions[eco.reg] || '';
        const val = d => DataLoader.val(d, metric);

        const out = flows.filter(d => d.e === iso);
        const inn = flows.filter(d => d.i === iso);
        const parts = [];   // always shown
        const notes = [];   // the Notes tab

        // ── HS version note
        const hs = rec.hs || STATE.meta.hs_version[iso]?.[String(y)];
        if (y >= 2022 && hs && hs !== 'H6' && p.group === 'SPENT') {
            notes.push(`Reported in ${hsName(hs)}: no breakdown by HS 8549 subheading.`);
        }

        // ── Totals
        const kv = (k) => {
            const s = rec[k + 's'];
            if (!s || s === 'none') return '<span class="muted">No data</span>';
            const v = metric === 'weight' ? rec[k + 'w'] : rec[k];
            return `${fmtMetric(v)}${dag(s)}`;
        };
        const other = metric === 'weight' ? 'value' : 'weight';
        const kvOther = (k) => {
            const s = rec[k + 's'];
            if (!s || s === 'none') return '';
            const v = other === 'weight' ? rec[k + 'w'] : rec[k];
            return METRIC_FORMAT[other].fmt(v);
        };
        // The partners' side of each total: importers' reports of this economy's exports, exporters' reports of its
        // imports. Shown under a total when the economy reported but its partners report something very different,
        // or it recorded nothing while they did (user, 2026-11-05: China's imports read 0 while the map showed arcs
        // into China; the map draws each flow from the exporter's report).
        const isW0 = metric === 'weight', estMode0 = STATE.basis === 'estimated';
        const partnerSide = { x: d3.sum(out, d => (isW0 ? d.mw : d.mv) || 0), m: d3.sum(inn, d => (isW0 ? d.xw : d.xv) || 0) };
        const ownOf = k => (isW0 ? rec[k + 'w'] : rec[k]) || 0;
        const differs = k => {
            if (estMode0 || rec[k + 's'] !== 'own' || !(partnerSide[k] > 0)) return false;
            const o = ownOf(k), pr = partnerSide[k];
            return !(o > 0) || pr / o > 2 || o / pr > 2;
        };
        const partRep = k => (differs(k) ? `<div class="cp-sub cp-partrep">${k === 'x' ? 'Importers' : 'Exporters'} report ${fmtMetric(partnerSide[k])}</div>` : '');
        const noneLine = k => {
            if (!differs(k) || ownOf(k) > 0) return '';
            return `<div class="cp-hint cp-gapnote">${esc(nm(iso))} recorded no ${k === 'x' ? 'exports' : 'imports'} of these goods in ${y}, but its partners reported ${fmtMetric(partnerSide[k])} of ${k === 'x' ? 'imports from it' : 'exports to it'}. ${k === 'm' ? 'The lines into it on the map are those exporters’ reports' : 'The map uses its own (empty) report'}; the two sides are compared under “Two reports”.</div>`;
        };
        parts.push(`<div class="si-section">
            <div class="si-label">${esc(p.label)} &middot; ${y}${isProvisional(y) ? ' (provisional)' : ''}</div>
            ${STATE.basis === 'estimated' ? '<div class="cp-asrep">Tiles show the values as reported; experimental estimates, where they change a total, follow below.</div>' : ''}
            <div class="si-kpi-grid cols-2">
              <div class="si-kpi-card exp"><div class="si-kpi-label">Exports</div><div class="si-kpi-value">${kv('x')}</div><div class="cp-sub">${kvOther('x')}</div>${partRep('x')}</div>
              <div class="si-kpi-card imp"><div class="si-kpi-label">Imports</div><div class="si-kpi-value">${kv('m')}</div><div class="cp-sub">${kvOther('m')}</div>${partRep('m')}</div>
            </div>
            ${noneLine('x')}${noneLine('m')}
            ${(rec.xs === 'mirror' || rec.ms === 'mirror') ? '<div class="cp-hint"><sup class="dag">†</sup> Sum of partners’ reports: this economy did not report this flow for the year.</div>' : ''}
            ${(rec.xflag || rec.mflag) && metric === 'weight' ? `<div class="cp-hint cp-flag">${rec.xflag && rec.mflag ? 'Both weights are' : rec.xflag ? 'The export weight is' : 'The import weight is'} flagged as unreliable (see Notes).</div>` : ''}
            ${estTotals(rec, metric)}
          </div>`);
        if (rec.xu || rec.mu) notes.push(`Partner not specified in the economy’s own report (unallocated): exports ${METRIC_FORMAT.value.fmt(rec.xu || 0)}, imports ${METRIC_FORMAT.value.fmt(rec.mu || 0)} (included in the totals).`);

        // ── Weight quality (Notes)
        const flagTxt = { missing: 'value without weight', partners: 'partner weights exceed the World total', unitvalue: 'unusual value per tonne' };
        if (rec.xflag) notes.push(`Exports: weight flagged as unreliable (${flagTxt[rec.xflag]}); left out of weight rankings and the world total.`);
        if (rec.mflag) notes.push(`Imports: weight flagged as unreliable (${flagTxt[rec.mflag]}); left out of weight rankings and the world total.`);
        if (rec.xest) notes.push(`Exports: for ${Math.round(rec.xest * 100)}% of the value, the weight was estimated by UN Comtrade (not reported).`);
        if (rec.mest) notes.push(`Imports: for ${Math.round(rec.mest * 100)}% of the value, the weight was estimated by UN Comtrade (not reported).`);

        // ── Top partners and HHI by direction. The economy's own report where it reported (exports: its export
        // records; imports: its import records), so the shares are of the totals above; partners' reports (†) where
        // it did not report (user, 2026-11-05). The map draws each flow from the exporter's report first, so a line on
        // the map can differ. The experimental "estimated" view keeps the flows as on the map, with their estimates.
        const isW = metric === 'weight';
        const estMode = STATE.basis === 'estimated';
        const topList = (arr, side) => {
            const k = side === 'out' ? 'x' : 'm';
            let own = rec[k + 's'] === 'own';
            let fk = own ? k : (k === 'x' ? 'm' : 'x');   // whose record: this economy's, or the partners'
            let pv = estMode ? val : (d => (isW ? d[fk + 'w'] : d[fk + 'v']) || 0);
            let withV = arr.filter(d => pv(d) > 0).sort((a, b) => pv(b) - pv(a));
            // it reported, but recorded none of this trade while its partners did: list the partners' reports (†)
            let fallback = false;
            if (!estMode && own && !withV.length) {
                fk = k === 'x' ? 'm' : 'x';
                pv = d => (isW ? d[fk + 'w'] : d[fk + 'v']) || 0;
                withV = arr.filter(d => pv(d) > 0).sort((a, b) => pv(b) - pv(a));
                fallback = withV.length > 0;
                if (fallback) own = false;
            }
            const sumV = d3.sum(withV, pv);
            const head = isW ? rec[k + 'w'] : rec[k];
            const tot = !estMode && own && head > 0 ? Math.max(head, sumV) : sumV;   // own: shares of the total above
            const h = hhi(withV.map(pv));
            const rows = withV.slice(0, 5).map(d => {
                const partner = side === 'out' ? d.i : d.e;
                const share = tot ? 100 * pv(d) / tot : 0;
                const est = estMode && DataLoader.isEst(d, metric);
                const mark = estMode ? d.src === 'm' : !own;
                return `<div class="cp-prow"><span class="cp-pname">${esc(nm(partner))}${mark ? '<sup class="dag">†</sup>' : ''}${est ? '<sup class="est-badge est-mini">est</sup>' : ''}</span>
                  <span class="cp-pbar"><span class="cp-pfill fc-${d.fc}" style="width:${share.toFixed(1)}%"></span></span>
                  <span class="cp-pval">${est ? '≈' : ''}${fmtMetric(pv(d))}</span><span class="cp-ppct">${share > 0 && share < 0.5 ? '<1' : share.toFixed(0)}%</span></div>`;
            }).join('') || '<div class="muted cp-line">No flows with data.</div>';
            const first = withV[0] ? { iso: side === 'out' ? withV[0].i : withV[0].e, share: tot ? pv(withV[0]) / tot : 0 } : null;
            const pre = fallback ? `<div class="cp-line cp-gapnote">${esc(nm(iso))} recorded none; as its partners report it (<sup class="dag">†</sup>):</div>` : '';
            return { rows: pre + rows, h, n: withV.length, own, first, fallback };
        };
        const to = topList(out, 'out'), fr = topList(inn, 'in');
        const partNote = estMode
            ? 'Partners: flows as on the map (the exporter’s report, or the importer’s †), with experimental estimates, so they can differ from the totals above.'
            : `${to.own && fr.own ? 'Partners: this economy’s own report, so the shares are of the totals above (any rest has no partner given, or is a special area).'
                : !to.own && !fr.own ? 'Partners: its partners’ reports (†), as this economy did not report.'
                    : 'Partners: this economy’s own report where it reported, so the shares are of the totals above; its partners’ reports (†) where it did not.'} On the map each flow is drawn from the exporter’s report first, so a line there can differ.`;
        // ── In one sentence, under the totals: the main partner each way
        const pctTxt = s => (s > 0 && s < 0.005 ? '<1%' : `${Math.round(s * 100)}%`);
        const lead = [
            to.first ? `exports${to.fallback ? ' (as its partners report them)' : ''} mostly to <b>${esc(nm(to.first.iso))}</b> (${pctTxt(to.first.share)})` : '',
            fr.first ? `imports${fr.fallback ? ' (as its partners report them)' : ''} mostly from <b>${esc(nm(fr.first.iso))}</b> (${pctTxt(fr.first.share)})` : '',
        ].filter(Boolean);
        if (lead.length) parts.push(`<p class="cp-lead">Main partners: ${lead.join('; ')}.</p>`);

        const hhiTxt = (t) => (t.h == null ? '—' : `${d3.format(',')(t.h)} <span class="cp-band">of 10,000</span>`);
        const partnersHtml = `<div class="si-section">
            <div class="si-label">Exports to (${to.n} ${to.n === 1 ? 'partner' : 'partners'})</div>${to.rows}
            <div class="cp-hhi">Partner concentration (HHI): ${hhiTxt(to)}</div>
            <div class="si-label cp-gap">Imports from (${fr.n} ${fr.n === 1 ? 'partner' : 'partners'})</div>${fr.rows}
            <div class="cp-hhi">Partner concentration (HHI): ${hhiTxt(fr)}</div>
            <div class="si-sublabel">${esc(partNote)} HHI (Herfindahl–Hirschman index) = the sum of the squared partner shares × 10,000 (10,000 = a single partner), by direction, all partners of the year, not only those on the map.</div>
          </div>`;

        // ── Time series: batteries vs spent batteries
        const trendHtml = `<div class="si-section"><div class="si-label">Batteries (HS 8507) and spent batteries (HS 8549.1 / 8548.10), ${METRIC_FORMAT[metric].label.toLowerCase()}, 2016–2024</div>
            <div id="cp-ts"></div>
            <div class="si-sublabel">Points marked † are partners’ reports (the economy did not report). The chart shows reported values and weights only (no estimates).</div></div>`;

        // ── Exporter's vs importer's reports
        const disc = (arr, side) => {
            const isW = metric === 'weight';
            const gx = d => (isW ? d.xw : d.xv), gm = d => (isW ? d.mw : d.mv);
            // largest first by the measure shown (a flow with a value but no weight comes after those with one)
            const size = d => Math.max(gx(d) || 0, gm(d) || 0);
            const rows = arr.filter(d => (d.xv || d.mv))
                .sort((a, b) => size(b) - size(a) || Math.max(b.xv || 0, b.mv || 0) - Math.max(a.xv || 0, a.mv || 0)).slice(0, 8);
            if (!rows.length) return '<div class="muted cp-line">No records.</div>';
            const f = (d, k) => METRIC_FORMAT[metric].fmt(k === 'x' ? gx(d) : gm(d));
            const has = (d, k) => (k === 'x' ? gx(d) != null : gm(d) != null);
            // an empty side: "no weight" when that side recorded the flow (a value) without a weight; "no record" when
            // that economy reported for the year but not this flow; "did not report" otherwise (as in the pair history)
            const missing = (d, k, who, fl) => `<span class="muted">${isW && ((k === 'x' ? d.xv : d.mv) || 0) > 0 ? 'no weight'
                : DataLoader.reported(who, y, fl) ? 'no record' : 'did not report'}</span>`;
            // Dumbbell column on one log scale for the table: filled = exporter, open = importer.
            const vals = rows.flatMap(d => [gx(d), gm(d)]).filter(v => v > 0);
            const lx = vals.length ? d3.scaleLog().domain([d3.min(vals) / 1.3, d3.max(vals) * 1.3]).range([4, 60]) : null;
            const db = d => {
                if (!lx) return '';
                const a = gx(d) > 0 ? lx(gx(d)) : null, b = gm(d) > 0 ? lx(gm(d)) : null;
                return `<svg width="64" height="12" aria-hidden="true">${a != null && b != null ? `<line class="db-link" x1="${a}" x2="${b}" y1="6" y2="6"/>` : ''}
                    ${b != null ? `<circle class="db-m" cx="${b}" cy="6" r="3.5"/>` : ''}${a != null ? `<circle class="db-x" cx="${a}" cy="6" r="3.5"/>` : ''}</svg>`;
            };
            return `<table class="si-table cp-disc"><thead><tr><th class="al">${side === 'out' ? 'To' : 'From'}</th><th class="ar">Exporter’s report</th><th class="ar">Importer’s report</th><th class="cp-db"><span class="sr-only">Both reports, log scale</span></th></tr></thead><tbody>
              ${rows.map(d => `<tr><td class="al">${esc(nm(side === 'out' ? d.i : d.e))}${d.src === 'm' ? '<sup class="dag">†</sup>' : ''}</td>
                 <td class="ar">${has(d, 'x') ? f(d, 'x') : missing(d, 'x', d.e, 'X')}</td>
                 <td class="ar">${has(d, 'm') ? f(d, 'm') : missing(d, 'm', d.i, 'M')}</td>
                 <td class="cp-db">${db(d)}</td></tr>`).join('')}
              </tbody></table>`;
        };
        const reportsHtml = `<div class="si-section">
            <div class="si-label">Exporter’s and importer’s reports of the same flows, ${y}</div>
            <div class="si-sublabel">${esc(twoReportsNote(metric))} No record: the economy reported for the year, but not this flow.${metric === 'weight' ? ' No weight: it reported the flow without a weight.' : ''} Did not report: no report from that economy for the year. <span class="cp-key"><i class="dot db-x"></i> exporter’s report <i class="dot db-m"></i> importer’s report (log scale)</span></div>
            <div class="cp-subhead">Exports of ${esc(nm(iso))}</div>${disc(out, 'out')}
            <div class="cp-subhead">Imports of ${esc(nm(iso))}</div>${disc(inn, 'in')}</div>`;

        // ── Policy timeline (BGD only)
        const tl = POLICY_TIMELINE[iso];
        const policyHtml = tl ? `<div class="si-section"><div class="si-label">Policy timeline (from the SMEP project reports, not UN Comtrade data)</div>
              ${tl.map(t => `<div class="cp-tl"><span class="cp-tl-y">${esc(t.year)}</span><span>${esc(t.text)}${t.note ? ` <em>${esc(t.note)}</em>` : ''}
                 <span class="cp-src">(${esc(cite(t.src, t.page))})</span></span></div>`).join('')}
              <div class="si-sublabel">Sources: ${esc(SOURCES.IS)}; ${esc(SOURCES.BVC)}.</div></div>` : '';

        // ── Notes on the figures (always at least the reading notes)
        notes.push('<sup class="dag">†</sup> marks partners’ reports, used where this economy did not report.');
        const notesHtml = `<div class="si-section"><div class="si-label">Notes on these figures</div>${notes.map(t => `<div class="cp-line">${t}</div>`).join('')}
            <div class="si-sublabel">Weights of flagged economies are left out of rankings and world totals; see Methodology.</div></div>`;

        // ── The tabs (one panel at a time)
        const panels = { partners: partnersHtml, trend: trendHtml, reports: reportsHtml, notes: notesHtml, policy: policyHtml };
        const tabs = TABS.filter(([id]) => panels[id]);
        const cur = tabs.some(([id]) => id === this._tab) ? this._tab : 'partners';
        const nNotes = notes.length - 1;   // the † line is always there
        parts.push(`<div class="cp-tabs" role="tablist" aria-label="Details of ${esc(nm(iso))}">${tabs.map(([id, lab]) =>
            `<button class="cp-tab${id === cur ? ' active' : ''}" type="button" role="tab" id="cpt-${id}" aria-controls="cpp-${id}" aria-selected="${id === cur}" tabindex="${id === cur ? 0 : -1}" data-cptab="${id}">${lab}${id === 'notes' && nNotes ? ` <span class="cp-tab-n">${nNotes}</span>` : ''}</button>`).join('')}</div>`);
        tabs.forEach(([id]) => parts.push(`<div class="cp-tabpanel" role="tabpanel" id="cpp-${id}" aria-labelledby="cpt-${id}" data-cppanel="${id}"${id === 'reports' ? ' data-id="cp-reports"' : ''}${id === cur ? '' : ' hidden'}>${panels[id]}</div>`));

        const meta = `${region}${region ? ' · ' : ''}${DEV[eco.dev] || ''}${hs ? ` · reported in ${hsName(hs)}` : ''}`;
        return { html: parts.join(''), meta, series: { sb, ss } };
    },

    // Small line chart: exports and imports of batteries vs spent batteries, 2016-2024.
    drawSeries(el, iso, sb, ss) {
        this._series = [iso, sb, ss];
        if (!el || el.closest('[hidden]')) return;   // its tab is not shown: drawn when the tab is chosen
        const metric = STATE.metric;
        const years = CONFIG.years;
        const pick = (sum, k) => years.map(y => {
            const r = sum.economies[iso]?.[String(y)];
            if (!r || !r[k + 's'] || r[k + 's'] === 'none') return { y, v: null, m: false };
            return { y, v: metric === 'weight' ? r[k + 'w'] : r[k], m: r[k + 's'] === 'mirror' };
        });
        const series = [
            { key: 'Batteries · exports', d: pick(sb, 'x'), cls: 'ts-bx' },
            { key: 'Batteries · imports', d: pick(sb, 'm'), cls: 'ts-bm' },
            { key: 'Spent · exports', d: pick(ss, 'x'), cls: 'ts-sx' },
            { key: 'Spent · imports', d: pick(ss, 'm'), cls: 'ts-sm' },
        ];
        const W = el.clientWidth || 300, H = 150, m = { t: 8, r: 8, b: 20, l: 46 };
        const x = d3.scalePoint().domain(years).range([m.l, W - m.r]);
        const all = series.flatMap(s => s.d.map(p => p.v)).filter(v => v > 0);
        const ylog = d3.scaleLog().domain([Math.max(d3.min(all) || 1, 1e-3), Math.max(d3.max(all) || 10, 1)]).nice().range([H - m.b, m.t]);
        const svg = d3.select(el).html('').append('svg').attr('width', W).attr('height', H).attr('class', 'ts-svg');
        svg.append('g').attr('transform', `translate(0,${H - m.b})`).attr('class', 'ts-axis')
            .call(d3.axisBottom(x).tickValues(years.filter(y => y % 2 === 0)).tickFormat(d3.format('d')).tickSizeOuter(0));
        // log axis: powers of ten only, with their unit (SI letters read wrongly here: "10m" was 0.01 t, "10G" USD 10 bn)
        const sig = n => d3.format('~g')(+n.toPrecision(3));
        const tickFmt = metric === 'weight'
            ? v => (v >= 1e6 ? `${sig(v / 1e6)} Mt` : v >= 1e3 ? `${sig(v / 1e3)} kt` : `${sig(v)} t`)
            : v => (v >= 1e9 ? `$${sig(v / 1e9)}B` : v >= 1e6 ? `$${sig(v / 1e6)}M` : v >= 1e3 ? `$${sig(v / 1e3)}k` : `$${sig(v)}`);
        const [lo, hi] = ylog.domain();
        let tv = d3.range(Math.ceil(Math.log10(lo) - 1e-9), Math.floor(Math.log10(hi) + 1e-9) + 1).map(e => 10 ** e);
        while (tv.length > 5) tv = tv.filter((_, k) => (tv.length - 1 - k) % 2 === 0);   // every other power, the top one kept
        svg.append('g').attr('transform', `translate(${m.l},0)`).attr('class', 'ts-axis')
            .call(d3.axisLeft(ylog).tickValues(tv).tickFormat(tickFmt).tickSizeOuter(0));
        const line = d3.line().defined(p => p.v > 0).x(p => x(p.y)).y(p => ylog(p.v));
        const gl = svg.append('g');
        series.forEach(s => {
            gl.append('path').datum(s.d).attr('class', `ts-line ${s.cls}`).attr('d', line);
            gl.selectAll(null).data(s.d.filter(p => p.v > 0)).enter().append('circle')
                .attr('class', p => `ts-pt ${s.cls}${p.m ? ' mirror' : ''}`)
                .attr('cx', p => x(p.y)).attr('cy', p => ylog(p.v)).attr('r', 2.2)
                .append('title').text(p => `${s.key} ${p.y}: ${fmtMetric(p.v)}${p.m ? ' †' : ''}`);
        });
        const lg = d3.select(el).append('div').attr('class', 'si-chart-legend ts-legend');
        series.forEach(s => lg.append('span').attr('class', 'si-legend-item')
            .html(`<span class="si-legend-swatch ${s.cls}"></span><span>${s.key}</span>`));
        d3.select(el).append('div').attr('class', 'si-sublabel').text('Log scale.');
        // the years unfold from left to right (once, when the economy opens; docs/design/MOTION_V6.md)
        if (motionOn()) gl.node().animate?.([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: MS.data + 180, delay: MS.micro, easing: EASE_CSS.out, fill: 'backwards' });
    },
};
