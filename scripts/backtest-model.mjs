#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  fightImpactsPath: "data/model/fight_impacts.json",
  rankingsPath: "data/model/rankings.json",
  outPath: "data/model/backtest.json",
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
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report, args.outPath);
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
  };
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
  --since=YYYY-MM-DD    First fight date included in the test.
`);
}

function printSummary(report, outPath) {
  console.log(`Wrote backtest report to ${outPath}`);
  console.log(`fights: ${report.summary.fights}`);
  console.log(`accuracy: ${(report.summary.accuracy * 100).toFixed(1)}%`);
  console.log(`underdog wins: ${report.summary.underdog_wins}`);
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
