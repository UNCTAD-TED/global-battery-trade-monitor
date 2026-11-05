// Methodology modal (spec 7.8): renders docs/METHODOLOGY.md, so the page and the document stay the same.
import md from '../docs/METHODOLOGY.md?raw';
import { longDate } from './storyFindings.js';

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

// Minimal Markdown: headings, paragraphs, lists (one level, with continuation lines), tables.
export function renderMarkdown(src) {
    const lines = src.replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) { i++; continue; }
        let m;
        if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
            const lv = m[1].length;
            if (lv > 1) out.push(`<h${lv + 1} class="method-section-title">${inline(m[2])}</h${lv + 1}>`);
            i++; continue;
        }
        if (l.startsWith('|')) {
            const rows = [];
            while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
            const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
            const head = cells(rows[0]);
            const body = rows.slice(2).map(cells);
            out.push(`<table class="si-table method-table"><thead><tr>${head.map(h => `<th class="al">${inline(h)}</th>`).join('')}</tr></thead>
              <tbody>${body.map(r => `<tr>${r.map(c => `<td class="al">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
            continue;
        }
        if (/^(\s*)([-*]|\d+\.)\s+/.test(l)) {
            const ordered = /^\s*\d+\./.test(l);
            const items = [];
            while (i < lines.length && lines[i].trim() && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || /^\s{2,}/.test(lines[i]))) {
                if (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^\s{3,}/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
                else items[items.length - 1] += ' ' + lines[i].trim();
                i++;
                // blank line followed by an indented continuation stays in the item
                while (i < lines.length && !lines[i].trim() && /^\s{2,}\S/.test(lines[i + 1] || '')) i++;
            }
            const tag = ordered ? 'ol' : 'ul';
            out.push(`<${tag} class="method-list">${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
            continue;
        }
        const para = [];
        while (i < lines.length && lines[i].trim() && !/^(#|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
        out.push(`<p class="method-note">${inline(para.join(' '))}</p>`);
    }
    return out.join('\n');
}

export const Methodology = {
    html(buildInfo) {
        // this version in words (the build's parameter names are in build_info.json, not shown to readers)
        const rule = buildInfo?.reconcile_mode === 'exporter_first' ? ' Each flow is the exporter’s report, or the importer’s report (†) where the exporter did not report.' : '';
        const wts = buildInfo?.weights?.country_total === 'partner_sum' ? ' Weights as reported; an economy’s total weight is the sum of its partner rows.' : ' Weights as reported.';
        const extra = buildInfo
            ? `<p class="method-note"><strong>This version:</strong> data extracted from UN Comtrade on ${longDate(buildInfo.extracted)}.${rule}${wts}${buildInfo.estimation ? ' Experimental estimates are shown only in the Estimated view.' : ''}</p>`
            : '';
        return extra + renderMarkdown(md);
    },
};
