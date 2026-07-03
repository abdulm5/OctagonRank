# Model v0.8: Division Context, Elite Resume, and Backtesting

This model pass keeps the v0.7 Elo/opponent-context backbone and adds several
implemented upgrades:

- source-backed current-division movement through `division_context.json`,
- confidence-based rank guard rules,
- round-level dominance scoring from UFCStats round rows,
- no-contest activity handling,
- latest-result adjustment for recent losses,
- schedule-strength adjustment for inflated win streaks,
- automatic elite-resume scoring for long-term elite fighters,
- fighter-level explanation reports with review flags,
- top-contender credibility penalties for unsupported top-five pushes,
- close-score snapshot-order tiebreaking for active contenders,
- configurable model weights for validation runs,
- an automated tuning pass across predefined model candidates,
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
- `data/ranking_inputs/model_assertions.json`

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
title-lineage opponents receive a small bonus. Dominant wins over weaker
opposition can cushion the penalty, but close/noisy wins cannot. A damaging
loss in the first elite test after a weaker streak is marked as
`elite_exposure_loss`.

`elite_resume_adjustment`
: Calculates career-level elite value from peak rating, elite wins,
championship-level wins, title-lineage wins, and years spent around elite
opposition. The adjustment is dampened by recent losses, negative rating trend,
inactivity, and non-elite losses. This lets the model value wins over fighters
like Dustin Poirier or Max Holloway without hand-adding one-off exceptions.

`rank_policy: false`
: Lets title-context entries provide opponent-quality credit without forcing
rank protection. This is useful for older former champions.

`model_config`
: Allows a tuning run to scale individual score components without rewriting
the model. The default configuration keeps every weight at `1`, so normal
rankings match the hand-tuned baseline unless `--model-config` is provided.

`model_tuning`
: Runs predefined candidate configs, rebuilds rankings for each one, audits the
result, backtests it, and runs diagnostics. Candidates are scored by rewarding
backtest accuracy while heavily penalizing champion/title/head-to-head/data
quality failures and lightly penalizing fragile or high-policy rankings. The
tuning report is a decision aid; it does not automatically replace the default
model.

`model_explanations`
: Generates fighter-level explanation JSON and Markdown from the latest
rankings. Each fighter gets a model-only rank, final score, policy movement,
top boosts, top drags, best win, recent form, and automatic review flags. This
is meant to catch surprising cases like a top-five rank built mostly from
recent form instead of title or elite-resume support.

`top_contender_credibility`
: Applies a visible penalty to top-five and near-top-five contenders whose
recent form is not supported by current snapshot position, elite-resume value,
title-lineage wins, or strong recent win quality. This is designed to catch
cases where a fighter is riding a recent streak over weaker opposition into an
unusually high contender slot.

`snapshot_order`
: Applies a small, visible tiebreaker when an active higher-snapshot contender
with recent form or elite decision-loss context is only narrowly behind
lower-snapshot fighters. This keeps the current snapshot from being ignored in
close-score cases without forcing the entire official order.

`model_assertions`
: Runs source-controlled regression checks for important ranking relationships.
These are not the full ranking order; they are high-signal guardrails for cases
we have already reviewed, such as Paulo Costa staying above lower-snapshot LHW
contenders and direct head-to-head relationships not silently regressing.

## Commands

```bash
npm run model:rankings
npm run model:audit
npm run model:review
npm run model:backtest
npm run model:diagnostics
npm run model:tune
npm run model:explain
npm run model:assertions
```

Current generated outputs:

- `data/model/rankings.json`
- `data/model/fight_impacts.json`
- `data/model/audit.json`
- `data/model/audit-review.md`
- `data/model/backtest.json`
- `data/model/diagnostics.json`
- `data/model/diagnostics.md`
- `data/model/tuning_report.json`
- `data/model/tuning_report.md`
- `data/model/explanations.json`
- `data/model/explanations.md`

Example custom weight file:

```json
{
  "name": "less_recent_form",
  "weights": {
    "recent_form": 0.9,
    "recent_outcome": 0.9
  }
}
```

Run it directly:

```bash
node scripts/build-rankings-model.mjs --model-config=path/to/model_config.json
```

## Current Audit Snapshot

After the v0.8 changes:

- champion failures: `0`
- title-context failures: `0`
- data-quality flags: `0`
- remaining head-to-head violations: `0`
- unexplained elite snapshot drift: `0`
- justified elite snapshot drift: `4`
- inactive top-ranked flags: `0`
- low-sample overboost flags: `0`
- old-opponent over-credit flags: `0`
- large rescue policy adjustments: `9`
- large baseline context priors: `30`

The justified elite snapshot drift bucket covers fighters whose current
snapshot slot is high, but whose latest finish losses, recent losses, weak
schedule, or legacy decay explain why the model moved them down. The large
rescue policy bucket is a review bucket, not a correctness failure; it shows
where title context, rank guards, snapshot tiebreakers, or similar ranking
policy are doing substantial work beyond the pure model score. Large baseline
context priors are reported separately because champion/current-snapshot priors
are expected explainability signals, not tuning failures.

## Diagnostics

`model:diagnostics` generates category-level bias checks and local sensitivity
tests. It compares groups such as low-sample fighters, inactive fighters,
schedule-penalized fighters, dominant-win fighters, title-context fighters, and
style-profile proxies against the overall ranked pool. It also perturbs visible
score components by 10 percent to identify fragile rankings.

The diagnostics report is not proof that the model is unbiased. It is a review
tool for finding where formula changes or manual ranking policy may be creating
systematic pressure.

Current diagnostics summary:

- bias flags: `4`
- fragile fighters with 3+ rank movement: `0`
- max local sensitivity move: `2`
- most sensitive component: `recent form minus_10pct`

## Current Backtest Snapshot

The first backtest checks fights since `2024-01-01` and asks whether the
higher-rated pre-fight fighter won.

- fights tested: `1268`
- correct favorite wins: `763`
- accuracy: `60.2%`
- underdog wins: `506`

This is not a final predictive model yet, but it gives the project a real
validation metric to improve against.

## Current Tuning Snapshot

The latest full tuning sweep tested `21` predefined candidates.

- best candidate: `baseline` (current v0.8.6 default)
- score: `483.76`
- backtest accuracy: `60.2%`
- hard audit failures: `0`
- assertion failures: `0`
- fragile fighters: `0`

The `less_recent_form` candidate remains promoted as the default v0.8.6 model.
After splitting expected baseline priors from true rescue adjustments, the
current default ranks first in the tuning sweep with no hard audit failures,
no assertion failures, `0` fragile fighters, max local rank movement of `2`,
and `9` large rescue policy adjustments.
