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

Build the context-calibrated rankings model:

```bash
npm run model:rankings
```

The model writes generated rankings, score breakdowns, and fight-impact files to
`data/model/`. Those files are ignored by git because they are reproducible from
the scraped UFCStats data plus manual annotations.

## Project Status

This is an early frontend and modeling prototype. The frontend still uses
hardcoded ranking data, while the context-calibrated model is a separate
generated pipeline under `scripts/build-rankings-model.mjs`. The methodology
content in the app is not final and is marked as placeholder where appropriate.
