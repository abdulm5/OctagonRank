#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULTS = {
  outPath: "data/model/model_comparison.json",
  markdownOutPath: "data/model/model_comparison.md",
  runRoot: "data/model/comparison_runs",
  baseline: "baseline",
  candidate: "less_schedule_strength",
  since: "2024-01-01",
  rankLimit: 15,
  assertionsPath: "data/ranking_inputs/model_assertions.json",
  keepRuns: true,
};

const PRESETS = {
  baseline: { name: "baseline", weights: {}, cli: {} },
  lower_k_factor: { name: "lower_k_factor", weights: {}, cli: { kFactor: 30 } },
  higher_k_factor: { name: "higher_k_factor", weights: {}, cli: { kFactor: 34 } },
  less_rank_guard: { name: "less_rank_guard", weights: { rank_guard_strength: 0.85 }, cli: {} },
  more_rank_guard: { name: "more_rank_guard", weights: { rank_guard_strength: 1.12 }, cli: {} },
  less_elite_resume: { name: "less_elite_resume", weights: { elite_resume: 0.85, opponent_elite_resume: 0.9 }, cli: {} },
  more_elite_resume: { name: "more_elite_resume", weights: { elite_resume: 1.12, opponent_elite_resume: 1.08 }, cli: {} },
  less_schedule_strength: { name: "less_schedule_strength", weights: { schedule_strength: 0.85 }, cli: {} },
  more_schedule_strength: { name: "more_schedule_strength", weights: { schedule_strength: 1.12 }, cli: {} },
  no_pre_fight_context: { name: "no_pre_fight_context", weights: { pre_fight_context: 0 }, cli: {} },
  less_pre_fight_context: { name: "less_pre_fight_context", weights: { pre_fight_context: 0.65 }, cli: {} },
  more_pre_fight_context: { name: "more_pre_fight_context", weights: { pre_fight_context: 1.25 }, cli: {} },
  less_recent_form: { name: "less_recent_form", weights: { recent_form: 0.9, recent_outcome: 0.9 }, cli: {} },
  more_recent_form: { name: "more_recent_form", weights: { recent_form: 1.1, recent_outcome: 1.05 }, cli: {} },
  conservative_policy: { name: "conservative_policy", weights: { current_context_prior: 0.95, rank_guard_strength: 0.85 }, cli: {} },
  resume_quality_blend: { name: "resume_quality_blend", weights: { elite_resume: 1.08, opponent_elite_resume: 1.05, quality_win: 0.95 }, cli: {} },
  activity_heavier: { name: "activity_heavier", weights: { recent_activity: 1.1, inactivity_penalty: 1.08 }, cli: {} },
  less_top_contender_gate: { name: "less_top_contender_gate", weights: { top_contender_credibility: 0.75 }, cli: {} },
  more_top_contender_gate: { name: "more_top_contender_gate", weights: { top_contender_credibility: 1.2 }, cli: {} },
  less_snapshot_order: { name: "less_snapshot_order", weights: { snapshot_order: 0.75 }, cli: {} },
  more_snapshot_order: { name: "more_snapshot_order", weights: { snapshot_order: 1.2 }, cli: {} },
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

  const baselinePreset = getPreset(args.baseline);
  const candidatePreset = getPreset(args.candidate);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.resolve(process.cwd(), args.runRoot, runId);

  await fs.mkdir(runRoot, { recursive: true });
  console.log(`Building baseline: ${baselinePreset.name}`);
  const baseline = await runModelPreset({ preset: baselinePreset, runRoot, args });
  console.log(`Building candidate: ${candidatePreset.name}`);
  const candidate = await runModelPreset({ preset: candidatePreset, runRoot, args });

  const report = buildComparisonReport({ baseline, candidate, args, runRoot });
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

async function runModelPreset({ preset, runRoot, args }) {
  const presetDir = path.join(runRoot, preset.name);
  const modelDir = path.join(presetDir, "model");
  const configPath = path.join(presetDir, "model_config.json");
  const auditPath = path.join(presetDir, "audit.json");
  const backtestPath = path.join(presetDir, "backtest.json");
  const diagnosticsPath = path.join(presetDir, "diagnostics.json");
  const diagnosticsMarkdownPath = path.join(presetDir, "diagnostics.md");
  const assertionsPath = path.join(presetDir, "assertions.json");
  const scoreBandsPath = path.join(presetDir, "score-bands.json");
  const scoreBandsMarkdownPath = path.join(presetDir, "score-bands.md");

  await fs.mkdir(presetDir, { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify({ name: preset.name, weights: preset.weights, cli: preset.cli }, null, 2)}\n`,
  );

  await runNode([
    "scripts/build-rankings-model.mjs",
    `--out-dir=${modelDir}`,
    `--model-config=${configPath}`,
    ...buildCliArgs(preset.cli),
  ]);
  await runNode([
    "scripts/audit-rankings.mjs",
    `--rankings=${path.join(modelDir, "rankings.json")}`,
    `--fight-impacts=${path.join(modelDir, "fight_impacts.json")}`,
    `--out=${auditPath}`,
  ]);
  await runNode([
    "scripts/backtest-model.mjs",
    `--rankings=${path.join(modelDir, "rankings.json")}`,
    `--fight-impacts=${path.join(modelDir, "fight_impacts.json")}`,
    `--out=${backtestPath}`,
    `--markdown-out=${path.join(presetDir, "backtest.md")}`,
    `--since=${args.since}`,
  ]);
  await runNode([
    "scripts/diagnose-model.mjs",
    `--rankings=${path.join(modelDir, "rankings.json")}`,
    `--out=${diagnosticsPath}`,
    `--markdown-out=${diagnosticsMarkdownPath}`,
  ]);
  await runNode([
    "scripts/assert-rankings.mjs",
    `--rankings=${path.join(modelDir, "rankings.json")}`,
    `--assertions=${args.assertionsPath}`,
    `--out=${assertionsPath}`,
    "--no-fail",
  ]);
  await runNode([
    "scripts/score-bands.mjs",
    `--rankings=${path.join(modelDir, "rankings.json")}`,
    `--diagnostics=${diagnosticsPath}`,
    `--out=${scoreBandsPath}`,
    `--markdown-out=${scoreBandsMarkdownPath}`,
    `--rank-limit=${args.rankLimit}`,
  ]);

  const [rankings, audit, backtest, diagnostics, assertions, scoreBands] = await Promise.all([
    readJson(path.join(modelDir, "rankings.json")),
    readJson(auditPath),
    readJson(backtestPath),
    readJson(diagnosticsPath),
    readJson(assertionsPath),
    readJson(scoreBandsPath),
  ]);

  return {
    preset,
    output_dir: path.relative(process.cwd(), presetDir),
    rankings,
    audit,
    backtest,
    diagnostics,
    assertions,
    scoreBands,
    metrics: summarizeRun({ audit, backtest, diagnostics, assertions, scoreBands }),
  };
}

function buildComparisonReport({ baseline, candidate, args, runRoot }) {
  const rankMoves = compareRankings({ baseline, candidate, rankLimit: args.rankLimit });
  const metricComparison = compareMetrics(baseline.metrics, candidate.metrics);
  const riskFlags = buildRiskFlags({ candidate, rankMoves, metricComparison });
  const recommendation = buildRecommendation({ metricComparison, riskFlags, candidate });

  return {
    generated_at: new Date().toISOString(),
    since: args.since,
    rank_limit: args.rankLimit,
    run_root: path.relative(process.cwd(), runRoot),
    baseline: buildRunSummary(baseline),
    candidate: buildRunSummary(candidate),
    recommendation,
    metrics: metricComparison,
    risk_flags: riskFlags,
    rank_moves: rankMoves,
    biggest_risers: rankMoves
      .filter((move) => Number.isFinite(move.rank_delta) && move.rank_delta > 0)
      .sort((a, b) => b.rank_delta - a.rank_delta || b.score_delta - a.score_delta)
      .slice(0, 30),
    biggest_fallers: rankMoves
      .filter((move) => Number.isFinite(move.rank_delta) && move.rank_delta < 0)
      .sort((a, b) => a.rank_delta - b.rank_delta || a.score_delta - b.score_delta)
      .slice(0, 30),
    new_ranked: rankMoves.filter((move) => move.movement === "new").slice(0, 30),
    removed_ranked: rankMoves.filter((move) => move.movement === "removed").slice(0, 30),
    division_changes: buildDivisionChanges(rankMoves),
  };
}

function summarizeRun({ audit, backtest, diagnostics, assertions, scoreBands }) {
  const auditSummary = audit.summary ?? {};
  const diagnosticsSummary = diagnostics.summary ?? {};
  const scoreBandSummary = scoreBands.summary ?? {};
  const contextBuckets = new Map((backtest.fight_context_buckets ?? []).map((bucket) => [bucket.bucket, bucket]));
  return {
    backtest_validation_score: num(backtest.summary?.validation_score),
    backtest_accuracy: num(backtest.summary?.accuracy),
    backtest_brier_score: num(backtest.summary?.brier_score),
    backtest_log_loss: num(backtest.summary?.log_loss),
    backtest_calibration_error: num(backtest.summary?.calibration_error),
    backtest_fights: num(backtest.summary?.fights),
    ranked_proxy_accuracy: num(contextBuckets.get("ranked_rating_proxy")?.accuracy),
    elite_proxy_accuracy: num(contextBuckets.get("elite_rating_proxy")?.accuracy),
    title_context_accuracy: num(contextBuckets.get("title_context_win_sample")?.accuracy),
    title_context_fight_accuracy: num(contextBuckets.get("title_context_fight")?.accuracy),
    hard_audit_failures:
      num(auditSummary.champion_failures) +
      num(auditSummary.title_context_failures) +
      num(auditSummary.recent_head_to_head_violations) +
      num(auditSummary.elite_snapshot_drift) +
      num(auditSummary.data_quality_flags),
    soft_audit_flags:
      num(auditSummary.inactive_top_ranked) +
      num(auditSummary.prospect_overboost) +
      num(auditSummary.old_opponent_overcredit),
    large_policy_adjustments: num(auditSummary.large_policy_adjustments),
    bias_flags: num(diagnosticsSummary.bias_flags),
    fragile_fighters: num(diagnosticsSummary.fragile_fighters),
    max_rank_move: num(diagnosticsSummary.max_rank_move),
    assertion_failures: num(assertions.failed),
    assertion_passed: num(assertions.passed),
    assertion_total: num(assertions.total),
    virtual_tie_pairs: num(scoreBandSummary.virtual_tie_pairs),
    high_risk_bands: num(scoreBandSummary.high_risk_bands),
  };
}

function compareMetrics(baseline, candidate) {
  return Object.fromEntries(
    Object.keys({ ...baseline, ...candidate }).map((key) => [
      key,
      {
        baseline: baseline[key] ?? 0,
        candidate: candidate[key] ?? 0,
        delta: round(num(candidate[key]) - num(baseline[key]), 4),
      },
    ]),
  );
}

function compareRankings({ baseline, candidate, rankLimit }) {
  const baselineDivisions = new Map((baseline.rankings.divisions ?? []).map((division) => [division.division, division]));
  const candidateDivisions = new Map((candidate.rankings.divisions ?? []).map((division) => [division.division, division]));
  const divisions = [...new Set([...baselineDivisions.keys(), ...candidateDivisions.keys()])].sort();
  const rows = [];

  for (const division of divisions) {
    const baselineRows = rankedByName(baselineDivisions.get(division), rankLimit);
    const candidateRows = rankedByName(candidateDivisions.get(division), rankLimit);
    const names = [...new Set([...baselineRows.keys(), ...candidateRows.keys()])].sort();
    for (const normalizedName of names) {
      const before = baselineRows.get(normalizedName);
      const after = candidateRows.get(normalizedName);
      const rankDelta = before && after ? before.rank - after.rank : null;
      const scoreDelta = before && after ? round(num(after.final_score) - num(before.final_score), 2) : null;
      const movement = !before ? "new" : !after ? "removed" : rankDelta === 0 ? "same" : "moved";
      if (movement === "same" && scoreDelta === 0) continue;
      rows.push({
        division,
        fighter: after?.fighter_name ?? before?.fighter_name ?? "",
        movement,
        baseline_rank: before?.rank ?? null,
        candidate_rank: after?.rank ?? null,
        rank_delta: rankDelta,
        baseline_score: before ? num(before.final_score) : null,
        candidate_score: after ? num(after.final_score) : null,
        score_delta: scoreDelta,
        baseline_confidence: before?.score_confidence ?? "",
        candidate_confidence: after?.score_confidence ?? "",
        candidate_band: after?.score_band_rank_range ?? "",
        candidate_band_risk: after?.score_band_risk ?? "",
      });
    }
  }

  return rows.sort((a, b) => {
    const absRankDelta = Math.abs(num(b.rank_delta)) - Math.abs(num(a.rank_delta));
    if (absRankDelta !== 0) return absRankDelta;
    if (a.division !== b.division) return a.division.localeCompare(b.division);
    return num(a.candidate_rank ?? 999) - num(b.candidate_rank ?? 999);
  });
}

function rankedByName(division, rankLimit) {
  return new Map(
    (division?.rankings ?? [])
      .filter((fighter) => num(fighter.rank) <= rankLimit)
      .map((fighter) => [normalizeName(fighter.fighter_name), fighter]),
  );
}

function buildRiskFlags({ candidate, rankMoves, metricComparison }) {
  const flags = [];

  for (const failure of candidate.assertions.failures ?? []) {
    flags.push({
      severity: "high",
      code: "assertion_failure",
      division: failure.division,
      fighter: failure.fighter,
      detail: failure.detail,
    });
  }

  for (const [key, metric] of Object.entries(metricComparison)) {
    if (["hard_audit_failures", "soft_audit_flags", "assertion_failures"].includes(key) && metric.delta > 0) {
      flags.push({
        severity: "high",
        code: "metric_regression",
        division: "",
        fighter: "",
        detail: `${humanizeKey(key)} worsened from ${metric.baseline} to ${metric.candidate}.`,
      });
    }
  }

  for (const move of rankMoves) {
    if (move.candidate_rank && move.candidate_rank <= 5 && (move.movement === "new" || num(move.rank_delta) >= 3)) {
      flags.push({
        severity: "medium",
        code: "top5_large_move",
        division: move.division,
        fighter: move.fighter,
        detail: `Candidate places ${move.fighter} at #${move.candidate_rank}; baseline rank was ${move.baseline_rank ?? "unranked"}.`,
      });
    }
    if (move.candidate_rank && move.candidate_rank <= 10 && move.candidate_band_risk === "high" && Math.abs(num(move.rank_delta)) >= 2) {
      flags.push({
        severity: "medium",
        code: "high_risk_band_move",
        division: move.division,
        fighter: move.fighter,
        detail: `${move.fighter} moved ${signed(move.rank_delta)} ranks inside high-risk band ${move.candidate_band}.`,
      });
    }
  }

  return flags.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function buildRecommendation({ metricComparison, riskFlags, candidate }) {
  const highRisk = riskFlags.some((flag) => flag.severity === "high");
  const accuracyDelta = metricComparison.backtest_accuracy?.delta ?? 0;
  const validationDelta = metricComparison.backtest_validation_score?.delta ?? 0;
  const hardDelta = metricComparison.hard_audit_failures?.delta ?? 0;
  const assertionDelta = metricComparison.assertion_failures?.delta ?? 0;

  if (highRisk || hardDelta > 0 || assertionDelta > 0) {
    return {
      status: "do_not_promote_yet",
      detail: "Candidate creates a high-risk validation or assertion regression.",
    };
  }
  if ((accuracyDelta > 0 || validationDelta > 1) && candidate.metrics.assertion_failures === 0) {
    return {
      status: "candidate_can_be_promoted_after_review",
      detail: "Candidate improves validation with no assertion failures; review rank movement before making it default.",
    };
  }
  if (accuracyDelta === 0 && validationDelta >= 0 && candidate.metrics.assertion_failures === 0) {
    return {
      status: "candidate_is_safe_but_not_clearly_better",
      detail: "Candidate preserves constraints, but predictive validation is not clearly better. Promote only if rank movement is more plausible.",
    };
  }
  return {
    status: "candidate_not_better",
    detail: "Candidate does not improve validation enough to justify changing defaults.",
  };
}

