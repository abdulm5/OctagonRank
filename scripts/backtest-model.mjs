#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  fightImpactsPath: "data/model/fight_impacts.json",
  rankingsPath: "data/model/rankings.json",
  outPath: "data/model/backtest.json",
  markdownOutPath: "data/model/backtest.md",
  since: "2024-01-01",
};

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [fightImpacts, rankings] = await Promise.all([
    readJson(path.resolve(process.cwd(), args.fightImpactsPath)),
    readOptionalJson(path.resolve(process.cwd(), args.rankingsPath), null),
  ]);

  const report = buildBacktest({
    fightImpacts,
    rankings,
    since: args.since,
  });

  const outputPath = path.resolve(process.cwd(), args.outPath);
  const markdownPath = path.resolve(process.cwd(), args.markdownOutPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await Promise.all([
    fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(markdownPath, buildMarkdownReport(report)),
  ]);
  printSummary(report, args);
}

function buildBacktest({ fightImpacts, rankings, since }) {
  const eligible = fightImpacts
    .filter((impact) => impact.event_date >= since)
    .filter((impact) => Number.isFinite(num(impact.winner_pre_rating)) && Number.isFinite(num(impact.loser_pre_rating)))
    .map((impact) => {
      const rawRatingGap = round(num(impact.winner_pre_rating) - num(impact.loser_pre_rating), 2);
      const ratingGap = round(num(impact.contextual_rating_gap ?? rawRatingGap), 2);
      const expectedWinner = clamp(num(impact.expected_winner), 0.001, 0.999);
      const rawExpectedWinner = clamp(expectedScoreFromGap(rawRatingGap), 0.001, 0.999);
      const predictedWinnerWon = expectedWinner >= 0.5;
      const rawPredictedWinnerWon = rawExpectedWinner >= 0.5;
      const favoriteProbability = round(Math.max(expectedWinner, 1 - expectedWinner), 4);
      const rawFavoriteProbability = round(Math.max(rawExpectedWinner, 1 - rawExpectedWinner), 4);
      const favoriteName = predictedWinnerWon ? impact.winner_name : impact.loser_name;
      const underdogName = predictedWinnerWon ? impact.loser_name : impact.winner_name;
      return {
        ...impact,
        rating_gap: ratingGap,
        raw_rating_gap: rawRatingGap,
        expected_winner_probability: expectedWinner,
        raw_expected_winner_probability: rawExpectedWinner,
        favorite_probability: favoriteProbability,
        raw_favorite_probability: rawFavoriteProbability,
        favorite_name: favoriteName,
        underdog_name: underdogName,
        predicted_winner_won: predictedWinnerWon,
        raw_predicted_winner_won: rawPredictedWinnerWon,
        upset: !predictedWinnerWon,
        raw_upset: !rawPredictedWinnerWon,
        brier_score: round((1 - expectedWinner) ** 2, 4),
        raw_brier_score: round((1 - rawExpectedWinner) ** 2, 4),
        log_loss: round(-Math.log(expectedWinner), 4),
        raw_log_loss: round(-Math.log(rawExpectedWinner), 4),
        favorite_confidence_bucket: favoriteConfidenceBucket(favoriteProbability),
        raw_favorite_confidence_bucket: favoriteConfidenceBucket(rawFavoriteProbability),
        method_bucket: methodBucket(impact.method),
      };
    });

  const byDivision = groupBy(eligible, (impact) => impact.division);
  const divisions = Object.fromEntries(
    [...byDivision.entries()].map(([division, rows]) => [division, summarize(rows)]),
  );
  const division_rankings = [...byDivision.entries()]
    .map(([division, rows]) => ({
      division,
      ...summarize(rows),
      reliability: reliabilityLabel(rows),
    }))
    .sort((a, b) => b.fights - a.fights || b.accuracy - a.accuracy);
  const byYear = groupBy(eligible, (impact) => impact.event_date.slice(0, 4));
  const years = Object.fromEntries([...byYear.entries()].map(([year, rows]) => [year, summarize(rows)]));
  const ratingGapBuckets = buildRatingGapBuckets(eligible);
  const confidenceBuckets = buildFavoriteConfidenceBuckets(eligible);
  const fightContextBuckets = buildFightContextBuckets(eligible);
  const methodBuckets = buildMethodBuckets(eligible);
  const baselines = buildBaselineComparisons(eligible);
  const titleContextValidation = buildTitleContextValidation(eligible);
  const modelMisses = buildModelMisses(eligible);
  const answers = buildQuestionAnswers({
    rows: eligible,
    baselines,
    titleContextValidation,
    divisionRankings: division_rankings,
  });

  const upsets = eligible
    .filter((impact) => impact.upset)
    .sort((a, b) => Math.abs(b.rating_gap) - Math.abs(a.rating_gap))
    .slice(0, 20)
    .map((impact) => ({
      date: impact.event_date,
      division: impact.division,
      winner: impact.winner_name,
      loser: impact.loser_name,
      method: impact.method,
      winner_pre_rating: impact.winner_pre_rating,
      loser_pre_rating: impact.loser_pre_rating,
      rating_gap: impact.rating_gap,
      raw_rating_gap: impact.raw_rating_gap,
      favorite_probability: impact.favorite_probability,
      brier_score: impact.brier_score,
      log_loss: impact.log_loss,
    }));

  return {
    generated_at: new Date().toISOString(),
    model_version: rankings?.model_version ?? "unknown",
    rankings_as_of: rankings?.as_of ?? "unknown",
    since,
    summary: summarize(eligible),
    answers,
    baselines,
    title_context_validation: titleContextValidation,
    external_rankings_comparison: {
      media_rankings: {
        status: "needs_historical_snapshots",
        can_backtest: false,
        detail:
          "Current media rankings cannot be used as a fair historical predictor. Add dated media-ranking snapshots before each event to compare OctagonRank against media rankings.",
      },
      meta_rankings: {
        status: "needs_historical_snapshots",
        can_backtest: false,
        detail:
          "Current Meta rankings are useful for the live comparison board, but backtesting requires dated snapshots from before each fight.",
      },
    },
    divisions,
    division_rankings,
    years,
    rating_gap_buckets: ratingGapBuckets,
    favorite_confidence_buckets: confidenceBuckets,
    fight_context_buckets: fightContextBuckets,
    method_buckets: methodBuckets,
    biggest_model_misses: modelMisses,
    largest_rating_upsets: upsets,
  };
}

