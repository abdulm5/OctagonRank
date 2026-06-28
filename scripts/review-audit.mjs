#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  auditPath: "data/model/audit.json",
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

  const [rankings, audit] = await Promise.all([
    readJson(path.resolve(process.cwd(), args.rankingsPath)),
    readJson(path.resolve(process.cwd(), args.auditPath)),
  ]);

  const review = buildReview({ rankings, audit });
  const outputPath = path.resolve(process.cwd(), args.outPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, review);

  printSummary({ audit, outPath: args.outPath });
}

function buildReview({ rankings, audit }) {
  const sections = [
    "# OctagonRank Audit Review",
    metadataSection({ rankings, audit }),
    summarySection(audit),
    divisionReviewSection(rankings),
    flaggedIssuesSection(audit),
    nextTuningSection(audit),
  ];

  return `${sections.join("\n\n")}\n`;
}

function metadataSection({ rankings, audit }) {
  return [
    "## Run Metadata",
    "",
    `- Model version: \`${rankings.model_version ?? audit.model_version ?? "unknown"}\``,
    `- Rankings as of: \`${rankings.as_of ?? audit.as_of ?? "unknown"}\``,
    `- Audit generated at: \`${audit.generated_at ?? "unknown"}\``,
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
      "## Large Policy Adjustments",
      checks.large_policy_adjustments ?? [],
      ["Division", "Rank", "Fighter", "Current", "Title", "Rank Guard", "H2H", "Title Guard"],
      (row) => [
        row.division,
        row.rank,
        row.fighter,
        fmtSigned(row.current_context_adjustment),
        fmtSigned(row.title_context_adjustment),
        fmtSigned(row.rank_guard_adjustment),
        fmtSigned(row.head_to_head_adjustment),
        fmtSigned(row.title_guard_adjustment),
      ],
      "No large policy adjustments.",
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

function nextTuningSection(audit) {
  const items = [];
  const summary = audit.summary ?? {};
  if (num(summary.recent_head_to_head_violations) > 0) {
    items.push("Review the remaining head-to-head flags first. These usually show where the resolver is too narrow or where a post-fight loss should matter more.");
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
    items.push("Audit large policy adjustments so the resume story stays honest: model score and ranking policy should remain visibly separate.");
  }
  if (num(summary.data_quality_flags) > 0) {
    items.push("Fix data-quality flags before formula tuning; duplicated snapshot entries and unexplained division transfers can create fake ranking problems.");
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
  if (num(fighter.recent_activity_adjustment) >= 10) {
    reasons.push(`activity ${fmtSigned(fighter.recent_activity_adjustment)}`);
  }
  if (num(fighter.title_win_adjustment) > 0) {
    reasons.push(`title-lineage win ${fmtSigned(fighter.title_win_adjustment)}`);
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
  return (
    num(fighter.current_context_adjustment) +
    num(fighter.title_context_adjustment) +
    num(fighter.rank_guard_adjustment) +
    num(fighter.head_to_head_adjustment) +
    num(fighter.title_guard_adjustment) -
    num(fighter.entry_gate_penalty)
  );
}

function severityFor(check, count) {
  const value = num(count);
  if (value === 0) return "clear";
  if (check === "champion_failures" || check === "title_context_failures") return "high";
  if (check === "recent_head_to_head_violations" || check === "old_opponent_overcredit") return "medium";
  if (check === "prospect_overboost" || check === "inactive_top_ranked") return "medium";
  return "review";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
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
  node scripts/review-audit.mjs --rankings=data/model/rankings.json --audit=data/model/audit.json --out=data/model/audit-review.md

Options:
  --rankings=PATH  Generated rankings JSON path.
  --audit=PATH     Generated audit JSON path.
  --out=PATH       Markdown review output path.
`);
}

function printSummary({ audit, outPath }) {
  console.log(`Wrote audit review to ${outPath}`);
  for (const [check, count] of Object.entries(audit.summary ?? {})) {
    console.log(`${check}: ${count}`);
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
