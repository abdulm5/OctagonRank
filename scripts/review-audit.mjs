#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  auditPath: "data/model/audit.json",
  diagnosticsPath: "data/model/diagnostics.json",
  scoreBandsPath: "data/model/score-bands.json",
  outPath: "data/model/audit-review.md",
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

  const [rankings, audit, diagnostics, scoreBands] = await Promise.all([
    readJson(path.resolve(process.cwd(), args.rankingsPath)),
    readJson(path.resolve(process.cwd(), args.auditPath)),
    readOptionalJson(path.resolve(process.cwd(), args.diagnosticsPath), null),
    readOptionalJson(path.resolve(process.cwd(), args.scoreBandsPath), null),
  ]);

  const review = buildReview({ rankings, audit, diagnostics, scoreBands });
  const outputPath = path.resolve(process.cwd(), args.outPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, review);

  printSummary({ audit, diagnostics, scoreBands, outPath: args.outPath });
}

function buildReview({ rankings, audit, diagnostics, scoreBands }) {
  const sections = [
    "# OctagonRank Audit Review",
    metadataSection({ rankings, audit, diagnostics, scoreBands }),
    summarySection(audit),
    divisionReviewSection(rankings),
    flaggedIssuesSection(audit),
    diagnosticsSection(diagnostics),
    scoreBandsSection(scoreBands),
    nextTuningSection(audit, diagnostics, scoreBands),
  ];

  return `${sections.join("\n\n")}\n`;
}

function metadataSection({ rankings, audit, diagnostics, scoreBands }) {
  return [
    "## Run Metadata",
    "",
    `- Model version: \`${rankings.model_version ?? audit.model_version ?? "unknown"}\``,
    `- Rankings as of: \`${rankings.as_of ?? audit.as_of ?? "unknown"}\``,
    `- Audit generated at: \`${audit.generated_at ?? "unknown"}\``,
    `- Diagnostics generated at: \`${diagnostics?.generated_at ?? "not loaded"}\``,
    `- Score bands generated at: \`${scoreBands?.generated_at ?? "not loaded"}\``,
    `- Review generated at: \`${new Date().toISOString()}\``,
  ].join("\n");
}

function summarySection(audit) {
  const rows = Object.entries(audit.summary ?? {}).map(([check, count]) => [
    humanizeKey(check),
    String(count),
    severityFor(check, count),
  ]);

  return markdownTable("## Audit Summary", ["Check", "Count", "Severity"], rows);
}

function divisionReviewSection(rankings) {
  const divisionSections = rankings.divisions.map((division) => {
    const rows = (division.rankings ?? []).slice(0, 15).map((fighter) => [
      String(fighter.rank),
      fighter.fighter_name,
      fmt(fighter.final_score),
      fmt(fighter.model_score),
      fmtSigned(totalPolicyAdjustment(fighter)),
      buildFlags(fighter),
      explainFighter(fighter),
    ]);

    return markdownTable(
      `### ${division.division}`,
      ["Rank", "Fighter", "Final", "Model", "Policy", "Flags", "Why"],
      rows,
    );
  });

  return ["## Division Review", ...divisionSections].join("\n\n");
}