function summarize(rows) {
  return summarizePrediction(rows, {
    probabilityKey: "expected_winner_probability",
    confidenceKey: "favorite_probability",
    predictedKey: "predicted_winner_won",
    gapKey: "rating_gap",
    brierKey: "brier_score",
    logLossKey: "log_loss",
  });
}

function summarizeRaw(rows) {
  return summarizePrediction(rows, {
    probabilityKey: "raw_expected_winner_probability",
    confidenceKey: "raw_favorite_probability",
    predictedKey: "raw_predicted_winner_won",
    gapKey: "raw_rating_gap",
    brierKey: "raw_brier_score",
    logLossKey: "raw_log_loss",
  });
}

function summarizePrediction(rows, keys) {
  const total = rows.length;
  const correct = rows.filter((row) => Boolean(row[keys.predictedKey])).length;
  const accuracy = total > 0 ? correct / total : 0;
  const averageWinnerGap = total > 0 ? rows.reduce((sum, row) => sum + num(row[keys.gapKey]), 0) / total : 0;
  const averageFavoriteProbability = average(rows, (row) => row[keys.confidenceKey]);
  const averageWinnerProbability = average(rows, (row) => row[keys.probabilityKey]);
  const brierScore = average(rows, (row) => row[keys.brierKey]);
  const logLoss = average(rows, (row) => row[keys.logLossKey]);
  const calibrationError = total > 0 ? Math.abs(accuracy - averageFavoriteProbability) : 0;
  const favorites = rows.filter((row) => Boolean(row[keys.predictedKey]));
  const underdogs = rows.filter((row) => !Boolean(row[keys.predictedKey]));

  return {
    fights: total,
    correct,
    accuracy: round(accuracy, 4),
    expected_correct: round(total * averageFavoriteProbability, 2),
    average_favorite_probability: round(averageFavoriteProbability, 4),
    average_winner_probability: round(averageWinnerProbability, 4),
    calibration_error: round(calibrationError, 4),
    brier_score: round(brierScore, 4),
    log_loss: round(logLoss, 4),
    validation_score: validationScore({ accuracy, brierScore, logLoss, calibrationError }),
    average_winner_rating_gap: round(averageWinnerGap, 2),
    favorite_wins: favorites.length,
    underdog_wins: underdogs.length,
    underdog_win_rate: round(underdogs.length / Math.max(1, total), 4),
  };
}

