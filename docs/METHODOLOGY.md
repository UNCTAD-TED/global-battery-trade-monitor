# Methodology

Global Battery Trade Monitor (v1, prototype). Source: UN Comtrade; UNCTAD calculations.

## 1. Data

- **Source.** UN Comtrade (the United Nations database of official international trade statistics), annual data by 6-digit code of the Harmonized System (HS) of the World Customs Organization (WCO), the nomenclature that customs use to classify goods. Data are used as reported (each economy’s own HS version), downloaded through the UN Comtrade API. The extraction date is shown at the foot of the page.
- **Period.** 2016–2024. **2024 data are provisional**: fewer economies have reported, and figures may be revised.
- **Flows.** Exports (X) and imports (M) only. Re-exports and re-imports are not added separately (that would double-count them). Some economies include re-exports in their exports.
- **Units.** Values in current US dollars, not deflated. Weights are net weights in tonnes (kilograms divided by 1,000); on screen, t = tonnes, kt = thousand tonnes and Mt = million tonnes.
- **Rows used.** Totals only: no breakdown by second partner, customs procedure or mode of transport.

## 2. Products and HS definitions

| Product | HS 6-digit codes |
|---|---|
| Batteries (HS 8507, new or used) | 8507.10, 8507.20 (lead-acid), 8507.60 (lithium-ion), 8507.30/.40/.50/.80 (nickel-cadmium, nickel-iron, nickel-metal hydride, other) |
| Spent batteries, all chemistries | 8548.10 for economies reporting in HS 2017 or earlier; sum of 8549.11–8549.19 for economies reporting in HS 2022 |
| Spent batteries by code (2022–2024) | 8549.11, 8549.12, 8549.13, 8549.14, 8549.19 |

- **HS 8507 covers new and used batteries.** Chapter 85 Subheading Note 5 of the HS defines "spent" as unusable as such because of breakage, cutting-up, wear or other reasons, and not capable of being recharged. Used batteries that can still be used or recharged are therefore classified in 8507, together with new batteries, and cannot be separated from them.
- **Spent batteries include primary cells.** 8548.10 and 8549.11–8549.19 cover waste and scrap of primary cells and batteries as well as of accumulators.
- **8549.13 is not "lithium-ion".** Its official name is "Sorted by chemical type and not containing lead, cadmium or mercury". It includes lithium-ion batteries but also other chemistries. Only spent lead-acid batteries have their own code (8549.11).
- **HS versions.** Data are used in the version each economy reported. Codes 8507.50 and 8507.60 exist only from HS 2012; economies reporting in HS 2002 or HS 2007 record lithium-ion and nickel-metal hydride batteries in 8507.80 "Other accumulators". Code 8507.40 (nickel-iron) does not exist in HS 2022; such batteries are in 8507.80. The "other batteries" product sums all four codes, so its total is not affected. Economies that reported spent batteries in HS 2017 during 2022–2024 have no breakdown by 8549 subheading; the panels say so.
- No conversion between HS versions is made, and UN Comtrade’s back-converted data are not used.

## 3. How flows are chosen

Each direction is a separate flow: A → B and B → A are two arcs.

For a flow from exporter *i* to importer *j* in year *t*:

1. If *i* reported exports for year *t*, the flow is *i*’s own report (zero if it has no record for *j*). When *i*’s report has no record for *j* but *j* recorded imports from *i*, the flow is still zero in the reported view; such rows are flagged in the data ("importer only") so that the difference between the two reports can be shown.
2. Otherwise, if *j* reported imports for year *t*, the flow is *j*’s report of imports from *i*. **These flows are marked † (dagger)**: dashed on the map, hatched in the matrix, flagged in the CSV ("source_side = m"). The importer’s FOB value is used when every component has one; otherwise its CIF value.
3. If neither reported, there is no data ("no data", grey in the matrix).

Whether an economy reported in a year is decided from its total trade (all products) for that year and flow. Weights come from the same record as the value; a missing weight is not filled from the other side. Records of trade with oneself (re-imports) are dropped.