function flaggedIssuesSection(audit) {
  const checks = audit.checks ?? {};
  const sections = [
    issueTable(
      "## Champion Placement",
      (checks.champion ?? []).filter((row) => !row.pass),
      ["Division", "Expected Champion", "Actual Rank 1"],
      (row) => [row.division, row.expected_champion, row.actual_rank_1],
      "All champions are ranked first.",
    ),
    issueTable(
      "## Title Context Failures",
      (checks.title_context ?? []).filter((row) => !row.pass),
      ["Division", "Fighter", "Tag", "Target Rank", "Actual Rank"],
      (row) => [row.division, row.fighter, row.tag, row.max_overall_rank, row.actual_rank ?? "missing"],
      "All title-context entries meet their target rank.",
    ),
    issueTable(
      "## Recent Head-to-Head Violations",
      checks.recent_head_to_head ?? [],
      ["Division", "Date", "Winner", "Winner Rank", "Loser", "Loser Rank", "Method"],
      (row) => [row.division, row.fight_date, row.winner, row.winner_rank, row.loser, row.loser_rank, row.method],
      "No recent head-to-head violations.",
    ),
    issueTable(
      "## Elite Snapshot Drift",
      checks.elite_snapshot_drift ?? [],
      ["Division", "Fighter", "Snapshot", "Actual Rank", "Expected Max", "Title Context", "Rank Guard"],
      (row) => [
        row.division,
        row.fighter,
        row.current_status,
        row.actual_rank,
        row.max_expected_rank,
        row.title_context_status || "none",
        row.rank_guard_status || "none",
      ],
      "No elite snapshot drift flags.",
    ),
    issueTable(
      "## Justified Elite Snapshot Drift",
      checks.justified_elite_snapshot_drift ?? [],
      ["Division", "Fighter", "Snapshot", "Actual Rank", "Expected Max", "Reason"],
      (row) => [
        row.division,
        row.fighter,
        row.current_status,
        row.actual_rank,
        row.max_expected_rank,
        row.justification,
      ],
      "No justified elite snapshot drift cases.",
    ),
    issueTable(
      "## Inactive Top-Ranked Fighters",
      checks.inactive_top_ranked ?? [],
      ["Division", "Rank", "Fighter", "Months Inactive"],
      (row) => [row.division, row.rank, row.fighter, fmt(row.months_inactive)],
      "No top-ranked inactivity flags.",
    ),
    issueTable(
      "## Prospect Overboost Flags",
      checks.prospect_overboost ?? [],
      ["Division", "Rank", "Fighter", "Division Fights", "Entry Gate", "Penalty"],
      (row) => [
        row.division,
        row.rank,
        row.fighter,
        row.ufc_division_fights,
        row.entry_gate_status || "none",
        fmt(row.entry_gate_penalty),
      ],
      "No low-sample overboost flags.",
    ),
    issueTable(
      "## Old Opponent Over-Credit Flags",
      checks.old_opponent_overcredit ?? [],
      ["Division", "Rank", "Fighter", "Best Win", "Opp Age", "Opp Form", "Quality Bonus"],
      (row) => [
        row.division,
        row.rank,
        row.fighter,
        row.best_win,
        fmt(row.opponent_age_at_fight),
        fmt(row.opponent_form_score),
        fmt(row.quality_win_adjustment),
      ],
      "No old-opponent over-credit flags.",
    ),
    issueTable(
      "## Large Rescue Policy Adjustments",
      checks.large_policy_adjustments ?? [],
      ["Division", "Rank", "Fighter", "Rescue Total", "Primary", "Title", "Rank Guard", "H2H", "Snapshot", "Title Guard", "Entry Gate"],
      (row) => [
        row.division,
        row.rank,
        row.fighter,
        fmtSigned(row.rescue_policy_adjustment),
        humanizeKey(row.primary_large_component || "combined_rescue_policy"),
        fmtSigned(row.title_context_adjustment),
        fmtSigned(row.rank_guard_adjustment),
        fmtSigned(row.head_to_head_adjustment),
        fmtSigned(row.snapshot_order_adjustment),
        fmtSigned(row.title_guard_adjustment),
        fmtSigned(row.entry_gate_penalty),
      ],
      "No large rescue policy adjustments.",
    ),
    issueTable(
      "## Large Baseline Context Priors",
      checks.large_baseline_policy_adjustments ?? [],
      ["Division", "Rank", "Fighter", "Context Prior", "Current Adjustment"],
      (row) => [
        row.division,
        row.rank,
        row.fighter,
        fmtSigned(row.current_context_prior),
        fmtSigned(row.current_context_adjustment),
      ],
      "No large baseline context priors.",
    ),
    issueTable(
      "## Data Quality Flags",
      checks.data_quality ?? [],
      ["Type", "Division", "Fighter", "Detail"],
      (row) => [row.type, row.division, row.fighter, row.detail],
      "No data-quality flags.",
    ),
  ];

  return sections.join("\n\n");
}

