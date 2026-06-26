# Model v0.7: Opponent Context and Ranking Audits

This model pass adds opponent age/form context and a repeatable audit report.
The goal is to avoid over-crediting wins over older declining names, enforce
recent head-to-head results more aggressively, and flag suspicious rankings
instead of relying only on manual eyeballing.

## Goal

Given historical UFCStats fights, produce a ranked list per active UFC division
with a score breakdown for each fighter.

## Current Inputs

- `data/ufcstats/fights.json`
- `data/ufcstats/fight_fighter_stats.json`
- `data/ufcstats/fighters.json`
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
   - opponent age/form context at fight time
   - manual context annotations
   - low-repeatability finish checks
5. After all fights are processed, the model builds a composite score from:
   - base Elo rating
   - recent form
   - recent activity
   - average dominance
   - finish rate
   - best-win quality using age/form-adjusted opponent rating
   - inactivity penalty
   - legacy penalty
6. Fighters who moved divisions can carry their best historical rating into the
   new division with a transfer penalty.
7. The current snapshot limits each division to the active ranked pool and adds
   a status prior.
8. Ranking policy is applied:
   - the champion is kept first,
   - title-context entries can protect recent title losers or former champions,
   - thin ranked entries can receive an evidence penalty,
   - elite contenders get a bounded rank-drift guard,
   - recent head-to-head wins can resolve ordering conflicts.

## Formula

```txt
base_elo_change = k_factor * (1 - expected_winner)

fight_rating_change =
  base_elo_change
  * method_multiplier
  * dominance_multiplier
  * opponent_quality_multiplier
  * result_confidence

model_score =
  base_rating
  + recent_form_adjustment
  + recent_activity_adjustment
  + dominance_adjustment
  + finish_adjustment
  + title_win_adjustment
  + quality_win_adjustment
  - inactivity_penalty
  - legacy_penalty

final_score =
  model_score
  + current_context_prior
  - entry_gate_penalty
  + title_context_adjustment
  + rank_guard_adjustment
  + head_to_head_adjustment
  + title_guard_adjustment
```

## What Each Part Means

`opponent_quality_multiplier`
: Adjusts fight rating movement based on the opponent's age, recent record,
recent rating trend, activity, and losing streak entering the fight. Older
fighters are only discounted hard when age is paired with decline signals.
Fresh title context, such as recently holding a belt, can add opponent-quality
credit.

`quality_win_adjustment`
: Adds value for the fighter's best win using the opponent's age/form-adjusted
rating. Older best wins are also decayed by time.

`entry_gate_penalty`
: A visible penalty for thin top-15 entries that lack ranked wins or multiple
quality wins.

`title_win_adjustment`
: A visible bonus for recent wins over fighters with active title-lineage
context, such as recent champions or recent title losers.

`head_to_head_adjustment`
: A visible correction when a fighter recently beat another ranked fighter in
the same division. Fights inside one year use a stricter rule unless the winner
has a damaging loss afterward.

`title_context_adjustment`
: A visible correction from `title_context.json`. For example, a recent title
loser can be protected as the #1 contender unless they lose again, become
inactive, or the protection window expires.

## Current Policy Rules

- Recent title loser: default max overall rank `2`, which means #1 contender
  when the champion is included in the list.
- Recent champion: default max overall rank `4`.
- Interim champion: default max overall rank `4`.
- Former champion: default max overall rank `6`.
- Strict head-to-head resolver: latest same-division fight inside `12` months,
  score gap up to `120`, unless the winner had a damaging loss afterward.
- Soft head-to-head resolver: latest same-division fight inside `24` months,
  score gap up to `45`.
- Elite head-to-head resolver: latest same-division fight inside `36` months for
  two current top-eight fighters, score gap up to `80`, unless the winner had a
  damaging loss afterward.
- Ranked-entry gate: low-sample top-15 entries need a ranked win, multiple
  quality wins, or enough adjusted best-win quality to avoid a penalty.

## Audit Report

Run:

```bash
npm run model:audit
```

The audit writes `data/model/audit.json` and checks:

- champion at rank 1,
- title-context entries meeting their target rank,
- recent head-to-head violations,
- inactive top-10 fighters,
- low-sample prospect overboosts,
- old declining opponent over-credit,
- large policy adjustments.

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
- The rank-drift and entry-gate thresholds are hand-tuned and should eventually
  be validated against historical rank movement.
- Style matchups are not modeled yet.
- Round-by-round scoring is not used yet.
- The frontend is not wired to this generated model output yet.