function buildBaselineComparisons(rows) {
  const octagonRank = {
    key: "octagonrank_context",
    label: "OctagonRank context model",
    description: "Context-aware pre-fight probability using rating, opponent quality, and fight-context adjustments.",
    ...summarize(rows),
  };
  const rawElo = {
    key: "raw_elo_only",
    label: "Raw Elo-only baseline",
    description: "Same fight sample using only pre-fight Elo rating gap before context adjustments.",
    ...summarizeRaw(rows),
  };
  const coinFlip = {
    key: "coin_flip",
    label: "Coin-flip baseline",
    description: "A naive benchmark: every fight is treated as 50/50.",
    fights: rows.length,
    accuracy: 0.5,
    expected_correct: round(rows.length * 0.5, 2),
    average_favorite_probability: 0.5,
    average_winner_probability: 0.5,
    calibration_error: 0,
    brier_score: 0.25,
    log_loss: round(Math.log(2), 4),
    validation_score: validationScore({
      accuracy: 0.5,
      brierScore: 0.25,
      logLoss: Math.log(2),
      calibrationError: 0,
    }),
  };

  return {
    primary: octagonRank,
    baselines: [rawElo, coinFlip],
    deltas: [
      deltaAgainst(octagonRank, rawElo),
      deltaAgainst(octagonRank, coinFlip),
    ],
  };
}

function deltaAgainst(primary, baseline) {
  return {
    baseline: baseline.key,
    label: `${primary.label} vs ${baseline.label}`,
    accuracy_delta: round(num(primary.accuracy) - num(baseline.accuracy), 4),
    brier_delta: round(num(primary.brier_score) - num(baseline.brier_score), 4),
    log_loss_delta: round(num(primary.log_loss) - num(baseline.log_loss), 4),
    validation_score_delta: round(num(primary.validation_score) - num(baseline.validation_score), 2),
  };
}

function buildTitleContextValidation(rows) {
  const titleContextRows = rows.filter((row) => Boolean(row.winner_title_context || row.loser_title_context));
  const titleContextWinnerRows = rows.filter((row) => Boolean(row.winner_title_context));
  const titleContextLoserRows = rows.filter((row) => Boolean(row.loser_title_context));
  const titleContextReasonRows = rows.filter((row) => String(row.opponent_context_reason ?? "").includes("title_context"));

  return {
    title_context_fights: summarize(titleContextRows),
    title_context_winner_sample: summarize(titleContextWinnerRows),
    title_context_loser_sample: summarize(titleContextLoserRows),
    title_context_reason_sample: summarize(titleContextReasonRows),
    interpretation:
      "This checks whether title-context fighters and title-lineage wins behave sensibly in historical fight prediction. It is not a title-shot correctness test by itself.",
  };
}

function buildQuestionAnswers({ rows, baselines, titleContextValidation, divisionRankings }) {
  const leastStableDivisions = [...divisionRankings]
    .sort((a, b) => b.underdog_win_rate - a.underdog_win_rate || b.calibration_error - a.calibration_error)
    .slice(0, 5)
    .map((division) => ({
      division: division.division,
      fights: division.fights,
      accuracy: division.accuracy,
      underdog_win_rate: division.underdog_win_rate,
      calibration_error: division.calibration_error,
    }));
  const rawDelta = baselines.deltas.find((delta) => delta.baseline === "raw_elo_only");

  return {
    higher_rated_fighters_win_more:
      `Yes. OctagonRank favorites won ${pct(baselines.primary.accuracy)} of ${rows.length} tested fights since this backtest start date.`,
    octagonrank_vs_raw_baseline:
      rawDelta && rawDelta.accuracy_delta >= 0
        ? `OctagonRank beat the raw Elo-only baseline by ${pct(rawDelta.accuracy_delta)} accuracy points on this sample.`
        : `OctagonRank trailed the raw Elo-only baseline by ${pct(Math.abs(rawDelta?.accuracy_delta ?? 0))} accuracy points on this sample.`,
    octagonrank_vs_media_rankings:
      "Not proven yet. A fair comparison needs dated media-ranking snapshots from before each fight; current rankings would leak future information.",
    title_context_check:
      `Title-context fights in the sample tested at ${pct(titleContextValidation.title_context_fights.accuracy)} favorite accuracy across ${titleContextValidation.title_context_fights.fights} fights.`,
    most_unstable_divisions: leastStableDivisions,
  };
}

