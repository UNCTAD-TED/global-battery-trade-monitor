import { CONFIG, STATE, METRIC_FORMAT, fmtMetric, isProvisional } from './config.js';
import { DataLoader } from './dataLoader.js';

// "Table" view (docs/design/EXPLORER_V4.md): the flows in view (the same top 20 / 40 as the map and the ranked
// list) as a sortable table with the columns of the CSV export, † for the importer's report and est. for
// experimental estimates. A row opens the pair history (click, or Enter on the focused row).
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nm = iso => STATE.countryNames[iso] || iso;

// the weight basis codes of the data, in words (also explained in the CSV notes)
const WB = { reported: 'reported', comtrade_estimate: 'UN Comtrade estimate', missing: 'value without weight', no_record: 'no record' };

const COLS = [
    { k: 'rank', l: '#', num: true, v: (d, k) => k + 1 },
    { k: 'e', l: 'Exporter', v: d => nm(d.e) },
    { k: 'i', l: 'Importer', v: d => nm(d.i) },
    { k: 'fc', l: 'Flow category', v: d => CONFIG.flowShort[d.fc] || '' },
    { k: 'val', l: 'Value shown', num: true, v: d => DataLoader.val(d), metricDependent: true },
    { k: 'src', l: 'Source side', v: d => (d.src === 'm' ? 'importer †' : d.src === 'e' ? 'estimate' : 'exporter') },
    { k: 'xv', l: 'Exporter’s report, US$', num: true, v: d => d.xv, f: v => METRIC_FORMAT.value.fmt(v) },
    { k: 'mv', l: 'Importer’s report, US$', num: true, v: d => d.mv, f: v => METRIC_FORMAT.value.fmt(v) },
    { k: 'xw', l: 'Exporter’s report, t', num: true, v: d => d.xw, f: v => METRIC_FORMAT.weight.fmt(v) },
    { k: 'mw', l: 'Importer’s report, t', num: true, v: d => d.mw, f: v => METRIC_FORMAT.weight.fmt(v) },
    { k: 'wb', l: 'Weight basis', v: d => WB[d.wb] ?? (d.wb || '').replace(/_/g, ' ') },
];

export const TableView = {
    el: null,
    sort: { k: 'val', dir: -1 },

    init(el) {
        this.el = el;
        el.addEventListener('click', (e) => {
            const h = e.target.closest('[data-tsort]');
            if (h) {
                const k = h.dataset.tsort;
                this.sort = { k, dir: this.sort.k === k ? -this.sort.dir : (COLS.find(c => c.k === k)?.num ? -1 : 1) };
                this.render();
                this.el.querySelector(`[data-tsort="${k}"]`)?.focus({ preventScroll: true });
                return;
            }
            const r = e.target.closest('tr[data-pair]');
            if (r) { const [a, b] = r.dataset.pair.split('|'); document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e: a, i: b } })); }
        });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const r = e.target.closest('tr[data-pair]');
            if (!r) return;
            e.preventDefault();
            const [a, b] = r.dataset.pair.split('|');
            document.dispatchEvent(new CustomEvent('bm:arc-click', { detail: { e: a, i: b } }));
        });
    },

    render() {
        if (!this.el) return;
        const a = document.activeElement;
        const keep = a && this.el.contains(a) ? (a.dataset?.pair ? `tr[data-pair="${a.dataset.pair}"]` : a.dataset?.tsort ? `[data-tsort="${a.dataset.tsort}"]` : null) : null;
        const p = DataLoader.product();
        const flows = (STATE.filteredData || []).map((d, k) => ({ d, k }));
        const col = COLS.find(c => c.k === this.sort.k) || COLS[4];
        const sv = x => { const v = col.v(x.d, x.k); return v == null ? (col.num ? -Infinity : '') : v; };
        flows.sort((x, y) => { const a1 = sv(x), b1 = sv(y); return (typeof a1 === 'number' ? a1 - b1 : String(a1).localeCompare(String(b1))) * this.sort.dir; });
        const est = DataLoader.estActive();
        const unit = STATE.metric === 'weight' ? 'tonnes' : 'US$';
        const head = COLS.map(c => {
            const on = this.sort.k === c.k;
            const lab = c.k === 'val' ? `${STATE.metric === 'weight' ? 'Weight' : 'Value'} shown` : c.l;
            return `<th scope="col" class="${c.num ? 'num' : 'l'}" aria-sort="${on ? (this.sort.dir < 0 ? 'descending' : 'ascending') : 'none'}"><button type="button" class="th-btn" data-tsort="${c.k}">${esc(lab)}${on ? `<span aria-hidden="true"> ${this.sort.dir < 0 ? '↓' : '↑'}</span>` : ''}</button></th>`;
        }).join('') + (est ? '<th scope="col" class="l">Estimate (90% interval)</th>' : '');
        const rows = flows.map(({ d, k }) => {
            const isE = DataLoader.isEst(d), iv = DataLoader.interval(d);
            const cells = COLS.map(c => {
                let v = c.v(d, k);
                if (c.k === 'val') v = `${isE ? '≈' : ''}${fmtMetric(v)}${d.src === 'm' ? '<sup class="dag">†</sup>' : ''}${isE ? ' <span class="est-badge">est.</span>' : ''}`;
                else if (c.f) v = v == null ? '<span class="muted">no record</span>' : c.f(v);
                else v = esc(v);
                return `<td class="${c.num ? 'num' : 'l'}">${v}</td>`;
            }).join('');
            const estCell = est ? `<td class="l">${isE ? `${fmtMetric(DataLoader.val(d))}${iv ? ` (${fmtMetric(iv[0])} – ${fmtMetric(iv[1])})` : ''}` : '<span class="muted">reported</span>'}</td>` : '';
            return `<tr data-pair="${d.e}|${d.i}" tabindex="0" class="${STATE.highlightPair === `${d.e}|${d.i}` ? 'on' : ''}" aria-label="${esc(nm(d.e))} to ${esc(nm(d.i))}: ${esc(fmtMetric(DataLoader.val(d)))}${d.src === 'm' ? ', importer’s report' : ''}${isE ? ', estimate' : ''}. Open the pair history">${cells}${estCell}</tr>`;
        }).join('');
        const all = (STATE.scopeFlows || []).length;
        this.el.innerHTML = `<div class="tv">
            <div class="tv-head">
              <h2 class="tv-title">${esc(p.label)} &middot; ${STATE.year}${isProvisional(STATE.year) ? ' (provisional)' : ''} &middot; ${unit}</h2>
              <p class="tv-note">The ${flows.length} largest flows of the ${all.toLocaleString('en-US')} in this selection, as on the map. Select a column to sort it, a row for the pair’s history. <b class="dag">†</b> = importer’s report (the exporter did not report for the year)${est ? '; est. = experimental estimate' : ''}. All ${all.toLocaleString('en-US')} flows: Menu › Download CSV.</p>
            </div>
            ${flows.length ? `<div class="tv-scroll"><table class="tv-table"><caption class="sr-only">Flows in view, ${esc(p.label)}, ${STATE.year}</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
                : '<p class="cl-empty">No flows with data in this selection. Try another year or product, or all economies.</p>'}
          </div>`;
        if (keep) this.el.querySelector(keep)?.focus({ preventScroll: true });
    },
};