function buildRunSummary(run) {
  return {
    name: run.preset.name,
    config: {
      weights: run.preset.weights,
      cli: run.preset.cli,
    },
    output_dir: run.output_dir,
    model_version: run.rankings.model_version,
    rankings_as_of: run.rankings.as_of,
    metrics: run.metrics,
  };
}

function buildDivisionChanges(rankMoves) {
  const byDivision = groupBy(rankMoves, (move) => move.division);
  return [...byDivision.entries()].map(([division, rows]) => {
    const rankMovesOnly = rows.filter((move) => move.movement !== "same");
    return {
      division,
      changed_fighters: rankMovesOnly.length,
      top_moves: rankMovesOnly
        .sort((a, b) => Math.abs(num(b.rank_delta)) - Math.abs(num(a.rank_delta)))
        .slice(0, 15),
    };
  });
}

function buildMarkdownReport(report) {
  const metricRows = Object.entries(report.metrics).map(([metric, row]) => [
    humanizeKey(metric),
    formatMetric(metric, row.baseline),
    formatMetric(metric, row.candidate),
    formatMetric(metric, row.delta, true),
  ]);
  const riskRows = report.risk_flags.map((flag) => [
    flag.severity,
    flag.code,
    flag.division || "-",
    flag.fighter || "-",
    flag.detail,
  ]);
  const riserRows = report.biggest_risers.slice(0, 20).map(formatMoveRow);
  const fallerRows = report.biggest_fallers.slice(0, 20).map(formatMoveRow);
  const newRows = report.new_ranked.slice(0, 20).map(formatMoveRow);
  const removedRows = report.removed_ranked.slice(0, 20).map(formatMoveRow);
  const divisionRows = report.division_changes.map((division) => [
    division.division,
    division.changed_fighters,
    division.top_moves
      .slice(0, 6)
      .map((move) => `${move.fighter}: ${move.baseline_rank ?? "-"} -> ${move.candidate_rank ?? "-"}`)
      .join(", "),
  ]);

  return [
    "# OctagonRank Model Comparison",
    "",
    `Generated at: \`${report.generated_at}\``,
    `Baseline: \`${report.baseline.name}\``,
    `Candidate: \`${report.candidate.name}\``,
    `Backtest since: \`${report.since}\``,
    `Recommendation: \`${report.recommendation.status}\``,
    "",
    report.recommendation.detail,
    "",
    markdownTable("## Metric Comparison", ["Metric", "Baseline", "Candidate", "Delta"], metricRows, "No metrics."),
    "",
    markdownTable("## Risk Flags", ["Severity", "Code", "Division", "Fighter", "Detail"], riskRows, "No risk flags."),
    "",
    markdownTable("## Biggest Risers", moveHeaders(), riserRows, "No risers."),
    "",
    markdownTable("## Biggest Fallers", moveHeaders(), fallerRows, "No fallers."),
    "",
    markdownTable("## New Ranked", moveHeaders(), newRows, "No new ranked fighters."),
    "",
    markdownTable("## Removed Ranked", moveHeaders(), removedRows, "No removed ranked fighters."),
    "",
    markdownTable("## Division Change Summary", ["Division", "Changed Fighters", "Largest Moves"], divisionRows, "No division changes."),
    "",
  ].join("\n");
}

