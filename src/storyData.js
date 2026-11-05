// Text and figures taken from documents (spec 8, as revised on 2026-11-04: docs/DECISIONS.md). This is the
// ONLY file that holds numbers taken from documents; every other number on the page is computed from
// public/data when the page runs. Text is used as written; do not paraphrase. Every item carries a source.
//
// Sources
//   IS:  SMEP, "Impact Story 2: The circularity trap", October 2026 (PDF pages)
//   BVC: SMEP, "Battery Value Chains: The challenges for e-mobility in South Asia"
//        (disclaimer date 2025-03-01, printed pages)
//   WCO: Harmonized System 2022, heading 85.49 and Chapter 85 Subheading Note 5
//
// IS and BVC are outputs of the SMEP project; WCO is the HS nomenclature. They are shown in separate blocks
// ("From the SMEP reports", "HS notes"), apart from the text computed from UN Comtrade.

export const SOURCES = {
    BVC: 'SMEP, Battery Value Chains: The challenges for e-mobility in South Asia (2025)',
    IS: 'SMEP, Impact Story 2: The circularity trap, October 2026',
    WCO: 'Harmonized System Nomenclature, 2022 edition (heading 85.49; Chapter 85, Subheading Note 5)',
};

// How a source is named in the cite after an item, for readers outside the project:
// "(SMEP Impact Story 2, PDF p. 6)", "(WCO, Chapter 85, Subheading Note 5)"
export const CITE = { IS: 'SMEP Impact Story 2', BVC: 'SMEP Battery Value Chains', WCO: 'WCO' };
export const cite = (src, page) => `${CITE[src] || src}${page ? `, ${page}` : ''}`;

// The kind of each source: report text (SMEP project outputs) or notes on the HS codes (WCO).
export const SOURCE_KIND = { IS: 'report', BVC: 'report', WCO: 'hs' };

// Notes per story chapter (src/storyMode.js SCENES, matched by id). Only chapters with notes are listed.
export const STORY_CARDS = [
    {
        id: 'today-tomorrow',
        title: 'Today’s batteries, tomorrow’s spent batteries',
        items: [
            { text: 'HS 8507 also covers used batteries that can still be used or recharged.', src: 'WCO', page: 'Chapter 85, Subheading Note 5', note: true },
        ],
    },
    {
        id: 'where-spent-go',
        title: 'Spent batteries: a small, concentrated trade',
        items: [
            { text: 'In the HS, spent cells and batteries are those that can no longer be used as such, because of breakage, cutting-up, wear or other reasons, and cannot be recharged.', src: 'WCO', page: 'Chapter 85, Subheading Note 5', note: true },
        ],
    },
    {
        id: 'cannot-see',
        title: 'What the codes cannot see',
        items: [
            { text: '“...customs data do not consistently separate spent batteries by type.”', src: 'IS', page: 'PDF p. 6' },
            { text: 'Used batteries that can still be used or recharged are classified with batteries (HS 8507), not as spent batteries.', src: 'WCO', page: 'Chapter 85, Subheading Note 5' },
            { text: 'HS 8549.13 is not a lithium-ion code. Its official name is “Sorted by chemical type and not containing lead, cadmium or mercury”, and it also covers other chemistries.', src: 'WCO', page: 'heading 85.49', note: true },
            { text: 'Batteries inside e-waste are recorded together with other components (HS 8549.21, 8549.31, 8549.91).', src: 'WCO', page: 'heading 85.49' },
        ],
    },
    {
        id: 'bangladesh',
        title: 'When recycling goes wrong: Bangladesh',
        items: [
            { text: 'Import restrictions from 2015; an 89% effective tax on three-wheeler batteries; 73% of manufacturers established after 2015 (among those with known start dates). Locally made batteries had shorter lifespans, increasing replacement, recycling, smelting and exposure to lead.', src: 'IS', page: 'PDF p. 4' },
            { text: 'Bangladesh generates about 118,000 tonnes of used lead-acid batteries a year; more than 80% are informally recycled.', src: 'IS', page: 'PDF p. 3' },
        ],
    },
    {
        id: 'evidence-policy',
        title: 'From evidence to policy',
        items: [
            { text: 'Project evidence and recommendations were incorporated into the National Strategy and Multi-Year Action Plan for a Lead-Free Bangladesh (2026–2035), approved by Cabinet in August 2026, across four of its eight pillars.', src: 'IS', page: 'PDF p. 6' },
            { text: 'Project findings fed engagement around Basel Convention guidelines on the environmentally sound management of waste lead-acid and other waste batteries.', src: 'IS', page: 'PDF p. 8, Table 3' },
        ],
    },
];

// Country panel, Bangladesh only (spec 7.5, 8).
export const POLICY_TIMELINE = {
    BGD: [
        { year: '2015', text: 'Import restrictions on batteries.', src: 'IS', page: 'PDF p. 4' },
        { year: '2021', text: 'Three-wheel rickshaws formally banned over safety concerns; still widely used.', src: 'BVC', page: 'p. 2' },
        { year: '2023', text: 'Electric-vehicle lead-acid batteries brought under mandatory certification.', src: 'IS', page: 'PDF p. 7, Table 2' },
        { year: '2025 and June 2026', text: 'Import duties reduced to as little as 1% for locally manufactured lithium-ion, sodium-ion and battery-pack production, through 2030; not attributable to SMEP.', src: 'IS', page: 'PDF p. 6', note: 'Outside the data period (2016–2024).' },
    ],
};

// Visibility panel (spec 7.6). Heading and note as given in the spec.
export const VISIBILITY_TEXT = {
    heading: 'Spent batteries by HS 6-digit code',
    note: 'Only spent lead-acid batteries have their own HS 6-digit code (8549.11). Spent lithium-ion batteries have no code of their own; they are recorded together with other chemistries (for example under 8549.13, ‘sorted by chemical type and not containing lead, cadmium or mercury’).',
    // "Not visible in these statistics" (spec 3.4), from the IS report and the HS (WCO) only.
    // Not yet listed, pending confirmation (docs/DECISIONS.md): batteries built into vehicles and
    // equipment (spec 3.4-3, wording to be checked against the HS rules) and black mass (3.4-4, spec 14 N11).
    notVisible: [
        { text: 'Used batteries that can still be used or recharged are classified with batteries (HS 8507), not as spent batteries.', src: 'WCO', page: 'Chapter 85, Subheading Note 5' },
        { text: 'Batteries inside e-waste are recorded together with other components (HS 8549.21, 8549.31, 8549.91).', src: 'WCO', page: 'heading 85.49' },
        { text: 'Spent batteries are not consistently separated by chemistry or type in customs data.', src: 'IS', page: 'PDF p. 6' },
    ],
};
