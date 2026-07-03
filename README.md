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
- Fan-facing fighter explanations generated from the OctagonRank model export
- Detailed stat panel for Benoit Saint Denis, including striking accuracy, takedown accuracy, strike targets, strike positions, and win method breakdown
- Methodology page with draft model explanations
- Matchup predictor that lets users choose two fighters and see win odds plus likely victory paths

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
Entries can also cap their rank-policy adjustment, which keeps narrow
title-lineage protections from turning into broad manual boosts.

Current-division movement context lives in
`data/ranking_inputs/division_context.json`. This source-backed file removes
fighters from old divisions and places them in their active division before the
ranking-policy layer runs.

Run the full model-to-frontend pipeline:

```bash
npm run model:export
```

That one command validates the local UFCStats input files, rebuilds
`data/model/rankings.json`, generates fighter explanations, runs the audit,
diagnostics, score-band report, backtest, and ranking assertions, then exports
the compact static JSON files used by the React app under `public/model/`.

Useful variants:

```bash
npm run model:export -- --build-site
npm run model:export -- --as-of=2025-12-31
npm run model:export -- --skip-backtest
```

Use the lower-level commands below when debugging one stage of the pipeline.

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
top-15 entries, large rescue policy adjustments, baseline context priors, and
data-quality issues such as duplicate snapshot entries or unexplained division
transfers.

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

Export only the compact model artifacts for the static frontend:

```bash
npm run model:publish
```

This lower-level export assumes `data/model/` already exists. It writes
`public/model/rankings.json`, `public/model/explanations.json`, and
`public/model/summary.json`. The React app loads those files directly, so it can
run on GitHub Pages without a database or backend server.

After adding new UFCStats fight files, rebuild the model and static site data in
one pass:

```bash
npm run model:export
```

`npm run model:refresh` is kept as an alias for the same pipeline.

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
January 1, 2024, then reports accuracy, Brier score, log loss, calibration
error, favorite-confidence buckets, division slices, year slices, method
validation, and ranked/title-context proxy performance.

Pre-fight win probability is context-aware: the model records both the raw Elo
expectation and the context-adjusted expectation after age, recent form,
activity, title-lineage, and elite-resume context are applied. Fight-impact rows
include the contextual rating gap and the adjustment reasons so the prediction
can be explained later in the frontend.

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

Compare a baseline model against a tuning candidate:

```bash
npm run model:compare
```

The comparison report defaults to `baseline` versus `less_schedule_strength`. It
rebuilds both runs, then writes `data/model/model_comparison.json` and
`data/model/model_comparison.md` with validation deltas, assertion regressions,
risk flags, biggest rank movers, new ranked fighters, removed ranked fighters,
and division-level movement summaries. Use this before promoting a tuned
candidate to the default formula.

To compare the current context-aware engine against the older raw pre-fight Elo
expectation, run:

```bash
npm run model:compare -- --baseline=no_pre_fight_context --candidate=baseline --no-keep-runs
```

Simulate a hypothetical fight result:

```bash
npm run model:simulate -- --division=Lightweight --winner="Arman Tsarukyan" --loser="Justin Gaethje" --method=Submission --round=3 --performance=clear --title-fight
```

The simulator reads `data/model/rankings.json`, applies a transparent
single-fight projection, then writes `data/model/simulation.json` and
`data/model/simulation.md`. It reports raw and context-adjusted win
probability, method/performance multipliers, model-score movement, projected
rank changes, close-score confidence, and champion-transfer policy when a
champion loses. This is a snapshot projection, not a historical rebuild.

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