Both sides’ reports are kept for every pair, so the exporter’s and importer’s figures can be compared (economy panel, pair history, CSV). Exports are valued FOB (free on board: the value at the exporter’s border) and imports usually CIF (cost, insurance and freight: the value at the importer’s border), so values differ somewhat; weights do not depend on valuation. Larger gaps can come from classification, timing, transit or confidential data, and these statistics do not show which.

## 4. World totals

World exports (imports) are the sum of the reporting economies’ own reports to (from) the World. Flows marked † are not added. For an economy that did not report, its exports (imports) shown in the economy panel are the sum of its partners’ reports, marked †.

## 5. Weights

- **Reported weights only (reported view).** In the reported view no weight is estimated by UNCTAD; see section 11 for the optional estimated view. Weights that UN Comtrade itself estimated are kept and flagged (share shown in the country panel).
- **Economy totals are summed from partner rows.** The World row of an economy often has no weight even when its partner rows do (for example, several large exporters of lead-acid batteries in 2024). Economy weight totals are therefore the sum of the weights on partner rows; the share of value without weight is recorded.
- **Weight checks.** For each economy, product, flow and year, the weight is flagged when:
  1. partner rows worth at least USD 100,000 and at least 10% of the value have no weight; or
  2. the partner rows’ weight exceeds the World row’s weight by at least 20% and 100 tonnes; or
  3. the value per tonne is more than 8 times, or less than one eighth of, the median across economies for that product, flow and year.

  Flagged weights are hatched on the map, left out of weight rankings, and left out of world weight totals (the number left out is shown). Values per tonne are used only for this check and are not shown.

## 6. What these statistics cannot see

- Used batteries that can still be used or recharged are recorded with batteries (HS 8507), not as spent batteries.
- Batteries inside e-waste (HS 8549.21, 8549.31, 8549.91) are recorded together with other components and cannot be separated.
- Spent lithium-ion batteries have no HS code of their own.
- Batteries built into vehicles and equipment are normally classified with the vehicle or equipment.
- Black mass (shredded and sorted lithium-ion battery material) is classified differently by different economies; no figures are shown.
- Customs statistics record only what is declared, under the code that was declared.

## 7. Country codes and territories

- UN Comtrade codes follow customs territories and differ from UN M49 in some cases, for example: USA (842) includes Puerto Rico and the US Virgin Islands; France (251) includes Monaco and the overseas departments; Norway (579) includes Svalbard and Jan Mayen; Switzerland (757) includes Liechtenstein; India is 699. Codes are matched to the UNCTADstat economy list through ISO3 codes, never through names.
- Territories listed separately by UNCTADstat but included in another economy’s customs territory (for example Puerto Rico, the French overseas departments, Mayotte) show no data of their own.
- UN Comtrade code 490 "Other Asia, nes" is shown as **China, Taiwan Province of**, the UNCTADstat name.
- Partners that are not economies (Areas nes, Bunkers, Free zones, Special categories, "Other Europe nes" and similar) are not drawn. They are counted as "unallocated" in the reporting economy’s totals.
- Economy names follow the UNCTADstat economy list; flow categories follow the UNCTAD development status classification (developed 1500, developing 1400).

## 8. Known limitations

- Reporting status is decided from total trade. If an economy’s product-level figure is confidential, the flow can appear as zero.
- Fewer economies reported for 2024 than for earlier years.
- Exporters’ and importers’ reports can differ widely for spent batteries, including the HS 8549 subheading used for the same trade. The choice of rule (section 3) changes what is shown.
- Weights are missing or unreliable for some economies (section 5).
- The texts of the question pages (and of the story in the full edition) are computed from the UN Comtrade data of this tool when the page runs (UNCTAD calculations). Text quoted from the SMEP project reports (IS, BVC) and notes on the HS codes (WCO) are shown apart, with their source; figures in that text come from the reports and are not recomputed.

## 9. Matrix (full edition)

- Rows are exporters, columns importers. Cells are shaded on a log scale.
- White: no trade recorded (the exporter reported for the year). Grey: no data (neither side reported). Hatched: the importer’s report was used (†). White with hatching: the exporter did not report and the importer recorded no imports from it.
- Group cells (EU27 = UNCTADstat group 3412, Rest of world) are hatched when importer-reported flows are at least 10% of the cell. Trade within a group is not shown and is not in the totals.