function buildModelMisses(rows) {
  return rows
    .filter((row) => row.upset)
    .sort((a, b) => b.log_loss - a.log_loss || b.favorite_probability - a.favorite_probability)
    .slice(0, 25)
    .map((row) => ({
      date: row.event_date,
      division: row.division,
      predicted_winner: row.favorite_name,
      actual_winner: row.winner_name,
      loser: row.loser_name,
      method: row.method,
      favorite_probability: row.favorite_probability,
      expected_winner_probability: row.expected_winner_probability,
      rating_gap: row.rating_gap,
      raw_rating_gap: row.raw_rating_gap,
      brier_score: row.brier_score,
      log_loss: row.log_loss,
      context_note: row.opponent_context_reason || row.repeatability_reason || "",
    }));
}

function buildRatingGapBuckets(rows) {
  const buckets = [
    { key: "pickem_0_25", label: "Pick'em (0-25)", min: 0, max: 25 },
    { key: "lean_25_50", label: "Lean (25-50)", min: 25, max: 50 },
    { key: "solid_50_100", label: "Solid favorite (50-100)", min: 50, max: 100 },
    { key: "large_100_plus", label: "Large favorite (100+)", min: 100, max: Infinity },
  ];

  return buckets.map((bucket) => {
    const bucketRows = rows.filter((row) => {
      const gap = Math.abs(num(row.rating_gap));
      return gap >= bucket.min && gap < bucket.max;
    });
    return {
      bucket: bucket.key,
      label: bucket.label,
      min_abs_rating_gap: bucket.min,
      max_abs_rating_gap: Number.isFinite(bucket.max) ? bucket.max : null,
      ...summarize(bucketRows),
    };
  });
}

function buildFavoriteConfidenceBuckets(rows) {
  const buckets = [
    { key: "coinflip_50_55", label: "50-55%", min: 0.5, max: 0.55 },
    { key: "lean_55_60", label: "55-60%", min: 0.55, max: 0.6 },
    { key: "solid_60_65", label: "60-65%", min: 0.6, max: 0.65 },
    { key: "strong_65_70", label: "65-70%", min: 0.65, max: 0.7 },
    { key: "heavy_70_plus", label: "70%+", min: 0.7, max: Infinity },
  ];

  return buckets.map((bucket) => {
    const bucketRows = rows.filter((row) => row.favorite_probability >= bucket.min && row.favorite_probability < bucket.max);
    return {
      bucket: bucket.key,
      label: bucket.label,
      min_favorite_probability: bucket.min,
      max_favorite_probability: Number.isFinite(bucket.max) ? bucket.max : null,
      ...summarize(bucketRows),
    };
  });
}

