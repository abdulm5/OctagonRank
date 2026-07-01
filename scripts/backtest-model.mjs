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
      const predictedWinnerWon = expectedWinner >= 0.5;
      const favoriteProbability = round(Math.max(expectedWinner, 1 - expectedWinner), 4);
      const favoriteName = predictedWinnerWon ? impact.winner_name : impact.loser_name;
      const underdogName = predictedWinnerWon ? impact.loser_name : impact.winner_name;
      return {
        ...impact,
        rating_gap: ratingGap,
        raw_rating_gap: rawRatingGap,
        expected_winner_probability: expectedWinner,
        favorite_probability: favoriteProbability,
        favorite_name: favoriteName,
        underdog_name: underdogName,
        predicted_winner_won: predictedWinnerWon,
        upset: !predictedWinnerWon,
        brier_score: round((1 - expectedWinner) ** 2, 4),
        log_loss: round(-Math.log(expectedWinner), 4),
        favorite_confidence_bucket: favoriteConfidenceBucket(favoriteProbability),
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
    divisions,
    division_rankings,
    years,
    rating_gap_buckets: ratingGapBuckets,
    favorite_confidence_buckets: confidenceBuckets,
    fight_context_buckets: fightContextBuckets,
    method_buckets: methodBuckets,
    largest_rating_upsets: upsets,
  };
}

function summarize(rows) {
  const total = rows.length;
  const correct = rows.filter((row) => row.predicted_winner_won).length;
  const accuracy = total > 0 ? correct / total : 0;
  const averageWinnerGap = total > 0 ? rows.reduce((sum, row) => sum + row.rating_gap, 0) / total : 0;
  const averageFavoriteProbability = average(rows, (row) => row.favorite_probability);
  const brierScore = average(rows, (row) => row.brier_score);
  const logLoss = average(rows, (row) => row.log_loss);
  const calibrationError = total > 0 ? Math.abs(accuracy - averageFavoriteProbability) : 0;
  const favorites = rows.filter((row) => row.rating_gap >= 0);
  const underdogs = rows.filter((row) => row.rating_gap < 0);

  return {
    fights: total,
    correct,
    accuracy: round(accuracy, 4),
    expected_correct: round(total * averageFavoriteProbability, 2),
    average_favorite_probability: round(averageFavoriteProbability, 4),
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
