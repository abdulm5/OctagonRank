# Model v0.6: Ranking Policy Layer

This model pass separates the statistical score from ranking policy. The base
model still produces an explainable composite score, then a visible policy layer
handles MMA-specific ranking behavior such as title lineage and recent
head-to-head wins.

## Goal

Given historical UFCStats fights, produce a ranked list per active UFC division
with a score breakdown for each fighter.

## Current Inputs

- `data/ufcstats/fights.json`
- `data/ufcstats/fight_fighter_stats.json`
- `data/manual_annotations/ufc_fight_manual_annotations.csv`
- `data/ranking_inputs/current_division_snapshot.json`
- `data/ranking_inputs/title_context.json`

The model uses UFCStats as the automated source, manual annotations as an
edge-case overlay, the current division snapshot as active roster context, and
title context as a small hand-curated policy input.

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
8. Ranking policy is applied:
   - the champion is kept first,
   - title-context entries can protect recent title losers or former champions,
   - elite contenders get a bounded rank-drift guard,
   - recent head-to-head wins can resolve close ordering conflicts.

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
  + title_context_adjustment
  + rank_guard_adjustment
  + head_to_head_adjustment
  + title_guard_adjustment
```

## What Each Part Means

`base_rating`
: The division-specific Elo rating after processing all historical fights.

`recent_form_adjustment`
: Adds value for recent wins and positive recent Elo movement. Losses and
negative recent trend subtract value.

`dominance_adjustment`
: Converts average dominance into a bounded score adjustment. Dominance is based
on significant strikes, knockdowns, takedowns, submission attempts, and control
time.

`quality_win_adjustment`
: Adds value for the fighter's best win based on the opponent's pre-fight Elo.
Older best wins are decayed.

`current_context_prior`
: A prior from the current snapshot. This acknowledges present champion and
contender status, but does not directly copy contender order.

`title_context_adjustment`
: A visible correction from `title_context.json`. For example, a recent title
loser can be protected as the #1 contender unless they lose again, become
inactive, or the protection window expires.

`rank_guard_adjustment`
: A visible correction for current elite contenders. Current #1 contenders
cannot fall too far, current #2-#3 contenders get moderate protection, and
current #4-#5 contenders get lighter protection.

`head_to_head_adjustment`
: A visible correction when a fighter recently beat another ranked fighter in
the same division and the score gap is close enough to resolve directly.

`title_guard_adjustment`
: If the current champion's score would fall below a contender, the champion is
raised just enough to remain first.

## Current Policy Rules

- Recent title loser: default max overall rank `2`, which means #1 contender
  when the champion is included in the list.
- Recent champion: default max overall rank `4`.
- Interim champion: default max overall rank `4`.
- Former champion: default max overall rank `6`.
- Head-to-head resolver: uses the latest fight between two ranked candidates in
  the same division if it happened within `24` months and the score gap is
  within `45` points.

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
- Title context is manual and should eventually be source-backed per entry.
- The rank-drift guard is hand-tuned and should eventually be validated against
  historical rank movement.
- Style matchups are not modeled yet.
- Round-by-round scoring is not used yet.
- The frontend is not wired to this generated model output yet.