function diagnosticsSection(diagnostics) {
  if (!diagnostics) {
    return [
      "## Diagnostics Review",
      "",
      "Diagnostics were not loaded. Run `npm run model:diagnostics` before `npm run model:review` for bias and fragility names.",
    ].join("\n");
  }

  const summary = diagnostics.summary ?? {};
  const summaryRows = [
    ["Ranked fighters", summary.ranked_fighters ?? 0, "info"],
    ["Bias flags", summary.bias_flags ?? 0, severityForDiagnostic("bias_flags", summary.bias_flags)],
    ["Fragile fighters", summary.fragile_fighters ?? 0, severityForDiagnostic("fragile_fighters", summary.fragile_fighters)],
    ["Max rank move", summary.max_rank_move ?? 0, severityForDiagnostic("max_rank_move", summary.max_rank_move)],
    ["Most sensitive component", summary.most_sensitive_component || "none", "review"],
  ];

  const groupByLabel = new Map((diagnostics.bias_groups ?? []).map((group) => [group.label, group]));
  const biasRows = (diagnostics.bias_flags ?? []).map((flag) => {
    const examples = (groupByLabel.get(flag.group)?.notable_examples ?? [])
      .slice(0, 4)
      .map((example) => `${example.fighter} (${example.division} #${example.rank})`)
      .join(", ");
    return [flag.severity, flag.group, flag.type, flag.detail, examples || "-"];
  });

  const fragileRows = (diagnostics.sensitivity?.fighter_sensitivity ?? [])
    .filter((row) => num(row.max_abs_rank_move) >= 3)
    .slice(0, 15)
    .map((row) => [
      row.division,
      row.fighter,
      row.max_abs_rank_move,
      row.tests_moved_2plus,
      row.tests_moved_3plus,
      row.worst_case ? `${row.worst_case.component} ${row.worst_case.direction}` : "-",
      row.worst_case ? `${row.worst_case.old_rank} -> ${row.worst_case.new_rank}` : "-",
    ]);

  const componentRows = (diagnostics.sensitivity?.component_tests ?? [])
    .slice()
    .sort((a, b) => b.unstable_count_3plus - a.unstable_count_3plus || b.max_abs_rank_move - a.max_abs_rank_move)
    .slice(0, 10)
    .map((test) => [
      test.label,
      test.direction,
      test.type,
      fmt(test.avg_abs_rank_move),
      test.max_abs_rank_move,
      test.unstable_count_3plus,
      (test.biggest_movers ?? [])
        .slice(0, 3)
        .map((move) => `${move.fighter} ${move.old_rank}->${move.new_rank}`)
        .join(", ") || "-",
    ]);

  return [
    markdownTable("## Diagnostics Summary", ["Signal", "Value", "Severity"], summaryRows),
    issueTable(
      "## Diagnostic Bias Flags",
      biasRows,
      ["Severity", "Group", "Type", "Detail", "Example Fighters"],
      (row) => row,
      "No diagnostic bias flags crossed thresholds.",
    ),
    issueTable(
      "## Fragile Fighters",
      fragileRows,
      ["Division", "Fighter", "Max Move", "2+ Move Tests", "3+ Move Tests", "Worst Component", "Worst Rank Change"],
      (row) => row,
      "No fighter moved 3+ spots under local sensitivity checks.",
    ),
    issueTable(
      "## Most Sensitive Score Components",
      componentRows,
      ["Component", "Direction", "Type", "Avg Move", "Max Move", "3+ Movers", "Largest Movers"],
      (row) => row,
      "No score component produced meaningful rank movement.",
    ),
  ].join("\n\n");
}

function scoreBandsSection(scoreBands) {
  if (!scoreBands) {
    return [
      "## Score-Band Review",
      "",
      "Score bands were not loaded. Run `npm run model:bands` before `npm run model:review` for close-score clusters.",
    ].join("\n");
  }

  const summaryRows = Object.entries(scoreBands.summary ?? {}).map(([check, count]) => [
    humanizeKey(check),
    String(count),
    severityForScoreBand(check, count),
  ]);
  const bandRows = (scoreBands.most_uncertain_bands ?? []).slice(0, 15).map((band) => [
    band.risk,
    band.division,
    band.rank_range,
    (band.fighters ?? []).map((fighter) => `${fighter.rank}. ${fighter.fighter}`).join(", "),
    fmt(band.score_spread),
    fmt(band.max_adjacent_gap),
    band.max_sensitivity_move,
    band.interpretation,
  ]);
  const fighterRows = (scoreBands.most_uncertain_fighters ?? []).slice(0, 15).map((fighter) => [
    fighter.uncertainty,
    fighter.division,
    fighter.rank,
    fighter.fighter,
    fmt(fighter.nearest_gap),
    fighter.gap_above === null ? "-" : fmt(fighter.gap_above),
    fighter.gap_below === null ? "-" : fmt(fighter.gap_below),
    fighter.max_sensitivity_move,
    fighter.worst_sensitivity_component || "-",
  ]);

  return [
    markdownTable("## Score-Band Summary", ["Signal", "Value", "Severity"], summaryRows),
    issueTable(
      "## Most Uncertain Score Bands",
      bandRows,
      ["Risk", "Division", "Ranks", "Fighters", "Spread", "Max Adj Gap", "Max Sensitivity", "Interpretation"],
      (row) => row,
      "No close-score bands detected.",
    ),
    issueTable(
      "## Most Uncertain Score-Band Fighters",
      fighterRows,
      ["Uncertainty", "Division", "Rank", "Fighter", "Nearest Gap", "Gap Above", "Gap Below", "Max Sensitivity", "Worst Component"],
      (row) => row,
      "No uncertain score-band fighters detected.",
    ),
  ].join("\n\n");
}

