# OctagonRank

OctagonRank is an explainable UFC ranking engine and static React dashboard. It was built as a CS/data project around one question:

> Can a fighter ranking system be more transparent than a black-box ranking table while still accounting for opponent quality, recent form, dominance, activity, title context, and division movement?

The project has two parts:

- A reproducible Node.js model pipeline that ingests UFCStats data, applies a context-aware Elo-style ranking model, audits the output, backtests pre-fight predictions, and exports static JSON.
- A Vite/React frontend that renders UFC-style rankings, fighter explanations, source comparisons, a matchup predictor, methodology notes, and model evaluation results.

The frontend is intentionally static. The app reads `public/model/*.json`, so it can be hosted on GitHub Pages without a database or backend server.

## Current Snapshot

- Model version: `v0.8.7-division-carryover`
- Rankings as of: `2026-06-30`
- Source: `ufcstats.com` scrape plus source-controlled manual context files
- Processed fights: `8,272`
- Skipped no-result/unsupported fights: `149`
- Ranked fighters exported to the app: `176`
- Divisions exported: `11`
- Backtest sample: `1,268` fights since `2024-01-01`
- Context model accuracy: `60.25%`
- Raw Elo-only baseline accuracy: `58.44%`
- Hard audit failures: `0`
- Ranking assertion failures: `0`

## What The Model Scores

OctagonRank starts with a division-specific Elo rating and then exposes every major adjustment used to create the final ranking score.

### Fight-Level Rating Update

Every fight is processed chronologically inside its weight class.

```text
raw_expected = 1 / (1 + 10 ^ ((opponent_rating - fighter_rating) / 400))
base_delta   = K * (actual_result - context_adjusted_expected)
rating_delta = base_delta
             * method_multiplier
             * fight_dominance_multiplier
             * round_dominance_multiplier
             * result_confidence_multiplier
             * opponent_quality_multiplier
```

Current default `K` is `32`.

The model gives larger rating movement for:

- Beating a higher-rated opponent
- Finishing a fight cleanly
- Winning with strong significant-strike, knockdown, takedown, submission, or control-time separation
- Winning clear round profiles instead of narrow/low-repeatability outcomes
- Beating opponents with title-lineage or elite-resume context

The model dampens rating movement for:

- Split or majority decisions
- Disqualifications, doctor stoppages, injury finishes, and other noisy outcomes
- Older declining opponents
- Inactive opponents
- Opponents on negative recent form
- Comeback finishes where the winner was losing the round profile before the finish

### Pre-Fight Context

The backtest does not use only raw Elo. Before calculating expected win probability, the model applies transparent pre-fight context:

- Fighter age
- Recent wins/losses
- Recent rating trend
- Recent activity
- Losing streaks
- Title-lineage tags
- Career elite-resume score
- Division-transfer carryover

This is why fight-impact rows include both:

- `raw_expected_winner`
- `expected_winner`

The second value is the context-aware probability used by the backtest and evaluation dashboard.

### Post-Fight Ranking Score

After chronological fight processing, each ranked fighter gets a final ranking score:

```text
model_score = base_rating
            + recent_form_adjustment
            + recent_outcome_adjustment
            + schedule_strength_adjustment
            + recent_activity_adjustment
            + dominance_adjustment
            + round_dominance_adjustment
            + finish_adjustment
            + title_win_adjustment
            + elite_resume_adjustment
            + quality_win_adjustment
            - inactivity_penalty
            - legacy_penalty
```

The ranking policy layer then adds visible, auditable adjustments:

- Champion guard
- Current snapshot prior
- Confidence-based rank guard
- Recent head-to-head resolver
- Title-context protection
- Top-contender credibility gate
- Snapshot-order tiebreaker for close scores
- Division-movement policy

The frontend shows these as explainable ranking reasons instead of hiding them inside one opaque number.

## Important Model Features

### Opponent Quality

Opponent strength is built into Elo, but OctagonRank also adjusts opponent quality at fight time. A win over a prime, active, title-context opponent is worth more than a win over an older, inactive, declining opponent with the same nominal rating.

This helps avoid over-crediting famous names when the actual win happened late in the opponent's career.

### Schedule Strength

The model checks whether recent form is backed by strong opponent quality. A streak over weaker opposition can still help, especially if the wins are dominant, but it is capped so a fighter is not boosted like they beat multiple elite contenders.

