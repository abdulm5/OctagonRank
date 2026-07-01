#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULTS = {
  dataDir: "data/ufcstats",
  outPath: "data/model/ranking_history.json",
  markdownOutPath: "data/model/ranking_history.md",
  runRoot: "data/model/history_runs",
  start: "2024-01-01",
  end: "",
  months: 3,
  rankLimit: 15,
  keepRuns: true,
  useCurrentSnapshot: false,
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

  const summary = await readJson(path.resolve(process.cwd(), args.dataDir, "summary.json"));
  const end = args.end || summary.end_date;
  const dates = buildSnapshotDates({ start: args.start, end, months: args.months });
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.resolve(process.cwd(), args.runRoot, runId);
  const snapshots = [];

  await fs.mkdir(runRoot, { recursive: true });
  console.log(`Building ${dates.length} historical snapshot(s)...`);

  for (const [index, date] of dates.entries()) {
    console.log(`[${index + 1}/${dates.length}] ${date}`);
    snapshots.push(await buildSnapshot({ date, args, runRoot }));
  }

  const report = buildHistoryReport({ snapshots, args, runRoot });
  const outputPath = path.resolve(process.cwd(), args.outPath);
  const markdownPath = path.resolve(process.cwd(), args.markdownOutPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await Promise.all([
    fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(markdownPath, buildMarkdownReport(report)),
  ]);

  if (!args.keepRuns) {
    await fs.rm(runRoot, { recursive: true, force: true });
  }

  printSummary(report, args);
}

async function buildSnapshot({ date, args, runRoot }) {
  const outDir = path.join(runRoot, date);
  const commandArgs = [
    "scripts/build-rankings-model.mjs",
    `--data-dir=${args.dataDir}`,
    `--out-dir=${outDir}`,
    `--as-of=${date}`,
  ];
  if (!args.useCurrentSnapshot) commandArgs.push("--no-current-snapshot");

  await runNode(commandArgs);
  const rankings = await readJson(path.join(outDir, "rankings.json"));
  return {
    date,
    model_version: rankings.model_version,
    as_of: rankings.as_of,
    divisions: (rankings.divisions ?? []).map((division) => ({
      division: division.division,
      champion: division.champion ?? "",
      rankings: (division.rankings ?? []).slice(0, args.rankLimit).map((fighter) => ({
        rank: fighter.rank,
        fighter: fighter.fighter_name,
        final_score: num(fighter.final_score),
        model_score: num(fighter.model_score),
        score_confidence: fighter.score_confidence ?? "",
        score_band_rank_range: fighter.score_band_rank_range ?? "",
      })),
    })),
  };
}

function buildHistoryReport({ snapshots, args, runRoot }) {
  const rows = [];
  const previousByDivision = new Map();

  for (const snapshot of snapshots) {
    for (const division of snapshot.divisions) {
      const previousRanks = previousByDivision.get(division.division) ?? new Map();
      const currentRanks = new Map();
      for (const fighter of division.rankings) {
        const previousRank = previousRanks.get(normalizeName(fighter.fighter));
        const rankChange = previousRank ? previousRank - fighter.rank : null;
        rows.push({
          date: snapshot.date,
          division: division.division,
          rank: fighter.rank,
          previous_rank: previousRank ?? null,
          rank_change: rankChange,
          fighter: fighter.fighter,
          final_score: fighter.final_score,
          model_score: fighter.model_score,
          score_confidence: fighter.score_confidence,
          score_band_rank_range: fighter.score_band_rank_range,
        });
        currentRanks.set(normalizeName(fighter.fighter), fighter.rank);
      }
      previousByDivision.set(division.division, currentRanks);
    }
  }

  const trends = buildFighterTrends(rows);

  return {
    generated_at: new Date().toISOString(),
    start: snapshots[0]?.date ?? "",
    end: snapshots.at(-1)?.date ?? "",
    interval_months: args.months,
    rank_limit: args.rankLimit,
    use_current_snapshot: args.useCurrentSnapshot,
    run_root: path.relative(process.cwd(), runRoot),
    summary: {
      snapshots: snapshots.length,
      divisions: snapshots[0]?.divisions.length ?? 0,
      rows: rows.length,
      tracked_fighter_divisions: trends.length,
    },
    snapshots: snapshots.map((snapshot) => ({
      date: snapshot.date,
      model_version: snapshot.model_version,
      divisions: snapshot.divisions.map((division) => ({
        division: division.division,
        top_five: division.rankings.slice(0, 5),
      })),
    })),
    rows,
    biggest_risers: trends
      .filter((trend) => trend.appearances >= 2)
      .sort((a, b) => b.net_rank_change - a.net_rank_change || a.latest_rank - b.latest_rank)
      .slice(0, 25),
    biggest_fallers: trends
      .filter((trend) => trend.appearances >= 2)
      .sort((a, b) => a.net_rank_change - b.net_rank_change || b.latest_rank - a.latest_rank)
      .slice(0, 25),
    trends,
  };
}

function buildFighterTrends(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.division}::${normalizeName(row.fighter)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  return [...grouped.values()].map((history) => {
    const ordered = history.slice().sort((a, b) => a.date.localeCompare(b.date));
    const first = ordered[0];
    const latest = ordered.at(-1);
    const scores = ordered.map((row) => row.final_score);
    return {
      division: latest.division,
      fighter: latest.fighter,
      appearances: ordered.length,
      first_date: first.date,
      latest_date: latest.date,
      first_rank: first.rank,
      latest_rank: latest.rank,
      best_rank: Math.min(...ordered.map((row) => row.rank)),
      worst_rank: Math.max(...ordered.map((row) => row.rank)),
      net_rank_change: first.rank - latest.rank,
      score_change: round(scores.at(-1) - scores[0], 2),
      history: ordered.map((row) => ({
        date: row.date,
        rank: row.rank,
        rank_change: row.rank_change,
        final_score: row.final_score,
        score_confidence: row.score_confidence,
      })),
    };
  });
}

