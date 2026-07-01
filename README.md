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

Scrape UFCStats completed fights from January 1, 2000 through June 30, 2026:

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

Generate a readable review report after the audit, diagnostics, and score-band
checks:

```bash
npm run model:review
```

The review writes `data/model/audit-review.md`. It summarizes the audit,
prints each division's top 15 with score explanations, and lists the exact
fighters, diagnostic bias groups, fragile rankings, sensitive score components,
and close-score clusters that need the next tuning pass.

Generate fighter-level ranking explanations:

```bash
npm run model:explain
```

The explanation report writes `data/model/explanations.json` and
`data/model/explanations.md`, plus per-fighter Markdown pages under
`data/model/fighter_explanations/`. It breaks each fighter into model score,
policy movement, confidence band, top positive drivers, top penalties, best
win, recent form, and automatic review flags for rankings that need manual
inspection.

The current model also uses those review patterns for a top-contender
credibility gate, which visibly penalizes top-five or near-top-five placements
when recent form is not backed by elite resume, title-lineage wins, current
snapshot support, or strong recent opponent quality.

Close-score cases also use a visible snapshot-order tiebreaker so an active
higher-snapshot contender with recent form or elite decision-loss context is
not pushed below lower-snapshot fighters unless the model score gap is large
enough to justify it.

Run the first predictive backtest:

```bash
npm run model:backtest
```

The backtest writes `data/model/backtest.json` and `data/model/backtest.md`.
It checks how often the higher-rated pre-fight fighter won for fights since
January 1, 2024, then breaks validation down by division, year, and rating-gap
bucket.

Generate historical ranking movement:

```bash
npm run model:history
```

The history report rebuilds historical snapshots with `--as-of` dates and
current snapshot policy disabled by default, so future current rankings are not
leaked into past snapshots. It writes `data/model/ranking_history.json` and
`data/model/ranking_history.md` with top-five snapshots, rank movement, biggest
risers, and biggest fallers.

Run model diagnostics:

```bash
npm run model:diagnostics
```

Diagnostics write `data/model/diagnostics.json` and
`data/model/diagnostics.md`. They check for fragile rankings, sensitivity to
score components, and group-level pressure on categories like low-sample
fighters, inactive fighters, dominant-win fighters, and schedule-penalized
fighters.

Generate close-score bands:

```bash
npm run model:bands
```

The band report writes `data/model/score-bands.json` and
`data/model/score-bands.md`. It marks adjacent rankings as virtual ties, close
pairs, or clear separations, then groups tightly packed fighters so tuning does
not overreact to rankings that are effectively tied.

Tune model weights against validation metrics:

```bash
npm run model:tune
```

The tuner rebuilds rankings for predefined candidate configurations, then runs
audit, backtest, diagnostics, and ranking assertions for each one. It writes
`data/model/tuning_report.json` and `data/model/tuning_report.md`; generated
tuning runs stay under `data/model/tuning_runs/` and are ignored by git.

Check ranking regression assertions:

```bash
npm run model:assertions
```

Assertions live in `data/ranking_inputs/model_assertions.json`. They guard
high-signal relationships such as Paulo Costa staying above lower-snapshot LHW
contenders, Islam remaining welterweight #1, and head-to-head relationships
that should not regress during tuning. The assertion script can also write JSON
with `--out=PATH`, which the tuner uses as a constraint score.

## Project Status

This is an early frontend and modeling prototype. The frontend still uses
hardcoded ranking data, while the v0.8 context and round-dominance ranking model
is a separate generated pipeline under `scripts/build-rankings-model.mjs`. The
latest modeling pass adds configurable weight files and automated tuning, but
the app has not yet been wired to consume generated model output directly. The
methodology content in the app is not final and is marked as placeholder where
appropriate.