function nextTuningSection(audit, diagnostics, scoreBands) {
  const items = [];
  const summary = audit.summary ?? {};
  const diagnosticSummary = diagnostics?.summary ?? {};
  const scoreBandSummary = scoreBands?.summary ?? {};
  if (num(summary.recent_head_to_head_violations) > 0) {
    items.push("Review the remaining head-to-head flags first. These usually show where the resolver is too narrow or where a post-fight loss should matter more.");
  }
  if (num(summary.elite_snapshot_drift) > 0) {
    items.push("Review elite snapshot drift flags; these usually mean a recent champion, title loser, or top contender is missing title-lineage context or has an overly capped rank guard.");
  }
  if (num(summary.justified_elite_snapshot_drift) > 0) {
    items.push("Review justified elite snapshot drift only if the explanation looks too harsh; these are top snapshot fighters the model deliberately moved down due to losses, weak schedule, or legacy decay.");
  }
  if (num(summary.prospect_overboost) > 0) {
    items.push("Tune the entry-gate rule so low-sample fighters need either a ranked win, multiple quality wins, or a very strong adjusted best win.");
  }
  if (num(summary.old_opponent_overcredit) > 0) {
    items.push("Tighten best-win credit when the opponent is older and entering with weak recent form.");
  }
  if (num(summary.inactive_top_ranked) > 0) {
    items.push("Separate legitimate inactivity from ranking decay by adding a tiny source-backed layoff context file later.");
  }
  if (num(summary.large_policy_adjustments) > 0) {
    items.push("Audit large rescue policy adjustments so the resume story stays honest: model score and ranking policy should remain visibly separate.");
  }
  if (num(summary.large_baseline_policy_adjustments) > 0) {
    items.push("Review large baseline context priors only as explainability checks; these are expected champion/current-snapshot priors, not tuning failures.");
  }
  if (num(summary.data_quality_flags) > 0) {
    items.push("Fix data-quality flags before formula tuning; duplicated snapshot entries and unexplained division transfers can create fake ranking problems.");
  }
  if (num(diagnosticSummary.fragile_fighters) > 0) {
    items.push("Review fragile fighters next; these are rankings where a small component change moves a fighter three or more spots.");
  }
  if (num(diagnosticSummary.bias_flags) > 0) {
    items.push("Review diagnostic bias groups before broad weight tuning so the model does not overfit to snapshot, title-context, or schedule-strength policy.");
  }
  if (num(scoreBandSummary.high_risk_bands) > 0) {
    items.push("Treat high-risk score bands as uncertainty zones; tune only when a fighter looks wrong outside a close-score cluster.");
  }

  if (items.length === 0) {
    items.push("No major audit flags remain. The next useful step is historical backtesting against old official rankings.");
  }

  return ["## Suggested Next Tuning Pass", "", ...items.map((item) => `- ${item}`)].join("\n");
}

function issueTable(title, rows, headers, rowMapper, emptyText) {
  if (!rows.length) {
    return [title, "", emptyText].join("\n");
  }

  return markdownTable(title, headers, rows.map(rowMapper));
}

