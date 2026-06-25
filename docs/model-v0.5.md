# Model v0.5: Context-Calibrated Explainable Rankings

This model pass keeps the composite OctagonRank score, but adds a visible
calibration guard for current elite contenders. The goal is to avoid obviously
weird outputs like a current #1 contender dropping to the middle of the top 10
because the fight-stat model overreacted to one recent result.

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
5. After all fights are processed, the model builds a composite score from:
   - base Elo rating
   - recent form
   - recent activity
   - average dominance
   - finish rate
   - best-win quality
   - inactivity penalty
   - legacy penalty
6. Fighters who moved divisions can carry their best historical rating into the
   new division with a transfer penalty.
7. The current snapshot limits each division to the active ranked pool and adds
   a status prior.
8. Current elite contenders get a bounded rank-drift guard.
9. The current champion is kept above contenders in that division. The required
   title adjustment is exposed instead of hidden.

## Formula

```txt
base_elo_change = k_factor * (1 - expected_winner)

fight_rating_change =
  base_elo_change
  * method_multiplier
  * dominance_multiplier
  * result_confidence

model_score =
  base_rating
  + recent_form_adjustment
  + recent_activity_adjustment
  + dominance_adjustment
  + finish_adjustment
  + quality_win_adjustment
  - inactivity_penalty
  - legacy_penalty

final_score =
  model_score
  + current_context_prior
  + rank_guard_adjustment
  + title_guard_adjustment
```

## What Each Part Means

`base_rating`
: The division-specific Elo rating after processing all historical fights.

`recent_form_adjustment`
: Adds value for recent wins and positive recent Elo movement. Losses and
negative recent trend subtract value.

`recent_activity_adjustment`
: Gives a small bump for activity in the last 30 months.

`dominance_adjustment`
: Converts average dominance into a bounded score adjustment. Dominance is based
on significant strikes, knockdowns, takedowns, submission attempts, and control
time.

`finish_adjustment`
: Adds a small bonus for high finish rates and a small penalty for low finish
rates.

`quality_win_adjustment`
: Adds value for the fighter's best win based on the opponent's pre-fight Elo.
Older best wins are decayed.

`inactivity_penalty`
: Starts after 12 months without a fight. This lowers ranking confidence without
deleting the fighter's rating.

`legacy_penalty`
: Applies mainly to high-rated fighters whose best win is old, who have very
little activity in the last 30 months, or whose recent form is negative.

`current_context_prior`
: A prior from the current snapshot. This acknowledges present champion and
contender status, but does not directly copy contender order.

`rank_guard_adjustment`
: A visible correction for current elite contenders. Current #1 contenders
cannot fall below rank 3, current #2-#3 contenders cannot fall below rank 5, and
current #4-#5 contenders cannot fall below rank 6.

`title_guard_adjustment`
: If the current champion's score would fall below a contender, the champion is
raised just enough to remain first. This keeps divisional rankings consistent
with title status while making the size of the adjustment visible.

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
- Current champions are guarded through the current snapshot, not through fight
  data alone.
- The rank-drift guard is hand-tuned and should eventually be validated against
  historical rank movement.
- Style matchups are not modeled yet.
- Round-by-round scoring is not used yet.
- The frontend is not wired to this generated model output yet.
