# Global Battery Trade Monitor (prototype)

An UNCTAD dashboard on trade in batteries (HS 8507) and spent batteries (HS 8549.1, and 8548.10 before HS 2022), 2016–2024. It shows both reports of each flow: the exporting economy's and the importing economy's, as reported to UN Comtrade.

**Site:** https://unctad-ted.github.io/global-battery-trade-monitor/ (the edition prepared for the Basel Convention meeting).

- **Start with a question:** where batteries come from, where spent batteries go, whether the two reports agree, and what the statistics cannot see.
- **Explore the data:** a map of directed flows, the two reports side by side, a table, and economy panels. Every view can be downloaded as CSV.
- 2024 data are provisional. Figures are UNCTAD calculations from UN Comtrade data.

## Run it locally (Node 20+)

```
npm install
npm run dev:basel      # the Basel edition, http://localhost:5173
npm run dev            # the full edition
npm run build:basel    # writes dist-basel/ (what is published)
```

The data the site reads are in `public/data/` (JSON, built from UN Comtrade).

## Publishing

Every push to `main` builds the Basel edition and publishes it to GitHub Pages (`.github/workflows/deploy-pages.yml`).

## Source and disclaimer

Source: UN Comtrade; UNCTAD calculations.

The boundaries and names shown and the designations used on the maps do not imply official endorsement or acceptance by the United Nations. Dotted and dashed boundary lines represent approximate borders for which the final status has not yet been determined.