function formatMoveRow(move) {
  return [
    move.division,
    move.fighter,
    move.movement,
    move.baseline_rank ?? "-",
    move.candidate_rank ?? "-",
    move.rank_delta === null ? "-" : signed(move.rank_delta),
    move.score_delta === null ? "-" : signed(move.score_delta),
    move.candidate_confidence || "-",
    move.candidate_band || "-",
  ];
}

function moveHeaders() {
  return ["Division", "Fighter", "Movement", "Baseline Rank", "Candidate Rank", "Rank Delta", "Score Delta", "Confidence", "Band"];
}

function buildCliArgs(cli = {}) {
  const args = [];
  if (cli.kFactor !== undefined) args.push(`--k-factor=${cli.kFactor}`);
  if (cli.activeWindowMonths !== undefined) args.push(`--active-window-months=${cli.activeWindowMonths}`);
  if (cli.minDivisionFights !== undefined) args.push(`--min-division-fights=${cli.minDivisionFights}`);
  return args;
}

function getPreset(name) {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Unknown preset "${name}". Available presets: ${Object.keys(PRESETS).join(", ")}`);
  }
  return preset;
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--markdown-out=")) {
      args.markdownOutPath = arg.slice("--markdown-out=".length);
    } else if (arg.startsWith("--run-root=")) {
      args.runRoot = arg.slice("--run-root=".length);
    } else if (arg.startsWith("--baseline=")) {
      args.baseline = arg.slice("--baseline=".length);
    } else if (arg.startsWith("--candidate=")) {
      args.candidate = arg.slice("--candidate=".length);
    } else if (arg.startsWith("--since=")) {
      args.since = arg.slice("--since=".length);
    } else if (arg.startsWith("--rank-limit=")) {
      args.rankLimit = Number(arg.slice("--rank-limit=".length));
    } else if (arg.startsWith("--assertions=")) {
      args.assertionsPath = arg.slice("--assertions=".length);
    } else if (arg === "--no-keep-runs") {
      args.keepRuns = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.rankLimit) || args.rankLimit < 2) {
    throw new Error("--rank-limit must be an integer of at least 2.");
  }
  return args;
}

function printHelp() {
  console.log(`Compare two OctagonRank model presets.

Usage:
  npm run model:compare
  node scripts/compare-model-runs.mjs --baseline=baseline --candidate=more_recent_form

Options:
  --out=PATH            Comparison JSON output path.
  --markdown-out=PATH   Comparison Markdown output path.
  --run-root=PATH       Directory for generated comparison runs.
  --baseline=NAME       Baseline preset name.
  --candidate=NAME      Candidate preset name.
  --since=YYYY-MM-DD    Backtest start date.
  --rank-limit=N        Top-N ranking rows to compare per division.
  --assertions=PATH     Ranking assertion file.
  --no-keep-runs        Remove per-model run directories after writing the report.

Available presets:
  ${Object.keys(PRESETS).join(", ")}
`);
}

function printSummary(report, args) {
  console.log(`Wrote model comparison to ${args.outPath}`);
  console.log(`Wrote model comparison review to ${args.markdownOutPath}`);
  console.log(`recommendation: ${report.recommendation.status}`);
  console.log(`validation delta: ${formatMetric("backtest_validation_score", report.metrics.backtest_validation_score.delta, true)}`);
  console.log(`accuracy delta: ${formatMetric("backtest_accuracy", report.metrics.backtest_accuracy.delta, true)}`);
  console.log(`assertion failures: ${report.candidate.metrics.assertion_failures}`);
  console.log(`risk flags: ${report.risk_flags.length}`);
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

function groupBy(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
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

function formatMetric(metric, value, forceSigned = false) {
  if (metric === "backtest_accuracy") {
    const formatted = `${(num(value) * 100).toFixed(2)}%`;
    return forceSigned && num(value) > 0 ? `+${formatted}` : formatted;
  }
  if (metric.endsWith("_accuracy") || metric === "backtest_calibration_error") {
    const formatted = `${(num(value) * 100).toFixed(2)}%`;
    return forceSigned && num(value) > 0 ? `+${formatted}` : formatted;
  }
  if (forceSigned) return signed(value);
  return Number.isInteger(num(value)) ? String(num(value)) : num(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function signed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  const formatted = Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${parsed >= 0 ? "+" : ""}${formatted}`;
}

function severityRank(severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;
  return 0;
}

function humanizeKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
