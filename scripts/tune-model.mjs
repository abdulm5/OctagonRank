#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULTS = {
  outPath: "data/model/tuning_report.json",
  markdownOutPath: "data/model/tuning_report.md",
  runRoot: "data/model/tuning_runs",
  assertionsPath: "data/ranking_inputs/model_assertions.json",
  since: "2024-01-01",
  limit: null,
  keepRuns: true,
};

const CANDIDATES = [
  { name: "baseline", weights: {} },
  { name: "lower_k_factor", weights: {}, cli: { kFactor: 30 } },
  { name: "higher_k_factor", weights: {}, cli: { kFactor: 34 } },
  { name: "less_rank_guard", weights: { rank_guard_strength: 0.85 } },
  { name: "more_rank_guard", weights: { rank_guard_strength: 1.12 } },
  { name: "less_elite_resume", weights: { elite_resume: 0.85, opponent_elite_resume: 0.9 } },
  { name: "more_elite_resume", weights: { elite_resume: 1.12, opponent_elite_resume: 1.08 } },
  { name: "less_schedule_strength", weights: { schedule_strength: 0.85 } },
  { name: "more_schedule_strength", weights: { schedule_strength: 1.12 } },
  { name: "less_recent_form", weights: { recent_form: 0.9, recent_outcome: 0.9 } },
  { name: "more_recent_form", weights: { recent_form: 1.1, recent_outcome: 1.05 } },
  { name: "conservative_policy", weights: { current_context_prior: 0.95, rank_guard_strength: 0.85 } },
  { name: "resume_quality_blend", weights: { elite_resume: 1.08, opponent_elite_resume: 1.05, quality_win: 0.95 } },
  { name: "activity_heavier", weights: { recent_activity: 1.1, inactivity_penalty: 1.08 } },
  { name: "less_top_contender_gate", weights: { top_contender_credibility: 0.75 } },
  { name: "more_top_contender_gate", weights: { top_contender_credibility: 1.2 } },
  { name: "less_snapshot_order", weights: { snapshot_order: 0.75 } },
  { name: "more_snapshot_order", weights: { snapshot_order: 1.2 } },
];

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

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.resolve(process.cwd(), args.runRoot, runId);
  const selectedCandidates = CANDIDATES.slice(0, args.limit);
  const results = [];

  await fs.mkdir(runRoot, { recursive: true });
  console.log(`Running ${selectedCandidates.length} tuning candidate(s)...`);

  for (const [index, candidate] of selectedCandidates.entries()) {
    console.log(`[${index + 1}/${selectedCandidates.length}] ${candidate.name}`);
    results.push(await runCandidate({ candidate, runRoot, since: args.since, assertionsInputPath: args.assertionsPath }));
  }

  const rankedResults = results.sort((a, b) => b.score - a.score);
  const report = {
    generated_at: new Date().toISOString(),
    since: args.since,
    run_root: path.relative(process.cwd(), runRoot),
    scoring: {
      higher_is_better: true,
      formula:
        "validation_score - hard_failures*500 - assertion_failures*350 - soft_audit_flags*25 - diagnostics_fragile*10 - diagnostics_bias*5 - max_rank_move*2 - large_policy_adjustments*0.2",
    },
    best_candidate: rankedResults[0],
    candidates: rankedResults,
  };

  const outputPath = path.resolve(process.cwd(), args.outPath);
  const markdownPath = path.resolve(process.cwd(), args.markdownOutPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await Promise.all([
    fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(markdownPath, buildMarkdown(report)),
  ]);

  if (!args.keepRuns) {
    await fs.rm(runRoot, { recursive: true, force: true });
  }

  printSummary(report, args);
}

