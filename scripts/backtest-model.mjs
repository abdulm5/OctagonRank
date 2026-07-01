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
      const ratingGap = round(num(impact.winner_pre_rating) - num(impact.loser_pre_rating), 2);
      const predictedWinnerWon = ratingGap >= 0;
      return {
        ...impact,
        rating_gap: ratingGap,
        predicted_winner_won: predictedWinnerWon,
        upset: !predictedWinnerWon,
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
    largest_rating_upsets: upsets,
  };
}

function summarize(rows) {
  const total = rows.length;
  const correct = rows.filter((row) => row.predicted_winner_won).length;
  const accuracy = total > 0 ? correct / total : 0;
  const averageWinnerGap = total > 0 ? rows.reduce((sum, row) => sum + row.rating_gap, 0) / total : 0;
  const favorites = rows.filter((row) => row.rating_gap >= 0);
  const underdogs = rows.filter((row) => row.rating_gap < 0);

  return {
    fights: total,
    correct,
    accuracy: round(accuracy, 4),
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
    bucket.correct,
    bucket.underdog_wins,
    pct(bucket.underdog_win_rate),
    fmt(bucket.average_winner_rating_gap),
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
      ["Bucket", "Fights", "Accuracy", "Correct", "Underdog Wins", "Underdog Rate", "Avg Winner Gap"],
      bucketRows,
      "No rating-gap buckets.",
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

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
