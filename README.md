# OctagonRank

OctagonRank is a React-based UFC rankings prototype focused on making fighter rankings more transparent. The app presents a UFC-style rankings board, compares multiple ranking sources, and lets users open a fighter profile without leaving the page.

## Current Features

- Men's division rankings laid out in a UFC-inspired board format
- Toggle between three ranking sources:
  - Our model
  - UFC Meta rankings
  - Media rankings
- Animated in-page fighter profile view
- Fighter profile summary with record, wins, significant strikes, TKO/KO wins, submissions, and activity status
- Score explanation panel showing the ranking signals used for selected prototype fighters
- Detailed stat panel for Benoit Saint Denis, including striking accuracy, takedown accuracy, strike targets, strike positions, and win method breakdown
- Methodology and audit pages with draft placeholder content

## Tech Stack

- React
- Vite
- Framer Motion
- Lucide React
- CSS

## Running Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Scrape UFCStats completed fights from January 1, 2000 through June 24, 2026:

```bash
npm run scrape:ufcstats
```

The scraper writes JSON and CSV files to `data/ufcstats/`, including events,
fights, per-fighter fight totals, per-round stats, and fighter profile stats.
That output directory is ignored by git because a full scrape can be large.

Manual fight-context annotations live in `data/manual_annotations/`. These are
source-backed rows for things UFCStats does not represent cleanly, such as
controversial decisions, injury finishes, short-notice fights, weight misses,
division moves, and major layoffs.

Title-lineage policy context lives in `data/ranking_inputs/title_context.json`.
This small manual input handles cases like recent title losers, former
champions, and interim champions without hiding the adjustment in the score.

Current-division movement context lives in
`data/ranking_inputs/division_context.json`. This source-backed file removes
fighters from old divisions and places them in their active division before the
ranking-policy layer runs.

Build the ranking-policy model:

```bash
npm run model:rankings
```

The model writes generated rankings, score breakdowns, and fight-impact files to
`data/model/`. Those files are ignored by git because they are reproducible from
the scraped UFCStats data plus manual annotations.

Audit the generated rankings for common failure modes:

```bash
npm run model:audit
```

The audit checks champion placement, title-context rules, recent head-to-head
violations, inactive top-ranked fighters, old-opponent over-credit, thin
top-15 entries, large policy adjustments, and data-quality issues such as
duplicate snapshot entries or unexplained division transfers.

Generate a readable review report after the audit:

```bash
npm run model:review
```

The review writes `data/model/audit-review.md`. It summarizes the audit,
prints each division's top 15 with score explanations, and lists the exact
fighters that need the next tuning pass.

Run the first predictive backtest:

```bash
npm run model:backtest
```

The backtest writes `data/model/backtest.json` and checks how often the
higher-rated pre-fight fighter won for fights since January 1, 2024.

## Project Status

This is an early frontend and modeling prototype. The frontend still uses
hardcoded ranking data, while the v0.8 context and round-dominance ranking model
is a separate generated pipeline under `scripts/build-rankings-model.mjs`. The
methodology content in the app is not final and is marked as placeholder where
appropriate.