## 10. Map disclaimer

The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations. Dotted and dashed boundary lines represent approximate borders for which the final status has not yet been determined.

## 11. Experimental estimates (optional view)

The dashboard shows reported figures by default. An optional estimated view adds **experimental estimates**: the exporter’s value for flows that the exporter did not report, and weights where they are missing or implausible. **Reported figures are never changed.** Estimates are marked as estimated and always come with a range. They are a research product, not official statistics, and may change. Details and test results: see the technical notes on value and weight estimates (available on request).

**Approach.** The estimates use mirror statistics: the two economies’ reports of the same trade flow, in the year concerned and in other years.

**What is estimated (values).** The estimate is the value the exporter would most likely have recorded (FOB).

- **The exporter reported:** its own figure is used; nothing is estimated.
- **Only the importer reported** (flows marked †): the importer’s figure is adjusted in up to three steps.
  *Step 1, CIF to FOB:* if the importer gives a FOB value, it is used; otherwise its CIF value is divided by the median ratio of CIF to FOB values in import records that show both (currently 1.042).
  *Step 2, the pair’s usual difference:* for the same pair and HS code, the two economies’ reports in other years are compared, and the usual ratio of the exporter’s figure to the importer’s figure is applied. Nearby years count more (the weight falls by about 40% for each year of distance), the ratio is pulled towards 1 when there are few years, and extreme ratios are capped at a factor of 20.
  *Step 3, the exporter’s own reports:* if the exporter reported this flow in the year before (or, for years before 2024, in the year after), 30% of the estimate comes from that figure, moved in line with world exports of the product. This part can raise the estimate by at most 60% or lower it by at most 20%.
  *Step 4, the year’s average difference:* all estimates for a year are multiplied by one factor per product family. The factor is set so that, for the pairs where both economies reported that year (each estimated as if the exporter had not reported), the estimates add up to what the exporters actually reported. For 2024 it lowers the estimates by about 7% (spent batteries by about 27%); for 2016–2022 it raises them by 4% to 9%.
  If the pair has no year in which both reported, steps 2 and 3 are skipped.
- **Neither reported:** if the same pair traded in nearby years, the value is interpolated between the nearest earlier and later year (at most two years away on each side), following the change in world exports of the product. At the end of the series (no later year), the last value is carried forward by one year only, following world exports. Otherwise there is no estimate. Such flows appear only in the estimated view. They are based only on reported figures for the neighbouring years, never on other estimates.
- **Classification:** estimates keep the HS code used by the importer. No conversion between HS versions is made.

**Ranges.** Each estimate has a 90% range, taken from the errors of the test described below for similar flows (same product family, similar size, similar pair history). For exporters with no history with the partner, the ranges come from a test in which whole exporters were hidden. Where exporters often record nothing for such flows (mostly small flows), the lower end of the range is zero. The range is for the exporter’s value: it can lie below or above the importer’s figure. Ranges for an economy’s total come from the same test applied to whole-year totals of a similar size and pair history. The range of a world total treats the errors of different economies as independent.

**How well it works.** Exporter reports that exist were hidden (all exports of one exporter in one year at a time) and estimated from the importers’ reports. The flows that are actually estimated differ from the tested ones: most are 2024 flows, for which only earlier years can be used. The test results were therefore re-weighted to match them (year 2024 or not, pair history, size):

- the error weighted by value was 37% of the value, against 48% when the importer’s figure is used as reported;
- the estimates added up to 93% of the exporters’ own values (importer’s figures as reported: 92%);
- for 2024 alone, the estimated totals of the exporters were between 2% too low and 5% too high, depending on how the test was split at random (without step 4: 7% to 12% too high; importer’s figures as reported: 2% too high);
- 93% of the exporters’ values fell inside the 90% range (94% for exporters treated as never reporting); for economies’ totals, 89%.

On all tested flows (mostly regular reporters, 2016–2023), the error weighted by value was 26%, against 39% for the importer’s figure as reported. Simpler rules (the importer’s figure as reported, or converted to FOB) and statistical models with fixed country and product effects were less accurate. A regression of the importer’s value on the exporter’s value, as used in some mirror-statistics work, is designed for the opposite direction; reversed, it greatly overstates large flows.