function buildFightContextBuckets(rows) {
  const buckets = [
    {
      key: "ranked_rating_proxy",
      label: "Ranked proxy (max pre-rating 1600+)",
      test: (row) => Math.max(num(row.winner_pre_rating), num(row.loser_pre_rating)) >= 1600,
    },
    {
      key: "elite_rating_proxy",
      label: "Elite proxy (max pre-rating 1650+)",
      test: (row) => Math.max(num(row.winner_pre_rating), num(row.loser_pre_rating)) >= 1650,
    },
    {
      key: "title_context_win_sample",
      label: "Winner beat title-context opponent",
      test: (row) => String(row.opponent_context_reason ?? "").includes("title_context"),
    },
    {
      key: "title_context_fight",
      label: "Fight involved title-context fighter",
      test: (row) => Boolean(row.winner_title_context || row.loser_title_context),
    },
    {
      key: "thin_or_debut_level",
      label: "Thin/debut-level rating sample",
      test: (row) => Math.max(num(row.winner_pre_rating), num(row.loser_pre_rating)) < 1525,
    },
    {
      key: "dominant_winner_profile",
      label: "Dominant winner profile",
      test: (row) => num(row.dominance_score) >= 65 || num(row.round_dominance_score) >= 65,
    },
    {
      key: "low_repeatability_profile",
      label: "Low-repeatability/comeback profile",
      test: (row) => Boolean(row.repeatability_reason) || num(row.dominance_score) < 45,
    },
  ];

  return buckets.map((bucket) => {
    const bucketRows = rows.filter(bucket.test);
    return {
      bucket: bucket.key,
      label: bucket.label,
      ...summarize(bucketRows),
    };
  });
}

function buildMethodBuckets(rows) {
  const byMethod = groupBy(rows, (row) => row.method_bucket);
  return [...byMethod.entries()]
    .map(([method, methodRows]) => ({
      method,
      ...summarize(methodRows),
    }))
    .sort((a, b) => b.fights - a.fights);
}

function reliabilityLabel(rows) {
  if (rows.length >= 100) return "high sample";
  if (rows.length >= 40) return "medium sample";
  return "low sample";
}

