# Model v0.8: Division Context, Round Dominance, and Backtesting

This model pass keeps the v0.7 Elo/opponent-context backbone and adds several
implemented upgrades:

- source-backed current-division movement through `division_context.json`,
- confidence-based rank guard rules,
- round-level dominance scoring from UFCStats round rows,
- no-contest activity handling,
- latest-result adjustment for recent losses,
- schedule-strength adjustment for inflated win streaks,
- a first predictive backtest using pre-fight model ratings.

## Current Inputs

- `data/ufcstats/fights.json`
- `data/ufcstats/fight_fighter_stats.json`
- `data/ufcstats/fight_round_stats.json`
- `data/ufcstats/fighters.json`
- `data/manual_annotations/ufc_fight_manual_annotations.csv`
- `data/ranking_inputs/current_division_snapshot.json`
- `data/ranking_inputs/title_context.json`
- `data/ranking_inputs/division_context.json`

## Added Logic

`division_context`
: Applies source-backed division moves before rankings are built. For example,
Alex Pereira is removed from light heavyweight and ranked at heavyweight after
the Ciryl Gane fight. Because he was a dominant recent light heavyweight
champion, his resume transfers with a smaller elite-champion penalty, and his
heavyweight loss is still applied as a visible current-division overlay.

`round_dominance_adjustment`
: Uses per-round significant strikes, knockdowns, takedowns, submissions, and
control time to add a separate dominance signal. This also dampens comeback
finishes when the winner was losing the round profile.

`no_decision_activity`
: Draws and no-contests update activity, stat totals, and dominance samples
without changing Elo ratings. This prevents inactive-looking champions when a
recent title fight ended without a winner.

`rank_guard_confidence`
: Replaces fixed rank-guard rules with confidence-based protection. Activity,
recent rating trend, sample size, quality wins, title-lineage wins, and round
dominance increase confidence. Inactivity, legacy decay, and entry-gate flags
reduce it.

`quality_win_adjustment`
: Best-win credit is dampened when the opponent was older and entering with
declining form. The win still counts, but it no longer maxes out best-win value
just because the opponent has a famous name.

`recent_outcome_adjustment`
: Adds a small recency check for the latest result. Recent finish losses get a
larger penalty than recent decision losses, which helps keep fighters from
staying too high immediately after a damaging loss.

`schedule_strength_adjustment`
: Measures the opponent quality behind the last-five resume. Recent streaks
against weaker opposition can be capped, while wins over proven or
title-lineage opponents receive a small bonus. A damaging loss in the first
elite test after a weaker streak is marked as `elite_exposure_loss`.

`rank_policy: false`
: Lets title-context entries provide opponent-quality credit without forcing
rank protection. This is useful for older former champions.

## Commands

```bash
npm run model:rankings
npm run model:audit
npm run model:review
npm run model:backtest
```

Current generated outputs:

- `data/model/rankings.json`
- `data/model/fight_impacts.json`
- `data/model/audit.json`
- `data/model/audit-review.md`
- `data/model/backtest.json`

## Current Audit Snapshot

After the v0.8 changes:

- champion failures: `0`
- title-context failures: `0`
- data-quality flags: `0`
- remaining head-to-head violations: `0`
- inactive top-ranked flags: `0`
- low-sample overboost flags: `0`
- old-opponent over-credit flags: `0`

The remaining nonzero audit bucket is large policy adjustments. That is a
review bucket, not a correctness failure; it shows where ranking policy is doing
substantial work beyond the pure model score.

## Current Backtest Snapshot

The first backtest checks fights since `2024-01-01` and asks whether the
higher-rated pre-fight fighter won.

- fights tested: `1255`
- correct favorite wins: `732`
- accuracy: `58.3%`
- underdog wins: `523`

This is not a final predictive model yet, but it gives the project a real
validation metric to improve against.