async function runCandidate({ candidate, runRoot, since, assertionsInputPath }) {
  const candidateDir = path.join(runRoot, candidate.name);
  const modelDir = path.join(candidateDir, "model");
  const configPath = path.join(candidateDir, "model_config.json");
  const auditPath = path.join(candidateDir, "audit.json");
  const backtestPath = path.join(candidateDir, "backtest.json");
  const diagnosticsPath = path.join(candidateDir, "diagnostics.json");
  const diagnosticsMarkdownPath = path.join(candidateDir, "diagnostics.md");
  const assertionsPath = path.join(candidateDir, "assertions.json");

  await fs.mkdir(candidateDir, { recursive: true });
  const config = {
    name: candidate.name,
    weights: candidate.weights,
    cli: candidate.cli ?? {},
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  await runNode([
    "scripts/build-rankings-model.mjs",
    `--out-dir=${modelDir}`,
    `--model-config=${configPath}`,
    ...buildCliArgs(candidate.cli),
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
    `--since=${since}`,
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
    `--assertions=${assertionsInputPath}`,
    `--out=${assertionsPath}`,
    "--no-fail",
  ]);

  const [rankings, audit, backtest, diagnostics, assertions] = await Promise.all([
    readJson(path.join(modelDir, "rankings.json")),
    readJson(auditPath),
    readJson(backtestPath),
    readJson(diagnosticsPath),
    readJson(assertionsPath),
  ]);

  const scoreBreakdown = scoreCandidate({ audit, backtest, diagnostics, assertions });
  return {
    name: candidate.name,
    config,
    score: scoreBreakdown.score,
    score_breakdown: scoreBreakdown,
    model_version: rankings.model_version,
    backtest_accuracy: backtest.summary.accuracy,
    backtest_validation_score: backtest.summary.validation_score,
    backtest_brier_score: backtest.summary.brier_score,
    backtest_log_loss: backtest.summary.log_loss,
    backtest_calibration_error: backtest.summary.calibration_error,
    backtest_correct: backtest.summary.correct,
    backtest_fights: backtest.summary.fights,
    audit_summary: audit.summary,
    diagnostics_summary: diagnostics.summary,
    assertions_summary: {
      total: assertions.total,
      passed: assertions.passed,
      failed: assertions.failed,
    },
    assertion_failures: assertions.failures,
    output_dir: path.relative(process.cwd(), candidateDir),
  };
}

function scoreCandidate({ audit, backtest, diagnostics, assertions }) {
  const auditSummary = audit.summary ?? {};
  const diagnosticsSummary = diagnostics.summary ?? {};
  const hardFailures =
    num(auditSummary.champion_failures) +
    num(auditSummary.title_context_failures) +
    num(auditSummary.recent_head_to_head_violations) +
    num(auditSummary.elite_snapshot_drift) +
    num(auditSummary.data_quality_flags);
  const softAuditFlags =
    num(auditSummary.inactive_top_ranked) +
    num(auditSummary.prospect_overboost) +
    num(auditSummary.old_opponent_overcredit);
  const largePolicyAdjustments = num(auditSummary.large_policy_adjustments);
  const validationPoints = Number.isFinite(Number(backtest.summary?.validation_score))
    ? num(backtest.summary.validation_score)
    : num(backtest.summary?.accuracy) * 1000;
  const hardFailurePenalty = hardFailures * 500;
  const softAuditPenalty = softAuditFlags * 25;
  const fragilePenalty = num(diagnosticsSummary.fragile_fighters) * 10;
  const biasPenalty = num(diagnosticsSummary.bias_flags) * 5;
  const sensitivityPenalty = num(diagnosticsSummary.max_rank_move) * 2;
  const policyPenalty = largePolicyAdjustments * 0.2;
  const assertionFailurePenalty = num(assertions.failed) * 350;

  return {
    score: round(
      validationPoints -
        hardFailurePenalty -
        assertionFailurePenalty -
        softAuditPenalty -
        fragilePenalty -
        biasPenalty -
        sensitivityPenalty -
        policyPenalty,
      2,
    ),
    validation_points: round(validationPoints, 2),
    accuracy_points: round(num(backtest.summary?.accuracy) * 1000, 2),
    brier_score: num(backtest.summary?.brier_score),
    log_loss: num(backtest.summary?.log_loss),
    calibration_error: num(backtest.summary?.calibration_error),
    hard_failures: hardFailures,
    hard_failure_penalty: hardFailurePenalty,
    assertion_failures: num(assertions.failed),
    assertion_failure_penalty: assertionFailurePenalty,
    soft_audit_flags: softAuditFlags,
    soft_audit_penalty: softAuditPenalty,
    fragile_penalty: fragilePenalty,
    bias_penalty: biasPenalty,
    sensitivity_penalty: sensitivityPenalty,
    policy_penalty: round(policyPenalty, 2),
  };
}

function buildCliArgs(cli = {}) {
  const args = [];
  if (cli.kFactor !== undefined) args.push(`--k-factor=${cli.kFactor}`);
  if (cli.activeWindowMonths !== undefined) args.push(`--active-window-months=${cli.activeWindowMonths}`);
  if (cli.minDivisionFights !== undefined) args.push(`--min-division-fights=${cli.minDivisionFights}`);
  return args;
}

function buildMarkdown(report) {
  const rows = report.candidates.map((candidate, index) => [
    String(index + 1),
    candidate.name,
    fmt(candidate.score),
    `${(candidate.backtest_accuracy * 100).toFixed(1)}%`,
    fmt(candidate.backtest_validation_score),
    fmt(candidate.backtest_brier_score),
    fmt(candidate.backtest_calibration_error),
    String(candidate.score_breakdown.hard_failures),
    String(candidate.score_breakdown.assertion_failures),
    String(candidate.score_breakdown.soft_audit_flags),
    String(candidate.diagnostics_summary.bias_flags),
    String(candidate.diagnostics_summary.fragile_fighters),
    candidate.output_dir,
  ]);

  return [
    "# OctagonRank Tuning Report",
    "",
    `Generated at: \`${report.generated_at}\``,
    `Backtest since: \`${report.since}\``,
    `Run root: \`${report.run_root}\``,
    "",
    "## Best Candidate",
    "",
    `\`${report.best_candidate.name}\` scored \`${fmt(report.best_candidate.score)}\` with ${(report.best_candidate.backtest_accuracy * 100).toFixed(1)}% backtest accuracy.`,
    "",
    "## Candidate Results",
    "",
    markdownTable(
      ["Rank", "Candidate", "Score", "Accuracy", "Validation", "Brier", "Calib Err", "Hard Flags", "Constraint Fails", "Soft Flags", "Bias", "Fragile", "Output"],
      rows,
    ),
    "",
    "## Scoring",
    "",
    report.scoring.formula,
    "",
  ].join("\n");
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdown).join(" | ")} |`),
  ].join("\n");
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("|", "\\|");
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
    } else if (arg.startsWith("--assertions=")) {
      args.assertionsPath = arg.slice("--assertions=".length);
    } else if (arg.startsWith("--since=")) {
      args.since = arg.slice("--since=".length);
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--no-keep-runs") {
      args.keepRuns = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.limit === null) {
    args.limit = CANDIDATES.length;
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    throw new Error("--limit must be a positive number.");
  }
  args.limit = Math.min(CANDIDATES.length, Math.floor(args.limit));
  return args;
}

function printHelp() {
  console.log(`Tune OctagonRank model weights against backtest, audit, and diagnostics metrics.