function buildMarkdownReport(report) {
  const snapshotRows = report.snapshots.flatMap((snapshot) =>
    snapshot.divisions.map((division) => [
      snapshot.date,
      division.division,
      division.top_five.map((fighter) => `${fighter.rank}. ${fighter.fighter}`).join(", "),
    ]),
  );
  const riserRows = report.biggest_risers.slice(0, 15).map(formatTrendRow);
  const fallerRows = report.biggest_fallers.slice(0, 15).map(formatTrendRow);

  return [
    "# OctagonRank Ranking History",
    "",
    `Generated at: \`${report.generated_at}\``,
    `Window: \`${report.start}\` to \`${report.end}\``,
    `Interval: every \`${report.interval_months}\` month(s)`,
    `Current snapshot policy enabled: \`${report.use_current_snapshot}\``,
    "",
    "## Summary",
    "",
    `- snapshots: \`${report.summary.snapshots}\``,
    `- divisions: \`${report.summary.divisions}\``,
    `- tracked fighter/division rows: \`${report.summary.tracked_fighter_divisions}\``,
    "",
    markdownTable(
      "## Biggest Risers",
      ["Division", "Fighter", "First", "Latest", "Net Rank Change", "Score Change", "Appearances"],
      riserRows,
      "No risers found.",
    ),
    "",
    markdownTable(
      "## Biggest Fallers",
      ["Division", "Fighter", "First", "Latest", "Net Rank Change", "Score Change", "Appearances"],
      fallerRows,
      "No fallers found.",
    ),
    "",
    markdownTable(
      "## Snapshot Top Fives",
      ["Date", "Division", "Top Five"],
      snapshotRows,
      "No snapshots found.",
    ),
    "",
  ].join("\n");
}

function formatTrendRow(trend) {
  return [
    trend.division,
    trend.fighter,
    `${trend.first_date} #${trend.first_rank}`,
    `${trend.latest_date} #${trend.latest_rank}`,
    signed(trend.net_rank_change),
    signed(trend.score_change),
    trend.appearances,
  ];
}

function buildSnapshotDates({ start, end, months }) {
  const startDate = parseDate(start, "--start");
  const endDate = parseDate(end, "--end");
  if (startDate > endDate) throw new Error("--start must be on or before --end.");

  const dates = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(toIsoDate(cursor));
    cursor = addMonths(cursor, months);
  }
  const endIso = toIsoDate(endDate);
  if (dates.at(-1) !== endIso) dates.push(endIso);
  return dates;
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) {
    throw new Error(`${label} must be formatted as YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || toIsoDate(date) !== value) {
    throw new Error(`${label} is not a valid calendar date: ${value}`);
  }
  return date;
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--data-dir=")) {
      args.dataDir = arg.slice("--data-dir=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--markdown-out=")) {
      args.markdownOutPath = arg.slice("--markdown-out=".length);
    } else if (arg.startsWith("--run-root=")) {
      args.runRoot = arg.slice("--run-root=".length);
    } else if (arg.startsWith("--start=")) {
      args.start = arg.slice("--start=".length);
    } else if (arg.startsWith("--end=")) {
      args.end = arg.slice("--end=".length);
    } else if (arg.startsWith("--months=")) {
      args.months = Number(arg.slice("--months=".length));
    } else if (arg.startsWith("--rank-limit=")) {
      args.rankLimit = Number(arg.slice("--rank-limit=".length));
    } else if (arg === "--keep-runs") {
      args.keepRuns = true;
    } else if (arg === "--no-keep-runs") {
      args.keepRuns = false;
    } else if (arg === "--use-current-snapshot") {
      args.useCurrentSnapshot = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.months) || args.months <= 0) {
    throw new Error("--months must be a positive integer.");
  }
  if (!Number.isInteger(args.rankLimit) || args.rankLimit < 1) {
    throw new Error("--rank-limit must be a positive integer.");
  }
  return args;
}

function printHelp() {
  console.log(`Generate historical OctagonRank ranking snapshots and movement trends.

Usage:
  npm run model:history
  node scripts/rank-history.mjs --start=2024-01-01 --months=3

Options:
  --data-dir=PATH          Scraped UFCStats output directory.
  --out=PATH               Ranking-history JSON output path.
  --markdown-out=PATH      Ranking-history Markdown output path.
  --run-root=PATH          Directory for per-snapshot model runs.
  --start=YYYY-MM-DD       First snapshot date.
  --end=YYYY-MM-DD         Last snapshot date. Defaults to scrape summary end date.
  --months=N               Months between snapshots. Default: 3.
  --rank-limit=N           Number of ranks per division to track. Default: 15.
  --use-current-snapshot   Apply current snapshot policy to each historical run.
  --no-keep-runs           Remove per-snapshot run directories after writing the report.
`);
}

function printSummary(report, args) {
  console.log(`Wrote ranking history to ${args.outPath}`);
  console.log(`Wrote ranking history review to ${args.markdownOutPath}`);
  console.log(`snapshots: ${report.summary.snapshots}`);
  console.log(`tracked fighter/divisions: ${report.summary.tracked_fighter_divisions}`);
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed (${code}): node ${args.join(" ")}\n${tail(stdout)}\n${tail(stderr)}`));
      }
    });
  });
}

function tail(value) {
  return String(value).split("\n").slice(-20).join("\n");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
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

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function signed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return `${parsed >= 0 ? "+" : ""}${parsed.toFixed(2).replace(/\.00$/, "")}`;
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
