import * as d3 from 'd3';
import { STATE, METRIC_FORMAT, isProvisional } from './config.js';
import { DataLoader } from './dataLoader.js';
import { SOURCES, VISIBILITY_TEXT, cite } from './storyData.js';
import { pct as fpct } from './storyFindings.js';

// Visibility panel and statistical blind spots (spec 7.6).
// Spent battery weight 2022-2024 by HS 6-digit code, own reports of the economies in scope.
const KEYS = [
    { k: '11', label: '8549.11 Lead-acid' },
    { k: '12', label: '8549.12 Other, containing lead, cadmium or mercury' },
    { k: '13', label: '8549.13 Sorted by chemical type, not containing lead, cadmium or mercury' },
    { k: '14', label: '8549.14 Unsorted, not containing lead, cadmium or mercury' },
    { k: '19', label: '8549.19 Other' },
    { k: 'h5', label: 'Reported in HS 2017 or earlier (8548.10, no breakdown)' },
];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const VisibilityPanel = {
    scope: 'WORLD',
    flow: 'X',

    defaultScope() {
        if (STATE.selectedCountry) return STATE.selectedCountry;
        if (STATE.preset !== 'GLOBAL') return STATE.preset;
        return 'WORLD';
    },

    scopeLabel(s) {
        if (s === 'WORLD') return 'World (reporting economies)';
        if (STATE.meta.presets[s]) return STATE.meta.presets[s].label;
        return STATE.countryNames[s] || s;
    },

    async render(el, opts = {}) {
        if (opts.scope) this.scope = opts.scope;
        if (opts.flow) this.flow = opts.flow;
        const vis = await DataLoader.loadVisibility();
        const scopes = ['WORLD', 'JAI', 'SAS'];
        if (STATE.selectedCountry && !scopes.includes(STATE.selectedCountry)) scopes.push(STATE.selectedCountry);
        if (!scopes.includes(this.scope)) scopes.push(this.scope);
        const data = vis[this.scope]?.[this.flow] || {};
        const years = ['2022', '2023', '2024'];
        const totals = years.map(y => d3.sum(KEYS, k => data[y]?.w?.[k.k] || 0));
        const max = d3.max(totals) || 1;
        const fmt = METRIC_FORMAT.weight.fmt;

        const bars = years.map((y, n) => {
            const r = data[y];
            if (!r) return `<div class="vb-row"><span class="vb-year">${y}</span><span class="vb-empty">No data for this year</span></div>`;
            const segs = KEYS.map(k => {
                const v = r.w[k.k] || 0;
                if (!v) return '';
                const pct = 100 * v / max;
                return `<span class="vb-seg vk-${k.k}" style="width:${pct.toFixed(2)}%" title="${esc(k.label)}: ${fmt(v)} (${fpct(v / totals[n])})"></span>`;
            }).join('');
            const excl = (r.w_excl || []).length;
            return `<div class="vb-row"><span class="vb-year">${y}${isProvisional(y) ? 'ᵖ' : ''}</span>
                <span class="vb-bar">${segs}</span><span class="vb-tot">${fmt(totals[n])}</span></div>
                <div class="vb-meta">${r.n} reporting economies${excl ? ` · ${excl} with flagged weight left out` : ''}</div>`;
        }).join('');

        const shares = (() => {
            const y = '2024';
            const r = data[y];
            if (!r) return '';
            const t = totals[2] || 1;
            return `<table class="si-table vb-table"><thead><tr><th class="al">HS code, ${y}</th><th class="ar">Weight</th><th class="ar">Share</th><th class="ar">Value</th></tr></thead><tbody>
              ${KEYS.map(k => `<tr><td class="al"><i class="vb-sw vk-${k.k}"></i>${esc(k.label)}</td><td class="ar">${fmt(r.w[k.k] || 0)}</td>
                  <td class="ar">${r.w[k.k] ? fpct(r.w[k.k] / t) : '0%'}</td><td class="ar">${METRIC_FORMAT.value.fmt(r.v[k.k] || 0)}</td></tr>`).join('')}
              </tbody></table>`;
        })();

        el.innerHTML = `
          <div class="vp-controls">
            <label class="vp-lab">Scope
              <select id="vp-scope">${scopes.map(s => `<option value="${s}" ${s === this.scope ? 'selected' : ''}>${esc(this.scopeLabel(s))}</option>`).join('')}</select>
            </label>
            <span class="tb-seg vp-flow" role="group" aria-label="Exports or imports">
              <button class="btn-toggle ${this.flow === 'X' ? 'active' : ''}" type="button" data-vflow="X" aria-pressed="${this.flow === 'X'}">Exports</button>
              <button class="btn-toggle ${this.flow === 'M' ? 'active' : ''}" type="button" data-vflow="M" aria-pressed="${this.flow === 'M'}">Imports</button>
            </span>
          </div>
          <p class="vp-note">${esc(VISIBILITY_TEXT.note)}</p>
          <div class="vb-chart">${bars}</div>
          <div class="vb-legend">${KEYS.map(k => `<span><i class="vb-sw vk-${k.k}"></i>${esc(k.label)}</span>`).join('')}</div>
          ${shares}
          <div class="si-sublabel">Weight in tonnes, own reports of the economies in scope (partner rows summed). Weights flagged as unreliable (see Methodology) are left out.</div>
          <h3 class="vp-h4">Not visible in these statistics</h3>
          <ul class="vp-list">${VISIBILITY_TEXT.notVisible.map(i => `<li>${esc(i.text)} <span class="cp-src">(${esc(cite(i.src, i.page))})</span></li>`).join('')}</ul>
          <div class="si-sublabel">Sources: ${[...new Set(VISIBILITY_TEXT.notVisible.map(i => i.src))].map(s => `${s}: ${esc(SOURCES[s])}`).join('; ')}.</div>`;

        // keep the focus on the control that was used (the panel is drawn again)
        el.querySelector('#vp-scope').addEventListener('change', (e) => this.render(el, { scope: e.target.value }).then(() => el.querySelector('#vp-scope')?.focus()));
        el.querySelectorAll('[data-vflow]').forEach(b => b.addEventListener('click', () => this.render(el, { flow: b.dataset.vflow }).then(() => el.querySelector(`[data-vflow="${b.dataset.vflow}"]`)?.focus())));
    },
};