Usage:
  npm run model:tune
  node scripts/tune-model.mjs --limit=8

Options:
  --out=PATH            Tuning JSON output path.
  --markdown-out=PATH   Tuning Markdown output path.
  --run-root=PATH       Directory for candidate run outputs.
  --assertions=PATH     Assertion JSON path used by candidate constraint checks.
  --since=YYYY-MM-DD    Backtest start date.
  --limit=N             Number of predefined candidates to run.
  --no-keep-runs        Remove per-candidate run directories after writing the report.
`);
}

function printSummary(report, args) {
  const best = report.best_candidate;
  console.log(`Wrote tuning report to ${args.outPath}`);
  console.log(`Wrote tuning review to ${args.markdownOutPath}`);
  console.log(`best: ${best.name}`);
  console.log(`score: ${fmt(best.score)}`);
  console.log(`accuracy: ${(best.backtest_accuracy * 100).toFixed(1)}%`);
  console.log(`validation score: ${fmt(best.backtest_validation_score)}`);
  console.log(`hard failures: ${best.score_breakdown.hard_failures}`);
  console.log(`assertion failures: ${best.score_breakdown.assertion_failures}`);
  console.log(`soft audit flags: ${best.score_breakdown.soft_audit_flags}`);
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

function fmt(value) {
  return Number(value).toFixed(2);
}