function markdownTable(title, headers, rows) {
  const headerLine = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`);
  return [title, "", headerLine, separatorLine, ...rowLines].join("\n");
}

function buildFlags(fighter) {
  const flags = [];
  if (fighter.current_status === "Champion") flags.push("champion");
  if (fighter.title_context_status) flags.push(fighter.title_context_status);
  if (fighter.division_context_status) flags.push(fighter.division_context_status);
  if (fighter.entry_gate_status) flags.push(fighter.entry_gate_status);
  if (Math.abs(num(fighter.head_to_head_adjustment)) > 0) flags.push(`h2h ${fmtSigned(fighter.head_to_head_adjustment)}`);
  if (Math.abs(num(fighter.rank_guard_adjustment)) > 0) {
    const confidence = fighter.rank_guard_confidence ? ` @${fmt(fighter.rank_guard_confidence)}` : "";
    flags.push(`guard ${fmtSigned(fighter.rank_guard_adjustment)}${confidence}`);
  }
  if (Math.abs(num(fighter.title_guard_adjustment)) > 0) flags.push(`title guard ${fmtSigned(fighter.title_guard_adjustment)}`);
  if (num(fighter.months_inactive) > 18) flags.push(`${fmt(fighter.months_inactive)} months inactive`);
  if (num(fighter.ufc_division_fights) < 4 && fighter.current_status !== "Champion") flags.push("thin sample");
  return flags.join(", ") || "-";
}

function explainFighter(fighter) {
  const reasons = [];

  if (fighter.current_status === "Champion") {
    reasons.push("champion policy keeps them first");
  }
  if (fighter.division_context_status) {
    reasons.push(`division context: ${fighter.division_context_status}`);
  }
  if (num(fighter.current_division_overlay_adjustment) !== 0) {
    reasons.push(`new-division results ${fmtSigned(fighter.current_division_overlay_adjustment)}`);
  }
  if (num(fighter.base_rating) >= 1600) {
    reasons.push(`strong base rating ${fmt(fighter.base_rating)}`);
  }
  if (num(fighter.recent_form_adjustment) >= 25) {
    reasons.push(`recent form ${fmtSigned(fighter.recent_form_adjustment)} (${fighter.recent_record_30m || "recent run"})`);
  } else if (num(fighter.recent_form_adjustment) <= -20) {
    reasons.push(`recent form drag ${fmtSigned(fighter.recent_form_adjustment)}`);
  }
  if (num(fighter.recent_outcome_adjustment) <= -4) {
    reasons.push(`latest result ${fmtSigned(fighter.recent_outcome_adjustment)}`);
  }
  if (num(fighter.schedule_strength_adjustment) <= -5) {
    reasons.push(`schedule strength ${fmtSigned(fighter.schedule_strength_adjustment)} (${fighter.schedule_strength_status})`);
  } else if (num(fighter.schedule_strength_adjustment) >= 4) {
    reasons.push(`strong schedule ${fmtSigned(fighter.schedule_strength_adjustment)}`);
  }
  if (num(fighter.dominant_wins_last_5) >= 2) {
    reasons.push(`${fighter.dominant_wins_last_5} dominant recent wins`);
  }
  if (num(fighter.recent_activity_adjustment) >= 10) {
    reasons.push(`activity ${fmtSigned(fighter.recent_activity_adjustment)}`);
  }
  if (num(fighter.title_win_adjustment) > 0) {
    reasons.push(`title-lineage win ${fmtSigned(fighter.title_win_adjustment)}`);
  }
  if (num(fighter.elite_resume_adjustment) >= 6) {
    reasons.push(`elite resume ${fmtSigned(fighter.elite_resume_adjustment)} (${fighter.elite_resume_tier || "resume"})`);
  }
  if (num(fighter.quality_win_adjustment) >= 15 && fighter.best_win?.opponent_name) {
    reasons.push(`best win ${fighter.best_win.opponent_name} (+${fmt(fighter.quality_win_adjustment)})`);
  }
  if (num(fighter.finish_adjustment) >= 8) {
    reasons.push(`finish bonus ${fmtSigned(fighter.finish_adjustment)}`);
  }
  if (num(fighter.dominance_adjustment) >= 8) {
    reasons.push(`dominance ${fmtSigned(fighter.dominance_adjustment)}`);
  }
  if (Math.abs(num(fighter.round_dominance_adjustment)) >= 4) {
    reasons.push(`round profile ${fmtSigned(fighter.round_dominance_adjustment)}`);
  }
  if (num(fighter.inactivity_penalty) > 0) {
    reasons.push(`inactivity -${fmt(fighter.inactivity_penalty)}`);
  }
  if (num(fighter.legacy_penalty) > 0) {
    reasons.push(`legacy decay -${fmt(fighter.legacy_penalty)}`);
  }
  if (num(fighter.entry_gate_penalty) > 0) {
    reasons.push(`entry gate -${fmt(fighter.entry_gate_penalty)}`);
  }
  if (num(fighter.title_context_adjustment) > 0) {
    reasons.push(`title context ${fmtSigned(fighter.title_context_adjustment)}`);
  }
  if (num(fighter.head_to_head_adjustment) !== 0) {
    reasons.push(`head-to-head policy ${fmtSigned(fighter.head_to_head_adjustment)}`);
  }
  if (num(fighter.rank_guard_adjustment) !== 0) {
    const confidence = fighter.rank_guard_confidence ? ` confidence ${fmt(fighter.rank_guard_confidence)}` : "";
    reasons.push(`rank guard ${fmtSigned(fighter.rank_guard_adjustment)}${confidence}`);
  }
  if (num(fighter.current_context_adjustment) >= 50) {
    reasons.push(`current snapshot prior ${fmtSigned(fighter.current_context_adjustment)}`);
  }

  if (fighter.best_win?.opponent_context_reasons?.length) {
    reasons.push(`best-win context: ${fighter.best_win.opponent_context_reasons.join(", ")}`);
  }

  return reasons.slice(0, 4).join("; ") || "balanced score without one dominant signal";
}

function totalPolicyAdjustment(fighter) {
  return num(fighter.final_score) - num(fighter.model_score);
}

function severityFor(check, count) {
  const value = num(count);
  if (value === 0) return "clear";
  if (check === "champion_failures" || check === "title_context_failures") return "high";
  if (check === "recent_head_to_head_violations" || check === "elite_snapshot_drift" || check === "old_opponent_overcredit") return "medium";
  if (check === "justified_elite_snapshot_drift") return "review";
  if (check === "prospect_overboost" || check === "inactive_top_ranked") return "medium";
  return "review";
}

function severityForDiagnostic(check, count) {
  const value = num(count);
  if (value === 0) return "clear";
  if (check === "fragile_fighters" || check === "bias_flags") return value >= 5 ? "high" : "medium";
  if (check === "max_rank_move") return value >= 4 ? "high" : value >= 2 ? "medium" : "review";
  return "review";
}

function severityForScoreBand(check, count) {
  const value = num(count);
  if (value === 0) return "clear";
  if (check === "high_risk_bands") return value >= 10 ? "high" : "medium";
  if (check === "virtual_tie_pairs" || check === "score_bands") return value >= 25 ? "high" : "review";
  if (check === "fragile_fighters_in_bands") return value > 0 ? "medium" : "clear";
  return "info";
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
    } else if (arg.startsWith("--rankings=")) {
      args.rankingsPath = arg.slice("--rankings=".length);
    } else if (arg.startsWith("--audit=")) {
      args.auditPath = arg.slice("--audit=".length);
    } else if (arg.startsWith("--diagnostics=")) {
      args.diagnosticsPath = arg.slice("--diagnostics=".length);
    } else if (arg.startsWith("--score-bands=")) {
      args.scoreBandsPath = arg.slice("--score-bands=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Generate a human-readable OctagonRank audit review.

Usage:
  npm run model:review
  node scripts/review-audit.mjs --rankings=data/model/rankings.json --audit=data/model/audit.json --diagnostics=data/model/diagnostics.json --score-bands=data/model/score-bands.json --out=data/model/audit-review.md

Options:
  --rankings=PATH     Generated rankings JSON path.
  --audit=PATH        Generated audit JSON path.
  --diagnostics=PATH  Generated diagnostics JSON path.
  --score-bands=PATH  Generated score bands JSON path.
  --out=PATH          Markdown review output path.
`);
}

function printSummary({ audit, diagnostics, scoreBands, outPath }) {
  console.log(`Wrote audit review to ${outPath}`);
  for (const [check, count] of Object.entries(audit.summary ?? {})) {
    console.log(`${check}: ${count}`);
  }
  if (diagnostics?.summary) {
    console.log(`bias_flags: ${diagnostics.summary.bias_flags}`);
    console.log(`fragile_fighters: ${diagnostics.summary.fragile_fighters}`);
    console.log(`max_rank_move: ${diagnostics.summary.max_rank_move}`);
  }
  if (scoreBands?.summary) {
    console.log(`virtual_tie_pairs: ${scoreBands.summary.virtual_tie_pairs}`);
    console.log(`high_risk_bands: ${scoreBands.summary.high_risk_bands}`);
  }
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

function fmt(value) {
  const parsed = num(value);
  if (!Number.isFinite(parsed)) return "";
  if (Number.isInteger(parsed)) return String(parsed);
  return parsed.toFixed(1);
}

function fmtSigned(value) {
  const parsed = num(value);
  if (parsed === 0) return "0";
  return `${parsed > 0 ? "+" : ""}${fmt(parsed)}`;
}

function num(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