**Totals in the estimated view.** World exports add, to the reporters’ own totals, the estimated exports of the economies that did not report. World imports add the imports of non-reporting economies, taken from their partners’ export reports and from estimates. World weight totals with estimates are the sum of the economies’ totals with estimated weights.

**Limits.**

- An estimate is the value the exporter would probably have recorded, not a "true" value. Differences between the two reports can come from classification, timing, transit and re-exports, valuation or confidential data; these statistics do not show which.
- For re-export and collection hubs (for example the United Arab Emirates), the exporter’s value can differ a lot from the importer’s, in either direction; the estimate follows the exporter’s usual recording.
- An estimate can be several times the importer’s figure when, in other years, the exporter usually recorded much more than the importer.
- **2024.** The 2024 data are provisional. In 2023 and 2024 the exporters’ figures fell relative to the importers’ figures for the same pairs; why is not known. Step 4 corrects the average, but estimates for pairs whose importer figure rose sharply in 2024 are probably still too high: in the test, when the importer’s figure more than tripled, the exporter’s figure rose much less. The ranges are calibrated over all years, not for 2024 alone.
- When the difference between the two reports changes suddenly, the estimate can be far off; one unusual year in the pair’s history can move it (for example, United States to Mexico, lithium-ion, 2024: the importer’s figure rose about fivefold while the exporter’s figure doubled).
- The upper end of a range is cut at 1,000 times the estimate. This affects only a few flows below USD 10,000, for which the test errors are larger still.
- For economies that never report, there is no pair history, and the estimate is the importer’s figure converted to FOB; it is no more accurate than the importer’s figure itself.
- For 8549.14 and 8549.19 (codes that exist only since 2022, so pair histories are short), the estimates were less accurate in the test than for other codes.

**Estimated weights.** Many weights in UN Comtrade are not reported by the economies: UN Comtrade estimated about a quarter to two fifths of the tonnage itself, some records have no weight, and a few reported weights are implausible. In the estimated view, each record without a usable weight gets an estimate: its value divided by an expected value per tonne. The expected value per tonne comes from a statistical model of all reported weights. It takes into account the product, year and flow, the exporting and importing economy, the reporter’s usual practice, the same pair of economies in other years, and the partner’s reports. Reported weights are kept. A reported weight is replaced only when it is implausible against two independent references (the model and the partner’s report of the same flow, or the partner’s report and the values per tonne of all other reporters), and only if the two reports do not agree on the weight itself. UN Comtrade’s own estimates are kept unless they fail the same check. In addition, **some UN Comtrade estimates are replaced by rule**: when one differs by a factor of two or more, in the same direction, from both the partner’s report and the reporter’s own reported weights in neighbouring years, it is replaced using the partner’s report, but only if the result is itself plausible, that is, close to the usual value per tonne of the product (for example, the United States’ 2024 imports of lithium-ion batteries from China: UN Comtrade’s estimate of 326,000 tonnes is replaced by about 924,000 tonnes, the weight China reported). This rule is a judgement; it could not be tested on hidden data. Each estimate has a 90% range. The method was tested by hiding reported weights (all weights of one economy, flow and year at a time) and predicting them: 90% of the hidden weights fell within their 90% range, and the typical error was a factor of 1.5 (1.1 for flows above USD 10 million). Each weight is marked: reported; UN Comtrade’s own estimate; taken from the quantity field; model estimate; or reported weight replaced after a quality check. The exporter’s and the importer’s tonnages still differ, mostly because their values differ: the two reports often cover different amounts of trade. A reporter’s weights that are wrong in the same way for several years are checked as a series, but some can still remain as reported, so a series can occasionally jump between years where the weight was kept and years where it was replaced. The ranges cover 90% of the hidden weights when they are counted one by one; weighted by tonnes, coverage is lower for some groups (see the technical notes, available on request).

## 12. How to cite

UNCTAD (2026). Global Battery Trade Monitor (v1, prototype). Source: UN Comtrade; UNCTAD calculations.