function buildMarkdownReport(report) {
  const answerRows = Object.entries(report.answers ?? {})
    .filter(([, answer]) => typeof answer === "string")
    .map(([question, answer]) => [humanizeKey(question), answer]);
  const baselineRows = [
    report.baselines.primary,
    ...(report.baselines.baselines ?? []),
  ].map((baseline) => [
    baseline.label,
    baseline.fights,
    pct(baseline.accuracy),
    pct(baseline.average_favorite_probability),
    pct(baseline.calibration_error),
    fmt(baseline.brier_score),
    fmt(baseline.log_loss),
    fmt(baseline.validation_score),
  ]);
  const deltaRows = (report.baselines.deltas ?? []).map((delta) => [
    delta.label,
    pct(delta.accuracy_delta),
    fmt(delta.brier_delta),
    fmt(delta.log_loss_delta),
    fmt(delta.validation_score_delta),
  ]);
  const divisionRows = report.division_rankings.map((division) => [
    division.division,
    division.fights,
    pct(division.accuracy),
    division.correct,
    division.underdog_wins,
    pct(division.underdog_win_rate),
    fmt(division.average_winner_rating_gap),
    division.reliability,
  ]);
  const bucketRows = report.rating_gap_buckets.map((bucket) => [
    bucket.label,
    bucket.fights,
    pct(bucket.accuracy),
    pct(bucket.average_favorite_probability),
    pct(bucket.calibration_error),
    fmt(bucket.brier_score),
    fmt(bucket.log_loss),
    bucket.correct,
    bucket.underdog_wins,
  ]);
  const confidenceRows = report.favorite_confidence_buckets.map((bucket) => [
    bucket.label,
    bucket.fights,
    pct(bucket.accuracy),
    pct(bucket.average_favorite_probability),
    pct(bucket.calibration_error),
    fmt(bucket.brier_score),
    fmt(bucket.log_loss),
    fmt(bucket.validation_score),
  ]);
  const contextRows = report.fight_context_buckets.map((bucket) => [
    bucket.label,
    bucket.fights,
    pct(bucket.accuracy),
    pct(bucket.average_favorite_probability),
    pct(bucket.calibration_error),
    fmt(bucket.brier_score),
    fmt(bucket.log_loss),
  ]);
  const titleRows = Object.entries(report.title_context_validation ?? {})
    .filter(([, value]) => value && typeof value === "object" && "fights" in value)
    .map(([key, row]) => [
      humanizeKey(key),
      row.fights,
      pct(row.accuracy),
      pct(row.average_favorite_probability),
      pct(row.calibration_error),
      fmt(row.brier_score),
      fmt(row.log_loss),
    ]);
  const methodRows = report.method_buckets.map((bucket) => [
    bucket.method,
    bucket.fights,
    pct(bucket.accuracy),
    pct(bucket.average_favorite_probability),
    pct(bucket.calibration_error),
    fmt(bucket.brier_score),
    fmt(bucket.log_loss),
  ]);
  const yearRows = Object.entries(report.years).map(([year, row]) => [
    year,
    row.fights,
    pct(row.accuracy),
    row.correct,
    row.underdog_wins,
    pct(row.underdog_win_rate),
  ]);
  const upsetRows = report.largest_rating_upsets.map((upset) => [
    upset.date,
    upset.division,
    upset.winner,
    upset.loser,
    fmt(upset.rating_gap),
    upset.method,
  ]);
  const missRows = (report.biggest_model_misses ?? []).slice(0, 15).map((miss) => [
    miss.date,
    miss.division,
    miss.predicted_winner,
    miss.actual_winner,
    pct(miss.favorite_probability),
    fmt(miss.rating_gap),
    fmt(miss.log_loss),
    miss.method,
  ]);

  return [
    "# OctagonRank Backtest",
    "",
    `Generated at: \`${report.generated_at}\``,
    `Model version: \`${report.model_version}\``,
    `Rankings as of: \`${report.rankings_as_of}\``,
    `Test since: \`${report.since}\``,
    "",
    "## Summary",
    "",
    `- fights: \`${report.summary.fights}\``,
    `- accuracy: \`${pct(report.summary.accuracy)}\``,
    `- validation score: \`${fmt(report.summary.validation_score)}\``,
    `- avg favorite probability: \`${pct(report.summary.average_favorite_probability)}\``,
    `- calibration error: \`${pct(report.summary.calibration_error)}\``,
    `- Brier score: \`${fmt(report.summary.brier_score)}\``,
    `- log loss: \`${fmt(report.summary.log_loss)}\``,
    `- underdog wins: \`${report.summary.underdog_wins}\``,
    `- average winner rating gap: \`${fmt(report.summary.average_winner_rating_gap)}\``,
    "",
    markdownTable(
      "## Direct Answers",
      ["Question", "Answer"],
      answerRows,
      "No direct-answer rows.",
    ),
    "",
    markdownTable(
      "## Baseline Comparison",
      ["Model", "Fights", "Accuracy", "Avg Fav Prob", "Calibration Error", "Brier", "Log Loss", "Validation Score"],
      baselineRows,
      "No baseline rows.",
    ),
    "",
    markdownTable(
      "## Baseline Deltas",
      ["Comparison", "Accuracy Delta", "Brier Delta", "Log Loss Delta", "Validation Delta"],
      deltaRows,
      "No baseline deltas.",
    ),
    "",
    "## External Ranking Comparison",
    "",
    `- Media rankings: \`${report.external_rankings_comparison.media_rankings.status}\` - ${report.external_rankings_comparison.media_rankings.detail}`,
    `- Meta rankings: \`${report.external_rankings_comparison.meta_rankings.status}\` - ${report.external_rankings_comparison.meta_rankings.detail}`,
    "",
    markdownTable(
      "## Division Validation",
      ["Division", "Fights", "Accuracy", "Correct", "Underdog Wins", "Underdog Rate", "Avg Winner Gap", "Reliability"],
      divisionRows,
      "No division rows.",
    ),
    "",
    markdownTable(
      "## Rating-Gap Buckets",
      ["Bucket", "Fights", "Accuracy", "Avg Fav Prob", "Calibration Error", "Brier", "Log Loss", "Correct", "Upsets"],
      bucketRows,
      "No rating-gap buckets.",
    ),
    "",
    markdownTable(
      "## Favorite Confidence Calibration",
      ["Favorite Prob", "Fights", "Accuracy", "Avg Fav Prob", "Calibration Error", "Brier", "Log Loss", "Validation Score"],
      confidenceRows,
      "No favorite confidence buckets.",
    ),
    "",
    markdownTable(
      "## Fight Context Validation",
      ["Context", "Fights", "Accuracy", "Avg Fav Prob", "Calibration Error", "Brier", "Log Loss"],
      contextRows,
      "No fight context buckets.",
    ),
    "",
    markdownTable(
      "## Title-Context Validation",
      ["Sample", "Fights", "Accuracy", "Avg Fav Prob", "Calibration Error", "Brier", "Log Loss"],
      titleRows,
      "No title-context rows.",
    ),
    "",
    markdownTable(
      "## Method Validation",
      ["Method", "Fights", "Accuracy", "Avg Fav Prob", "Calibration Error", "Brier", "Log Loss"],
      methodRows,
      "No method buckets.",
    ),
    "",
    markdownTable(
      "## Year Slices",
      ["Year", "Fights", "Accuracy", "Correct", "Underdog Wins", "Underdog Rate"],
      yearRows,
      "No yearly rows.",
    ),
    "",
    markdownTable(
      "## Largest Rating Upsets",
      ["Date", "Division", "Winner", "Loser", "Winner Rating Gap", "Method"],
      upsetRows,
      "No upsets found.",
    ),
    "",
    markdownTable(
      "## Biggest Model Misses",
      ["Date", "Division", "Predicted Winner", "Actual Winner", "Favorite Prob", "Winner Rating Gap", "Log Loss", "Method"],
      missRows,
      "No model misses found.",
    ),
    "",
  ].join("\n");
}