If a fighter builds a streak over weaker opponents and then loses badly in the first elite test, the model can mark that profile as an `elite_exposure_loss`.

### Elite Resume

OctagonRank calculates a career-level elite-resume score from:

- Peak rating
- Elite wins
- Proven wins
- Championship-level wins
- Title-lineage wins
- Time spent around elite opposition
- Non-elite losses
- Recent decline

This lets the model value long-term elite fighters without hand-adding one-off exceptions.

### Round-Level Dominance

The model uses UFCStats round rows when available. It calculates per-round dominance from:

- Significant strike differential
- Knockdowns
- Takedowns
- Submission attempts
- Control time

This gives the model a way to distinguish a dominant win, a close decision, and a comeback finish after losing the round profile.

### Division Transfer Carryover

Division movement is handled through `data/ranking_inputs/division_context.json`.

When a fighter moves divisions, the first fight in the new division no longer starts from a blank `1500` rating. The model carries over the source-division rating with a transparent transfer penalty.

Current source-controlled division moves include:

- Islam Makhachev: `Lightweight -> Welterweight`
- Alex Pereira: `Light Heavyweight -> Heavyweight`
- Paulo Costa: `Middleweight -> Light Heavyweight`

This fixed a real modeling issue where Islam was previously treated like a fresh welterweight before the Jack Della Maddalena fight. After the fix, the historical fight row records:

- `winner_division_carryover_reason = division_carryover:Lightweight->Welterweight`
- Islam expected win probability vs JDM: about `60.6%`
- Current simulator probability for Islam vs JDM: about `68.3%`

### Manual Context, But Controlled

The model does use manual files, but they are intentionally small and source-controlled:

- `data/manual_annotations/ufc_fight_manual_annotations.csv`
- `data/ranking_inputs/current_division_snapshot.json`
- `data/ranking_inputs/title_context.json`
- `data/ranking_inputs/division_context.json`
- `data/ranking_inputs/model_assertions.json`

These files handle information UFCStats does not represent cleanly:

- Controversial decisions
- Injury finishes
- Short-notice fights
- Weight misses
- Major layoffs
- Recent champions
- Recent title losers
- Interim champions
- Division moves
- Regression-test ranking relationships

Manual context is not meant to override the model everywhere. It is meant to encode high-confidence context that would otherwise be invisible to public fight-stat data.

## Evaluation

The project includes a first predictive backtest and model-evaluation dashboard.

Current evaluation sample:

- Start date: `2024-01-01`
- Fights tested: `1,268`
- OctagonRank context model accuracy: `60.25%`
- Raw Elo-only baseline accuracy: `58.44%`
- Coin-flip baseline accuracy: `50.00%`
- Brier score: `0.2411`
- Log loss: `0.6752`
- Calibration error: `0.0493`
- Underdog win rate: `39.75%`

The evaluation output also includes:

- Favorite-confidence buckets
- Division-level slices
- Method buckets
- Biggest model misses
- Largest rating upsets
- Title-context validation
- Score-band risk summary
- Audit summary
- Diagnostics summary

The goal is not to claim the model is a sportsbook. The goal is to make ranking logic measurable and debuggable.

## Frontend

The React app includes:

- UFC-style rankings board
- Toggle between OctagonRank, UFC Meta rankings, and media rankings
- Animated fighter profile view
- Fan-readable ranking explanations
- Methodology page
- Evaluation dashboard
- Matchup predictor with win probability and likely victory paths
- Static JSON loading from `public/model/`

The matchup predictor uses the latest exported ranking score for win probability. For victory-path probabilities, it uses career-level style totals when a fighter has moved divisions, so a fighter is not treated as stylistically brand new after one fight in a new weight class.

## Data Flow

```text
data/ufcstats/*.json
        +
data/manual_annotations/*.csv
        +
data/ranking_inputs/*.json
        |
        v
scripts/build-rankings-model.mjs
        |
        v
data/model/rankings.json
data/model/fight_impacts.json
data/model/fighter_scores.csv
        |
        v
audit / diagnostics / score bands / backtest / assertions
        |
        v
scripts/export-model-public.mjs
        |
        v
public/model/rankings.json
public/model/explanations.json
public/model/summary.json
public/model/evaluation.json
        |
        v
React static frontend
```

## Repository Layout

