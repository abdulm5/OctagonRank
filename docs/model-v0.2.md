# Model v0.2: Current-Context Explainable Rankings

This is the first model pass. It is intentionally simple enough to inspect and
criticize.

## Goal

Given historical UFCStats fights, produce a ranked list per active UFC division
with a score breakdown for each fighter.

## Current Inputs

- `data/ufcstats/fights.json`
- `data/ufcstats/fight_fighter_stats.json`
- `data/manual_annotations/ufc_fight_manual_annotations.csv`
- `data/ranking_inputs/current_division_snapshot.json`

The model uses UFCStats as the automated source, manual annotations as an
edge-case overlay, and the current division snapshot as active roster context.

## Current Score Logic

Each fight is processed chronologically.

1. Every fighter starts at `1500` in each division.
2. A normal Elo expected score is calculated from the two pre-fight ratings.
3. The winner gains points and the loser loses the same number of points.
4. The base Elo change is adjusted by:
   - method of victory
   - dominance statistics
   - manual context annotations
   - low-repeatability finish checks
5. After all fights are processed, current champions and ranked fighters are
   anchored to the division where the current snapshot says they belong.
6. Fighters who moved divisions can carry their best historical rating into the
   new division with a transfer penalty.
7. After all fights are processed, inactive fighters lose final-score
   confidence after 12 months without a fight.

## Formula

```txt
base_elo_change = k_factor * (1 - expected_winner)

rating_change =
  base_elo_change
  * method_multiplier
  * dominance_multiplier
  * result_confidence

final_score = base_rating - inactivity_penalty
```

When a fighter appears in the current snapshot, the model also applies a current
context floor:

```txt
final_score = max(raw_score, current_context_floor)
```

This keeps the model from doing obviously wrong things like leaving a current
champion in their old division or ranking the current champion behind
contenders.

## What Each Part Means

`base_rating`
: The division-specific Elo rating after processing all historical fights.

`method_multiplier`
: A clean finish gets more movement than a split decision. Weird outcomes like
DQ or could-not-continue move less.

`dominance_multiplier`
: Uses significant strikes, knockdowns, takedowns, submission attempts, and
control time to decide whether the winner dominated or barely got by.

`result_confidence`
: Damps fights with manual edge-case tags, such as injury finishes,
controversial decisions, short-notice fights, weight misses, division moves, or
major layoffs.

`inactivity_penalty`
: Starts after 12 months without a fight. This lowers ranking confidence without
deleting the fighter's rating.

`current_context_floor`
: A floor from the current division snapshot. Champions get the strongest floor,
and listed contenders get descending floors. The score can still rise above that
floor if the model resume is stronger.

## Current Eligibility Rule

A fighter is ranked if they are in the current snapshot for that division. If no
snapshot exists for a division, the fallback rule is:

- they fought in a current UFC division,
- they have at least 2 UFC fights in that division,
- their last fight in that division was within 36 months.

This rule is temporary. It keeps ancient inactive fighters from dominating the
prototype rankings.

## Known Limitations

- Ratings transfer between divisions with a simple fixed penalty, not a learned
  weight-class adjustment yet.
- Current champions are anchored through the current snapshot, not through fight
  data alone.
- Current ranked-pool order is used as a context floor, not as the whole score.
- Style matchups are not modeled yet.
- Round-by-round scoring is not used yet.
- The frontend is not wired to this generated model output yet.