function groupBy(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function validationScore({ accuracy, brierScore, logLoss, calibrationError }) {
  return round(accuracy * 1000 - brierScore * 250 - logLoss * 40 - calibrationError * 100, 2);
}

function favoriteConfidenceBucket(probability) {
  if (probability < 0.55) return "50-55%";
  if (probability < 0.6) return "55-60%";
  if (probability < 0.65) return "60-65%";
  if (probability < 0.7) return "65-70%";
  return "70%+";
}

function methodBucket(method) {
  const value = String(method ?? "").toLowerCase();
  if (value.includes("decision")) return "Decision";
  if (value.includes("ko") || value.includes("tko") || value.includes("doctor")) return "KO/TKO";
  if (value.includes("submission")) return "Submission";
  return "Other";
}

function expectedScoreFromGap(gap) {
  return 1 / (1 + 10 ** (-num(gap) / 400));
}

function average(rows, valueFn) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + num(valueFn(row)), 0) / rows.length;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--fight-impacts=")) {
      args.fightImpactsPath = arg.slice("--fight-impacts=".length);
    } else if (arg.startsWith("--rankings=")) {
      args.rankingsPath = arg.slice("--rankings=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--markdown-out=")) {
      args.markdownOutPath = arg.slice("--markdown-out=".length);
    } else if (arg.startsWith("--since=")) {
      args.since = arg.slice("--since=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Backtest pre-fight OctagonRank ratings against future fight winners.

Usage:
  npm run model:backtest
  node scripts/backtest-model.mjs --since=2024-01-01 --out=data/model/backtest.json

Options:
  --fight-impacts=PATH  Generated fight impacts JSON path.
  --rankings=PATH       Generated rankings JSON path.
  --out=PATH            Backtest output JSON path.
  --markdown-out=PATH   Backtest Markdown output path.
  --since=YYYY-MM-DD    First fight date included in the test.
`);
}

function printSummary(report, args) {
  console.log(`Wrote backtest report to ${args.outPath}`);
  console.log(`Wrote backtest review to ${args.markdownOutPath}`);
  console.log(`fights: ${report.summary.fights}`);
  console.log(`accuracy: ${(report.summary.accuracy * 100).toFixed(1)}%`);
  console.log(`validation score: ${report.summary.validation_score.toFixed(2)}`);
  console.log(`brier score: ${report.summary.brier_score.toFixed(4)}`);
  console.log(`log loss: ${report.summary.log_loss.toFixed(4)}`);
  console.log(`underdog wins: ${report.summary.underdog_wins}`);
}

function markdownTable(title, headers, rows, emptyText) {
  if (!rows.length) return [title, "", emptyText].join("\n");
  return [
    title,
    "",
    `| ${headers.map(escapeMarkdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`),
  ].join("\n");
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();
}

function humanizeKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pct(value) {
  return `${(num(value) * 100).toFixed(1)}%`;
}

function fmt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return parsed.toFixed(2);
}

function num(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
