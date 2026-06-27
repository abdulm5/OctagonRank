# Model v0.8: Division Context, Round Dominance, and Backtesting

This model pass keeps the v0.7 Elo/opponent-context backbone and adds four
implemented upgrades:

- source-backed current-division movement through `division_context.json`,
- confidence-based rank guard rules,
- round-level dominance scoring from UFCStats round rows,
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
the Ciryl Gane fight. His light heavyweight resume transfers with a penalty, and
his heavyweight loss is applied as a visible current-division overlay.

`round_dominance_adjustment`
: Uses per-round significant strikes, knockdowns, takedowns, submissions, and
control time to add a separate dominance signal. This also dampens comeback
finishes when the winner was losing the round profile.

`rank_guard_confidence`
: Replaces fixed rank-guard rules with confidence-based protection. Activity,
recent rating trend, sample size, quality wins, title-lineage wins, and round
dominance increase confidence. Inactivity, legacy decay, and entry-gate flags
reduce it.

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
- remaining head-to-head violations: `3`
- low-sample overboost flags: `10`

The next tuning pass should focus on the remaining head-to-head flags and the
entry-gate rule for low-sample fighters.

## Current Backtest Snapshot

The first backtest checks fights since `2024-01-01` and asks whether the
higher-rated pre-fight fighter won.

- fights tested: `1255`
- correct favorite wins: `732`
- accuracy: `58.3%`
- underdog wins: `523`

This is not a final predictive model yet, but it gives the project a real
validation metric to improve against.
