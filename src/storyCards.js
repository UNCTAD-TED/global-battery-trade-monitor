import { STORY_CARDS, SOURCES, SOURCE_KIND, cite } from './storyData.js';

// Story chapters (docs/design/STORY_V5.md). Each chapter is an article (.sc-card[data-id]): its title, the text
// computed from UN Comtrade (src/storyFindings.js, filled when the page runs), any fixed UNCTAD text, and then,
// set apart, the notes taken from documents (src/storyData.js, verbatim, with their sources) in two blocks:
// "From the SMEP reports (IS, BVC)" and "Notes on the HS codes (WCO)". A block is shown only where it has
// content. The chapter ends with a button that opens the explorer in the matching state.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uniq = a => [...new Set(a)];

export const BLOCKS = [['report', 'From the SMEP project reports'], ['hs', 'Notes on the HS codes']];

export const cardById = id => STORY_CARDS.find(c => c.id === id);

// The note blocks of one chapter (also used on the question pages, src/pages.js)
export function noteBlocks(id) {
    const c = cardById(id);
    if (!c) return [];
    return BLOCKS.map(([kind, head]) => {
        const items = c.items.filter(i => SOURCE_KIND[i.src] === kind);
        const srcs = uniq(items.map(i => i.src));
        return { kind, head: `${head} (${srcs.join(', ')})`, label: `${head} (${srcs.join(', ')}): ${c.title}`, items, srcs };
    }).filter(b => b.items.length);
}
export const itemsHtml = items => `<ul class="sc-items">${items.map(i => `<li class="${i.note ? 'sc-note' : ''}">${esc(i.text)} <span class="sc-cite">(${esc(cite(i.src, i.page))})</span></li>`).join('')}</ul>`;
export const sourcesHtml = srcs => `<div class="sc-sources"><span class="sc-sources-h">${srcs.length > 1 ? 'Sources' : 'Source'}</span>${srcs.map(s => `<div>${s}: ${esc(SOURCES[s])}</div>`).join('')}</div>`;

export function notesHtml(id, level = 3) {
    return noteBlocks(id).map(b => `<section class="sc-block sc-block-${b.kind}" aria-label="${esc(b.label)}">
          <h${level} class="sc-num">${esc(b.head)}</h${level}>${itemsHtml(b.items)}${sourcesHtml(b.srcs)}</section>`).join('');
}

export function cardButtonLabel(show) {
    return show.visibility ? 'Open the HS code panel' : (show.view === 'matrix' ? 'Show the matrix' : show.view === 'gap' ? 'Compare reports in the explorer' : 'Show on map');
}

// One chapter. `extra` is fixed UNCTAD text (no numbers), shown after the computed text.
export function chapterHtml(sc) {
    return `<article class="sc-card" data-id="${sc.id}" aria-labelledby="sc-t-${sc.id}">
        <h2 class="sc-title" id="sc-t-${sc.id}">${esc(sc.title)}</h2>
        <div class="st-headline" aria-hidden="true"></div>
        ${(sc.extra || []).map(p => `<p class="st-p">${esc(p)}</p>`).join('')}
        ${notesHtml(sc.id)}
        <button class="sc-btn" type="button" data-card="${sc.id}">${cardButtonLabel(sc.show)} <span aria-hidden="true">&rarr;</span></button>
      </article>`;
}
