import * as d3 from 'd3';
import { STATE, isProvisional } from './config.js';
import { DataLoader } from './dataLoader.js';

// The story's text, computed from public/data (UN Comtrade; UNCTAD calculations) when the page runs
// (docs/design/STORY_V5.md). Each chapter has two or three sentences with the key numbers in bold; the map and
// the chart of the chapter are drawn from the same calculations (Calc), so they show what the text says.
// No number here is typed by hand: text and figures from documents live only in src/storyData.js.
//
// Findings[id]() returns
//   num, text, note   the lead finding (also used by the entry and the question pages, src/pages.js)
//   html              the chapter's sentences (HTML, numbers in <b>; the lead number is b.st-hl-num)
//   sr                the same sentences as plain text, for screen readers
//   named             ISO codes of the economies the text names (labelled on the map)
//   foot              the basis of the figures (who reported, units, year)

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NB = ' ';

// ── words and numbers (the story's style: "USD 1.2 bn", "USD 340 m", tonnes in full)
const THE = { USA: 'the United States', KOR: 'the Republic of Korea', GBR: 'the United Kingdom', NLD: 'the Netherlands', ARE: 'the United Arab Emirates', PHL: 'the Philippines', DOM: 'the Dominican Republic', CZE: 'Czechia', RUS: 'the Russian Federation' };
export const name = iso => THE[iso] || STATE.countryNames[iso] || iso;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const sig = v => d3.format('.3~r')(v);
export const usd = v => (v >= 1e9 ? `USD${NB}${sig(v / 1e9)}${NB}bn` : v >= 1e6 ? `USD${NB}${sig(v / 1e6)}${NB}m` : `USD${NB}${d3.format(',.3~r')(v)}`);
export const tonnes = v => (v >= 1e6 ? `${sig(v / 1e6)}${NB}million tonnes` : `${d3.format(',.3~r')(v)}${NB}tonnes`);
export const pct = v => (Math.abs(v) < 0.095 && v !== 0 ? `${(100 * v).toFixed(1)}%` : `${Math.round(100 * v)}%`).replace('-', '−');   // a true minus sign
// Dates as the UN writes them: 2026-11-03 -> 3 November 2026
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(iso || ''); };
const WORDS = ['', 'as much as', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times', 'ten times'];
export const times = r => { const k = Math.round(r); return (Math.abs(r - k) < 0.15 && k >= 2 && k <= 10) ? WORDS[k] : `${d3.format('.2~r')(r)} times`; };
export const yr = y => `${y}${isProvisional(y) ? 'ᵖ' : ''}`;
const list = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const B = s => `<b>${esc(s)}</b>`;
const K = s => `<b class="st-hl-num">${esc(s)}</b>`;
const plain = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

// Why the two reports differ: FOB/CIF explains values only, so weights get their own sentence (WORDING_REVIEW B03)
export const twoReportsNote = metric => (metric === 'weight'
    ? 'Weights do not depend on how goods are valued. Differences between the two reports can come from classification, timing, transit, confidential data, weights estimated by UN Comtrade, or one side not reporting. These statistics do not show which.'
    : 'Exports are valued FOB (at the exporter’s border) and imports usually CIF (including freight and insurance to the importer’s border), so import values tend to be a little higher. Larger differences can come from classification, timing, transit, confidential data or one side not reporting. These statistics do not show which.');
const reported = (iso, y) => (STATE.meta.reporting[iso]?.[String(y)] || '').length > 0;
const span = () => STATE.buildInfo?.period || [2016, 2024];
// what the data show: UN Comtrade had no data from these economies on the extraction date (not that they failed to report)
const notYet = () => `had no 2024 data in UN Comtrade on ${STATE.buildInfo?.extracted ? longDate(STATE.buildInfo.extracted) : 'the extraction date'} (2024 data are provisional)`;
const memo = new Map();
const once = (k, f) => { if (!memo.has(k)) memo.set(k, f().catch(e => { memo.delete(k); throw e; })); return memo.get(k); };
// Economies' own reports for one year of a summary file: [{ iso, v }] largest first (weights flagged as unreliable left out)
function own(sum, y, k) {
    const isW = k.endsWith('w'), side = k[0];
    return Object.entries(sum.economies).map(([iso, ys]) => {
        const r = ys[String(y)];
        if (!r || r[side + 's'] !== 'own' || (isW && r[side + 'flag'])) return null;
        return r[k] > 0 ? { iso, v: r[k] } : null;
    }).filter(Boolean).sort((a, b) => b.v - a.v);
}
const share = (part, whole) => (whole ? part / whole : 0);
const sumBy = (a, f) => d3.sum(a, f);

// ── calculations shared by the text, the maps and the charts
export const Calc = {
    // Chapter 1: world exports of lead-acid and lithium-ion batteries by value, per year and per exporter
    boom: () => once('boom', async () => {
        const [la, li] = await Promise.all(['BAT_LA', 'BAT_LIION'].map(p => DataLoader.loadSummary(p)));
        const [y0, y1] = span();
        const years = d3.range(y0, y1 + 1);
        const rows = years.map(y => ({ y, la: la.world?.[y]?.x || 0, li: li.world?.[y]?.x || 0, n: la.world?.[y]?.nx || 0 }));
        rows.forEach(r => { r.t = r.la + r.li; });
        const eco = {};
        years.forEach(y => {
            const m = new Map();
            [la, li].forEach(s => own(s, y, 'x').forEach(d => m.set(d.iso, (m.get(d.iso) || 0) + d.v)));
            eco[y] = [...m].map(([iso, v]) => ({ iso, v })).sort((a, b) => b.v - a.v);
        });
        const vmax = d3.max(years, y => eco[y][0]?.v || 0);
        const over = rows.find(r => r.li > r.la);
        const peak = rows.reduce((a, r) => (r.t > a.t ? r : a), rows[0]);
        return { years, rows, eco, vmax, over: over?.y ?? null, peak };
    }),

    // Chapter 2: the same batteries by weight; regions of the exporters (own reports, flagged weights left out)
    weight: () => once('weight', async () => {
        const [la, li] = await Promise.all(['BAT_LA', 'BAT_LIION'].map(p => DataLoader.loadSummary(p)));
        const [y0, y1] = span();
        const reg = iso => STATE.eco[iso]?.reg || null;
        const side = (s, key, label) => {
            const ex = own(s, y1, 'xw');
            const tot = sumBy(ex, d => d.v);
            const by = d3.rollups(ex.filter(d => reg(d.iso)), v => sumBy(v, d => d.v), d => reg(d.iso)).map(([r, v]) => ({ r, name: STATE.meta.regions[r] || r, v, s: share(v, tot) })).sort((a, b) => b.v - a.v);
            return { key, label, w0: s.world?.[y0]?.xw || 0, w1: s.world?.[y1]?.xw || 0, v1: s.world?.[y1]?.x || 0, excl: s.world?.[y1]?.xw_excl || 0, ex, tot, regions: by };
        };
        return { y0, y1, la: side(la, 'la', 'Lead-acid'), li: side(li, 'li', 'Lithium-ion') };
    }),

    // Chapter 3: spent batteries against batteries; HS codes; the corridors of 8549.11
    spent: () => once('spent', async () => {
        const y1 = span()[1];
        const [sa, ba, s11, vis, f] = await Promise.all([DataLoader.loadSummary('SPENT_ALL'), DataLoader.loadSummary('BAT_ALL'), DataLoader.loadSummary('SPENT_11'), DataLoader.loadVisibility(), DataLoader.loadFlows('SPENT_11', y1)]);
        const w = vis.WORLD?.X?.[String(y1)]?.w || {};
        const wt = d3.sum(Object.values(w));
        const flows = f.filter(d => d.src !== 'e' && d.w > 0).sort((a, b) => b.w - a.w);
        const tot = sumBy(flows, d => d.w);
        let acc = 0, n = 0;
        while (n < flows.length && acc < tot / 2) acc += flows[n++].w;
        const ex = own(s11, y1, 'xw');
        const top = ex[0];
        const dest = top ? d3.rollups(flows.filter(d => d.e === top.iso), v => sumBy(v, d => d.w), d => d.i).sort((a, b) => b[1] - a[1]) : [];
        const destTot = d3.sum(dest, d => d[1]);
        // value by HS code: not affected by the weight checks (all reporters)
        const v = vis.WORLD?.X?.[String(y1)]?.v || {};
        return { y1, spentV: sa.world?.[y1]?.x || 0, batV: ba.world?.[y1]?.x || 0, s11w: share(w['11'] || 0, wt), s11v: share(v['11'] || 0, d3.sum(Object.values(v))), nExcl: (vis.WORLD?.X?.[String(y1)]?.w_excl || []).length,
            flows, tot, n, half: acc, top, topShare: share(top?.v || 0, s11.world?.[y1]?.xw || 0), dest: dest.map(([iso, v]) => ({ iso, v, s: share(v, destTot) })) };
    }),

    // Chapter 4: the two reports of the largest flows of 8549.11 (same rule as the Two reports view)
    reports: () => once('reports', async () => {
        const y1 = span()[1];
        const f = (await DataLoader.loadFlows('SPENT_11', y1)).filter(d => d.src !== 'e');
        const big = d => Math.max(d.xw || 0, d.mw || 0);
        const top = f.filter(d => big(d) > 0).sort((a, b) => big(b) - big(a)).slice(0, 12);
        const one = top.filter(d => !(d.xw > 0 && d.mw > 0)).length;
        const k = top.filter(d => d.xw > 0 && d.mw > 0 && Math.abs(d.mw / d.xw - 1) > 0.25).length;
        const both = f.filter(d => d.xw > 0 && d.mw > 0);
        const sx = sumBy(both, d => d.xw), sm = sumBy(both, d => d.mw);
        const wide = top.filter(d => d.xw > 0 && d.mw > 0).sort((a, b) => Math.abs(Math.log(b.mw / b.xw)) - Math.abs(Math.log(a.mw / a.xw)))[0] || null;
        return { y1, top, one, k, both: both.length, diff: sx ? sm / sx - 1 : 0, wide };
    }),

    // Chapter 5: HS versions used, year by year; the codes of 2022-2024
    hs: () => once('hs', async () => {
        const [y0, y1] = span();
        const [vis, s13] = await Promise.all([DataLoader.loadVisibility(), DataLoader.loadSummary('SPENT_13')]);
        const all = STATE.meta.economies.map(e => e.iso);
        const years = d3.range(Math.max(y0, 2022), y1 + 1);
        const byYear = years.map(y => {
            const rep = all.filter(iso => reported(iso, y));
            const h6 = rep.filter(iso => STATE.meta.hs_version[iso]?.[String(y)] === 'H6');
            return { y, all: all.length, rep: rep.length, h6: h6.length, old: rep.length - h6.length };
        });
        const s11 = years.map(y => { const w = vis.WORLD?.X?.[String(y)]?.w || {}; const t = d3.sum(Object.values(w)); return share(w['11'] || 0, t); });
        const tot13 = d3.sum(years, y => s13.world?.[y]?.x || 0);
        const totSpent = d3.sum(years, y => d3.sum(Object.values(vis.WORLD?.X?.[String(y)]?.v || {})));
        const m = new Map();
        years.forEach(y => own(s13, y, 'x').forEach(d => m.set(d.iso, (m.get(d.iso) || 0) + d.v)));
        const ex13 = [...m].map(([iso, v]) => ({ iso, v, s: share(v, tot13) })).sort((a, b) => b.v - a.v);
        return { years, byYear, s11, tot13, share13: share(tot13, totSpent), ex13 };
    }),

    // Chapter 6: Japan-ASEAN-India: who reported; trade within the group and into it (spent batteries, weight)
    jai: () => once('jai', async () => {
        const y1 = span()[1];
        const m = STATE.meta.presets.JAI.members;
        const mem = new Set(m);
        const f = (await DataLoader.loadFlows('SPENT_ALL', y1)).filter(d => d.src !== 'e' && d.w > 0);
        const within = f.filter(d => mem.has(d.e) && mem.has(d.i)).sort((a, b) => b.w - a.w);
        const into = f.filter(d => mem.has(d.i));
        const wt = sumBy(within, d => d.w), it = sumBy(into, d => d.w);
        return { y1, members: m, miss: m.filter(iso => !reported(iso, y1)), within, wt, it, big: within[0] || null, bigShare: share(within[0]?.w || 0, wt), inShare: share(wt, it) };
    }),

    // Chapter 7: Bangladesh: lead-acid batteries, by value, every year (partners' reports where it did not report)
    bgd: () => once('bgd', async () => {
        const [y0, y1] = span();
        const years = d3.range(y0, y1 + 1);
        const fs = await Promise.all(years.map(y => DataLoader.loadFlows('BAT_LA', y)));
        const rows = years.map((y, k) => {
            const f = fs[k].filter(d => d.src !== 'e' && d.v > 0);
            const imp = f.filter(d => d.i === 'BGD').sort((a, b) => b.v - a.v), ex = f.filter(d => d.e === 'BGD').sort((a, b) => b.v - a.v);
            return { y, own: reported('BGD', y), m: sumBy(imp, d => d.v), x: sumBy(ex, d => d.v), xDag: sumBy(ex.filter(d => d.src === 'm'), d => d.v), sup: imp[0]?.e || null, dst: ex[0]?.i || null, dstShare: share(ex[0]?.v || 0, sumBy(ex, d => d.v)) };
        });
        const last = [...rows].reverse().find(r => r.own)?.y ?? null;
        return { years, rows, last, r0: rows[0], r1: rows[rows.length - 1] };
    }),

    // Chapter 8: Asia's imports of spent lead-acid batteries (importers' own reports, 2022-2024); South Asia in 2024
    sasia: () => once('sasia', async () => {
        const [y0, y1] = span();
        const years = d3.range(Math.max(y0, 2022), y1 + 1);
        const [s11, f] = await Promise.all([DataLoader.loadSummary('SPENT_11'), DataLoader.loadFlows('SPENT_11', y1)]);
        const by = new Map();
        years.forEach(y => own(s11, y, 'm').forEach(d => { if (STATE.eco[d.iso]?.reg === '5300') by.set(d.iso, (by.get(d.iso) || 0) + d.v); }));
        const asia = d3.sum([...by.values()]);
        const subName = s => STATE.meta.subregions?.[s] || { 5310: 'Central Asia', 5340: 'Western Asia' }[s] || 'Other Asia';
        const sub = d3.rollups([...by], v => d3.sum(v, d => d[1]), d => STATE.eco[d[0]]?.sub || 'other').map(([s, v]) => ({ s, name: subName(s), v, sh: share(v, asia) })).sort((a, b) => b.v - a.v);
        const sasV = d3.sum([...by].filter(([iso]) => STATE.eco[iso]?.sub === '5320'), d => d[1]);
        const sasTop = [...by].filter(([iso]) => STATE.eco[iso]?.sub === '5320').sort((a, b) => b[1] - a[1])[0] || null;
        const sas = new Set(STATE.meta.presets.SAS.members);
        const fl = f.filter(d => d.src !== 'e' && sas.has(d.i) && d.w > 0);
        const dest = d3.rollups(fl, v => sumBy(v, d => d.w), d => d.i).sort((a, b) => b[1] - a[1]);
        const dTot = d3.sum(dest, d => d[1]);
        const sup = dest.length ? d3.rollups(fl.filter(d => d.i === dest[0][0]), v => sumBy(v, d => d.w), d => d.e).sort((a, b) => b[1] - a[1]) : [];
        return { years, asia, sub, sasV, sasShare: share(sasV, asia), sasTop, dest, dTot, sup };
    }),
};

// ── the chapters' text
const foot = (who, unit, y) => `${who}; ${unit}; ${y}. UN Comtrade; UNCTAD calculations.`;

export const Findings = {
    async 'battery-boom'() {
        const c = await Calc.boom();
        const r0 = c.rows[0], r1 = c.rows[c.rows.length - 1];
        const g = r1.t / r0.t, liG = share(r1.li - r0.li, r1.t - r0.t);
        const top = c.eco[r1.y][0], top0 = c.eco[r0.y].find(d => d.iso === top.iso);
        const pk = c.rows.find(r => r.y === c.peak.y);
        const html = [
            `World exports of lead-acid and lithium-ion batteries grew from ${B(usd(r0.t))} in ${r0.y} to ${K(usd(r1.t))} in ${yr(r1.y)}: ${B(times(g))} as much.`,
            `Lithium-ion accounts for ${B(pct(liG))} of that growth: it rose from ${usd(r0.li)} to ${B(usd(r1.li))}, lead-acid from ${usd(r0.la)} to ${usd(r1.la)}${c.over > r0.y ? `; lithium-ion overtook lead-acid by value in ${B(String(c.over))}` : ''}.`,
            `${cap(name(top.iso))} accounted for ${B(pct(share(top.v, r1.t)))} of these exports in ${yr(r1.y)} (its own report), up from ${pct(share(top0?.v || 0, r0.t))} in ${r0.y}.`,
        ];
        const prov = c.peak.y !== r1.y ? ` ${r1.y} is provisional: ${r1.n} economies had reported, against ${pk.n} for ${pk.y}, the highest year so far (${usd(pk.t)}).` : '';
        return { num: usd(r1.t), text: `world exports of lead-acid and lithium-ion batteries in ${r1.y}`, html, named: [top.iso], foot: foot('Exporters’ own reports', 'value in current US dollars', `${r0.y}–${yr(r1.y)}`) + prov };
    },

    async 'today-tomorrow'() {
        const c = await Calc.weight();
        const la = c.la, li = c.li;
        const wSh = share(la.w1, la.w1 + li.w1), vSh = share(la.v1, la.v1 + li.v1);
        const reg = (s, r) => s.regions.find(x => x.r === r)?.s || 0;
        const lead = li.regions[0];
        const html = [
            `By weight, the order is reversed: lead-acid batteries were ${K(pct(wSh))} of the weight of these exports in ${yr(c.y1)} (${B(tonnes(la.w1))}) but ${B(pct(vSh))} of their value.`,
            `Lithium-ion exports weighed ${B(tonnes(li.w1))}, ${B(times(li.w1 / li.w0))} their ${c.y0} weight.`,
            `${B(pct(lead.s))} of the lithium-ion weight came from exporters in ${lead.name}, against ${B(pct(reg(la, lead.r)))} for lead-acid; ${cap(name(li.ex[0].iso))} alone accounted for ${B(pct(share(li.ex[0].v, li.tot)))} (its own report).`,
        ];
        return { num: pct(wSh), text: `of the weight of lead-acid and lithium-ion battery exports in ${c.y1} was lead-acid`, html, named: [li.ex[0].iso, ...li.ex.slice(1, 3).map(d => d.iso)],
            foot: foot('Exporters’ own reports', `weight in tonnes; weights flagged as unreliable are left out (${la.excl} economies for lead-acid, ${li.excl} for lithium-ion)`, yr(c.y1)) };
    },

    // the lead finding (num, text) is the one the entry and the question page show
    async 'where-spent-go'() {
        const c = await Calc.spent();
        const d0 = c.dest[0];
        const html = [
            `In ${yr(c.y1)} economies reported ${B(usd(c.spentV))} of exports of spent batteries, ${B(pct(share(c.spentV, c.batV)))} of the value of battery exports (${usd(c.batV)}).`,
            `Spent lead-acid batteries (8549.11) made up ${B(pct(c.s11v))} of the value of spent batteries exported, and ${B(pct(c.s11w))} of their weight, leaving out the ${c.nExcl} economies whose weights fail the checks.`,
            `${K(String(c.n))} of the ${c.flows.length.toLocaleString('en-US')} exporter-to-importer flows with a weight carry half of the weight recorded in them. ${cap(name(c.top.iso))} accounted for ${B(pct(c.topShare))} of world exports of spent lead-acid batteries (its own report)${d0 ? `, ${B(pct(d0.s))} of it to ${name(d0.iso)}` : ''}.`,
        ];
        return { num: String(c.n), text: `exporter-to-importer flows carry half of the recorded weight of spent lead-acid batteries (8549.11) in ${yr(c.y1)}`, note: `Of ${c.flows.length.toLocaleString('en-US')} directed flows with a weight.`,
            html, named: [c.top.iso, ...(d0 ? [d0.iso] : [])], foot: foot('Exporters’ reports († importers’ where the exporter did not report)', 'value in US dollars and weight in tonnes; flagged weights left out of the shares', yr(c.y1)) };
    },

    async 'two-reports'() {
        const c = await Calc.reports();
        const w = c.wide;
        const html = [
            `Of the ${c.top.length} largest flows of spent lead-acid batteries in ${yr(c.y1)}, ${K(String(c.k + c.one))} have reports that differ by more than 25% (${c.k}) or a report from one side only (${c.one}).`,
            `On the ${B(c.both.toLocaleString('en-US'))} flows that both sides reported, importers recorded ${B(pct(Math.abs(c.diff)))} ${c.diff >= 0 ? 'more' : 'less'} weight in total than exporters.`,
            w ? `The widest gap among the largest flows: ${name(w.e)} reported ${B(tonnes(w.xw))} of exports to ${name(w.i)}; ${name(w.i)} reported ${B(tonnes(w.mw))} of imports from ${name(w.e)}.` : '',
        ].filter(Boolean);
        return { num: `${c.k + c.one} of the ${c.top.length}`, text: `largest flows of spent lead-acid batteries (by weight, ${yr(c.y1)}): the two reports differ by more than 25% (${c.k} flows), or only one side reported (${c.one})`,
            note: 'By weight, 2024. Solid strand = exporter’s report; outlined strand = importer’s report.', html, named: w ? [w.e, w.i] : [], wide: w,
            foot: foot('Both reports of each flow', 'weight in tonnes', yr(c.y1)) };
    },

    async 'cannot-see'() {
        const c = await Calc.hs();
        const a = c.byYear[0], z = c.byYear[c.byYear.length - 1];
        const ecos = STATE.meta.economies.length;
        const t3 = c.ex13.slice(0, 3);
        const html = [
            `In ${yr(z.y)}, ${K(String(z.h6))} of the ${z.rep} economies that reported used HS 2022, the version that splits spent batteries into five codes; for ${a.y} it was ${B(String(a.h6))} of ${a.rep}.`,
            `${B(String(z.old))} reporters still used an earlier version, with no split, and ${B(String(z.all - z.rep))} of the ${ecos} economies ${notYet().replace(' (2024 data are provisional)', '')}.`,
            `Lithium-ion has no code of its own. 8549.13, a code that includes it together with other chemistries, carried ${B(usd(c.tot13))} of exports in ${a.y}–${yr(z.y)} (${B(pct(c.share13))} of spent battery exports), led by ${list(t3.map(d => `${name(d.iso)} (${pct(d.s)})`))}.`,
        ];
        return { num: `${z.h6} of ${ecos}`, text: `economies reported their 2024 trade with the HS 2022 codes that split spent batteries; ${z.old} used an earlier version and ${ecos - z.rep} ${notYet()}`,
            note: 'Even in HS 2022, only lead-acid batteries have a code of their own (8549.11); the other four codes group several chemistries.', html, named: t3.map(d => d.iso),
            foot: foot('Economies’ own reports and HS versions', 'value in US dollars', `${a.y}–${yr(z.y)}`) };
    },

    async 'regional-rules'() {
        const c = await Calc.jai();
        const n = c.members.length;
        const miss = c.miss.map(i => STATE.countryNames[i] || i);
        const html = [
            `${K(`${c.miss.length} of ${n}`)} Japan–ASEAN–India economies ${notYet()}${miss.length ? `: ${list(miss)}; their rows in the matrix show partners’ reports (hatched) or no data (grey)` : ''}.`,
            c.big ? `Within the group, ${B(tonnes(c.wt))} of spent batteries were recorded in ${yr(c.y1)}; one flow, ${name(c.big.e)} to ${name(c.big.i)}, carried ${B(pct(c.bigShare))} of it.` : `No trade in spent batteries was recorded within the group in ${yr(c.y1)}.`,
            `Members imported ${B(tonnes(c.it))} of spent batteries in all, so ${B(pct(1 - c.inShare))} came from outside the group.`,
        ];
        return { num: `${c.miss.length} of ${n}`, text: `Japan–ASEAN–India economies ${notYet()}${miss.length ? `: ${list(miss)}` : ''}`, note: 'Their rows in the matrix show partners’ reports (hatched) or no data (grey).',
            html, named: c.big ? [c.big.e, c.big.i] : [], big: c.big, foot: foot('Exporters’ reports († importers’ where the exporter did not report)', 'spent batteries, all codes, weight in tonnes', yr(c.y1)) };
    },

    async bangladesh() {
        const c = await Calc.bgd();
        const r0 = c.r0, r1 = c.r1;
        const own1 = r1.own;
        const html = [
            own1
                ? `${K(pct(share(r1.xDag, r1.x + r1.m)))} of the lead-acid battery trade shown for Bangladesh in ${yr(r1.y)} comes from importers’ reports (†).`
                : `${K('100%')} of the lead-acid battery trade shown for Bangladesh in ${yr(r1.y)} comes from its partners’ reports: Bangladesh ${c.last ? `last reported its trade for ${B(String(c.last))}` : 'did not report in these years'}.`,
            `Its partners reported ${B(usd(r1.m))} of lead-acid battery exports to Bangladesh in ${yr(r1.y)}, against ${B(usd(r0.m))} in ${r0.y}${r1.sup ? `; the largest supplier in ${r1.y} was ${name(r1.sup)}` : ''}.`,
            r1.x ? `Importers reported ${B(usd(r1.x))} of lead-acid batteries from Bangladesh${own1 ? '' : ' (†)'}${r1.dst ? `, ${B(pct(r1.dstShare))} of it to ${name(r1.dst)}` : ''}. Trade data do not show why these amounts changed.` : '',
        ].filter(Boolean);
        const dag = pct(share(r1.xDag, r1.x + r1.m));
        return {
            num: own1 ? dag : '100%',
            text: own1 ? 'of the lead-acid battery trade shown for Bangladesh in 2024 comes from importers’ reports (†)' : 'of the lead-acid battery trade shown for Bangladesh in 2024 comes from its partners’ reports: Bangladesh ' + notYet(),
            note: own1 ? 'By value. Flows touching Bangladesh.' : `Its exports are the importers’ reports (†, dashed), ${pct(share(r1.x, r1.x + r1.m))} of the value shown; its imports are the exporters’ reports.`,
            html, named: [r1.sup, r1.dst].filter(Boolean), foot: foot('Partners’ reports (Bangladesh’s own reports up to its last year)', 'lead-acid batteries (8507.10, 8507.20), value in US dollars', `${r0.y}–${yr(r1.y)}`) };
    },

    async 'evidence-policy'() {
        const c = await Calc.sasia();
        if (!c.dest.length) return null;
        const d0 = c.dest[0];
        const sup = c.sup.slice(0, 3).map(d => name(d[0]));
        const a = c.years[0], z = c.years[c.years.length - 1];
        const html = [
            `In ${a}–${yr(z)} Asian economies reported ${B(usd(c.asia))} of imports of spent lead-acid batteries (8549.11); ${B(pct(c.sasShare))} of it was imported by Southern Asia${c.sasTop ? `, ${B(usd(c.sasTop[1]))} by ${name(c.sasTop[0])} alone` : ''}.`,
            `In ${yr(z)}, ${K(pct(d0[1] / c.dTot))} of the spent lead-acid batteries that reached Southern Asia by weight went to ${name(d0[0])}${sup.length ? `; the largest amounts came from ${list(sup)}` : ''}.`,
        ];
        return { num: pct(d0[1] / c.dTot), text: `of the spent lead-acid batteries that reach Southern Asia go to ${name(d0[0])}`, note: 'By weight, 2024, imports of the nine economies of Southern Asia.',
            html, named: [d0[0], ...c.sup.slice(0, 3).map(d => d[0])], foot: `Imports ${a}–${yr(z)}: importers’ own reports, value in US dollars. Flows ${yr(z)}: exporters’ reports († importers’ where the exporter did not report), weight in tonnes. UN Comtrade; UNCTAD calculations.` };
    },
};

// Plain text of a chapter, for screen readers
export const findingText = h => (h?.html || []).map(plain).join(' ');