```text
src/
  App.jsx                  React app, rankings views, profiles, simulator, evaluation UI
  styles.css               Dark-mode dashboard styling

scripts/
  scrape-ufcstats.mjs      UFCStats scraper
  build-rankings-model.mjs Core ranking model
  backtest-model.mjs       Predictive validation
  audit-rankings.mjs       Ranking failure-mode audit
  diagnose-model.mjs       Sensitivity and bias diagnostics
  score-bands.mjs          Close-score confidence bands
  explain-rankings.mjs     Fighter-level explanations
  export-model-public.mjs  Static frontend JSON export
  run-model-pipeline.mjs   Full model-to-frontend pipeline

data/
  manual_annotations/      Small source-backed context CSV
  ranking_inputs/          Snapshot, title, division, and assertion inputs
  ufcstats/                Local scraped data, ignored by git

public/model/
  rankings.json            Static rankings consumed by React
  explanations.json        Static explanation payload
  summary.json             Model metadata and methodology
  evaluation.json          Backtest/evaluation dashboard payload

docs/
  model-v0.7.md
  model-v0.8.md
```

## Running Locally

Install dependencies:

```bash
npm install
```

Run the static frontend:

```bash
npm run dev
```

Build the frontend:

```bash
npm run build
```

Regenerate the complete model and frontend JSON export:

```bash
npm run model:export
```

This runs the full pipeline:

1. Build rankings
2. Generate fighter explanations
3. Audit rankings
4. Run diagnostics
5. Build score bands
6. Write audit review
7. Backtest pre-fight ratings
8. Check ranking assertions
9. Export compact frontend JSON

Useful variants:

```bash
npm run model:export -- --build-site
npm run model:export -- --as-of=2025-12-31
npm run model:export -- --skip-backtest
```

Scrape UFCStats data:

```bash
npm run scrape:ufcstats
```

The scraper writes local data to `data/ufcstats/`. That directory is ignored by git because a full scrape is large and reproducible.

## Model Commands

```bash
npm run model:rankings     # Build rankings and fight-impact files
npm run model:explain      # Generate fighter explanation JSON/Markdown
npm run model:audit        # Check ranking failure modes
npm run model:review       # Write readable audit review
npm run model:backtest     # Validate pre-fight probabilities
npm run model:diagnostics  # Run sensitivity and group diagnostics
npm run model:bands        # Generate close-score bands
npm run model:assertions   # Run regression ranking assertions
npm run model:tune         # Test predefined model-weight candidates
npm run model:compare      # Compare two model runs
npm run model:history      # Generate historical ranking movement snapshots
npm run model:publish      # Export public/model/*.json from existing data/model
```

## Static Hosting

The deployed app does not need a database. The GitHub Pages deployment is configured for:

```text
https://abdulm5.github.io/OctagonRank/
```

The Vite base path is set in `vite.config.js`:

```js
base: "/OctagonRank/"
```

That lets static assets and model JSON load correctly from the repository subpath.

The model pipeline generates:

- `public/model/rankings.json`
- `public/model/explanations.json`
- `public/model/summary.json`
- `public/model/evaluation.json`

The React app fetches those files at runtime. Updating rankings means:

```bash
npm run model:export
npm run build
```

Then commit the updated `public/model/*.json` files and push to `main`. The GitHub Actions workflow in `.github/workflows/deploy.yml` runs `npm ci`, builds the Vite app, uploads `dist/`, and deploys it through GitHub Pages.

In the GitHub repository settings, Pages should be set to deploy from `GitHub Actions`.

## Current Limitations

- The model is only as current as the local UFCStats scrape and manual snapshot files.
- Current UFC, Meta, and media comparison rankings are manually maintained inputs, not live API pulls.
- Sportsbook odds are not integrated yet. The next evaluation upgrade is a `market_odds.csv` baseline that compares OctagonRank probabilities against closing lines.
- Manual title and division context are intentionally small, but still require review when fighters change divisions or title status.
- The matchup predictor is a ranking-based probability tool, not a full fight simulation engine.
- Fighter photos are not fully automated.
- The project does not currently generate pound-for-pound rankings.

## Why This Is A CS Project

OctagonRank combines:

- Web scraping and data normalization
- Chronological model state updates
- Elo-style rating algorithms
- Feature engineering from fight statistics
- Manual context design with controlled inputs
- Backtesting and calibration metrics
- Sensitivity diagnostics
- Static artifact generation
- React data visualization
- Explainable UI design

The core idea is not just "make UFC rankings." The project builds a reproducible ranking engine where every major ranking movement can be inspected, tested, and challenged.
