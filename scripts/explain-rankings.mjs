#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  outPath: "data/model/explanations.json",
  markdownOutPath: "data/model/explanations.md",
  division: "",
};

const MODEL_COMPONENTS = [
  ["recent_form_adjustment", "Recent form"],
  ["recent_outcome_adjustment", "Latest result"],
  ["schedule_strength_adjustment", "Schedule strength"],
  ["recent_activity_adjustment", "Recent activity"],
  ["dominance_adjustment", "Fight dominance"],
  ["round_dominance_adjustment", "Round dominance"],
  ["finish_adjustment", "Finish rate"],
  ["title_win_adjustment", "Title-lineage wins"],
  ["elite_resume_adjustment", "Elite resume"],
  ["quality_win_adjustment", "Best-win quality"],
  ["current_division_overlay_adjustment", "Current-division overlay"],
];

const PENALTY_COMPONENTS = [
  ["inactivity_penalty", "Inactivity penalty"],
  ["legacy_penalty", "Legacy decay"],
  ["division_transfer_penalty", "Division-transfer penalty"],
  ["top_contender_credibility_penalty", "Top-contender credibility"],
];

const POLICY_COMPONENTS = [
  ["current_context_prior", "Current snapshot prior"],
  ["title_guard_adjustment", "Champion guard"],
  ["title_context_adjustment", "Title-context policy"],
  ["rank_guard_adjustment", "Rank guard"],
  ["head_to_head_adjustment", "Head-to-head resolver"],
  ["snapshot_order_adjustment", "Snapshot-order tiebreaker"],
  ["entry_gate_penalty", "Entry gate"],
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

  const rankings = await readJson(path.resolve(process.cwd(), args.rankingsPath));
  const explanations = buildExplanations(rankings, args);
  const outputPath = path.resolve(process.cwd(), args.outPath);
  const markdownPath = path.resolve(process.cwd(), args.markdownOutPath);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await Promise.all([
    writeJson(outputPath, explanations),
    fs.writeFile(markdownPath, buildMarkdown(explanations)),
  ]);

  printSummary(explanations, args);
}

function buildExplanations(rankings, args) {
  const selectedDivisions = (rankings.divisions ?? []).filter((division) => {
    return !args.division || normalizeName(division.division) === normalizeName(args.division);
  });

  const divisions = selectedDivisions.map((division) => buildDivisionExplanation(division));
  const allFlags = divisions.flatMap((division) => division.review_flags);

  return {
    generated_at: new Date().toISOString(),
    rankings_as_of: rankings.as_of,
    rankings_model_version: rankings.model_version,
    rankings_path: args.rankingsPath,
    division_filter: args.division || "",
    summary: {
      divisions: divisions.length,
      fighters: divisions.reduce((sum, division) => sum + division.fighters.length, 0),
      review_flags: allFlags.length,
      high_priority_review_flags: allFlags.filter((flag) => flag.priority === "high").length,
    },
    divisions,
  };
}

function buildDivisionExplanation(division) {
  const fighters = division.rankings ?? [];
  const modelRankByName = new Map(
    [...fighters]
      .sort((a, b) => num(b.model_score) - num(a.model_score))
      .map((fighter, index) => [normalizeName(fighter.fighter_name), index + 1]),
  );
  const explanations = fighters.map((fighter) => explainFighter(fighter, modelRankByName.get(normalizeName(fighter.fighter_name))));
  const reviewFlags = explanations
    .flatMap((fighter) =>
      fighter.review_flags.map((flag) => ({
        division: division.division,
        rank: fighter.rank,
        fighter: fighter.fighter_name,
        ...flag,
      })),
    )
    .sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority) || a.rank - b.rank);

  return {
    division: division.division,
    champion: division.champion,
    review_flags: reviewFlags,
    fighters: explanations,
  };
}

function explainFighter(fighter, modelRank) {
  const modelComponents = buildModelComponents(fighter);
  const policyComponents = buildPolicyComponents(fighter);
  const policyTotal = round(num(fighter.final_score) - num(fighter.model_score), 2);
  const positiveDrivers = modelComponents
    .filter((component) => component.value > 0)
    .sort((a, b) => b.value - a.value);
  const negativeDrivers = [
    ...modelComponents.filter((component) => component.value < 0),
    ...buildPenaltyComponents(fighter).map((component) => ({ ...component, value: -Math.abs(component.value) })),
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const reviewFlags = buildReviewFlags(fighter, { modelRank, policyTotal });

  return {
    rank: fighter.rank,
    model_rank: modelRank,
    fighter_name: fighter.fighter_name,
    final_score: num(fighter.final_score),
    model_score: num(fighter.model_score),
    base_rating: num(fighter.base_rating),
    policy_total: policyTotal,
    current_status: fighter.current_status,
    current_snapshot_rank: snapshotRank(fighter),
    source_division: fighter.source_division,
    display_division: fighter.display_division,
    record: fighter.division_record,
    recent_record_30m: fighter.recent_record_30m,
    recent_rating_change_30m: num(fighter.recent_rating_change_30m),
    months_inactive: num(fighter.months_inactive),
    average_dominance: num(fighter.average_dominance),
    average_round_dominance: num(fighter.average_round_dominance),
    schedule_strength_score: fighter.schedule_strength_score,
    schedule_strength_status: fighter.schedule_strength_status,
    avg_win_opponent_rating_last_5: fighter.avg_win_opponent_rating_last_5,
    best_win_opponent_rating_last_5: fighter.best_win_opponent_rating_last_5,
    elite_resume_score: num(fighter.elite_resume_score),
    elite_resume_tier: fighter.elite_resume_tier,
    best_win: summarizeBestWin(fighter.best_win),
    last_five: summarizeLastFive(fighter.last_five),
    model_components: modelComponents,
    policy_components: policyComponents,
    penalties: buildPenaltyComponents(fighter),
    top_positive_drivers: positiveDrivers.slice(0, 4),
    top_negative_drivers: negativeDrivers.slice(0, 4),
    review_flags: reviewFlags,
    explanation: buildExplanationText({
      fighter,
      modelRank,
      policyTotal,
      positiveDrivers,
      negativeDrivers,
      reviewFlags,
    }),
  };
}

function buildModelComponents(fighter) {
  return MODEL_COMPONENTS.map(([key, label]) => ({
    key,
    label,
    value: round(num(fighter[key]), 2),
  })).filter((component) => component.value !== 0);
}

function buildPenaltyComponents(fighter) {
  return PENALTY_COMPONENTS.map(([key, label]) => ({
    key,
    label,
    value: round(num(fighter[key]), 2),
  })).filter((component) => component.value !== 0);
}

function buildPolicyComponents(fighter) {
  return POLICY_COMPONENTS.map(([key, label]) => ({
    key,
    label,
    value: round(num(fighter[key]), 2),
  })).filter((component) => component.value !== 0);
}

function buildReviewFlags(fighter, { modelRank, policyTotal }) {
  const flags = [];
  const rank = num(fighter.rank);
  const snapshot = snapshotRank(fighter);
  const recentRecord = parseRecord(fighter.recent_record_30m);
  const avgWinRating = num(fighter.avg_win_opponent_rating_last_5);
  const eliteScore = num(fighter.elite_resume_score);
  const hasTitlePolicy = num(fighter.title_context_adjustment) > 0 || num(fighter.title_guard_adjustment) > 0;
  const hasHeadToHeadPolicy = Math.abs(num(fighter.head_to_head_adjustment)) > 0;
  const bestWinAge = num(fighter.best_win_age_months);
  const currentDivisionFights = num(fighter.current_division_fights);

  if (
    rank <= 5 &&
    snapshot >= 8 &&
    eliteScore < 15 &&
    !hasTitlePolicy &&
    !hasHeadToHeadPolicy &&
    fighter.current_status !== "Champion"
  ) {
    flags.push({
      code: "top5_low_context_support",
      priority: "high",
      detail: `Top-5 rank is mostly model score, but current snapshot rank is #${snapshot} and elite-resume score is ${fmt(eliteScore)}.`,
    });
  }

  if (rank <= 10 && avgWinRating > 0 && avgWinRating < 1545 && num(fighter.recent_form_adjustment) > 18) {
    flags.push({
      code: "recent_form_vs_schedule_quality",
      priority: rank <= 5 ? "high" : "medium",
      detail: `Recent form is strong, but average last-five win opponent rating is only ${fmt(avgWinRating)}.`,
    });
  }

  if (rank <= 10 && bestWinAge > 36 && num(fighter.quality_win_adjustment) > 0) {
    flags.push({
      code: "stale_best_win_credit",
      priority: "medium",
      detail: `Best-win credit is still positive even though the best win is ${fmt(bestWinAge)} months old.`,
    });
  }

  if (rank <= 10 && Math.abs(policyTotal) >= 50) {
    flags.push({
      code: "policy_carried_rank",
      priority: "medium",
      detail: `Policy adjustments move the score by ${fmt(policyTotal)} points, so the rank is not pure model score.`,
    });
  }

  if (snapshot > 0 && snapshot <= 5 && rank >= snapshot + 6 && recentRecord.losses > recentRecord.wins) {
    flags.push({
      code: "snapshot_drop_explained_by_recent_losses",
      priority: "medium",
      detail: `Snapshot #${snapshot} fell to #${rank}; recent 30-month record is ${fighter.recent_record_30m}.`,
    });
  }

  if (rank <= 10 && currentDivisionFights > 0 && currentDivisionFights < 3 && fighter.source_division !== fighter.display_division) {
    flags.push({
      code: "small_current_division_sample",
      priority: "medium",
      detail: `Only ${currentDivisionFights} modeled fight(s) in the displayed division after moving from ${fighter.source_division}.`,
    });
  }

  if (rank <= 10 && modelRank > rank + 4) {
    flags.push({
      code: "policy_boosted_above_model_rank",
      priority: "medium",
      detail: `Model-only rank is #${modelRank}, but policy places the fighter at #${rank}.`,
    });
  }

  if (num(fighter.top_contender_credibility_penalty) > 0) {
    flags.push({
      code: "top_contender_credibility_gate",
      priority: "medium",
      detail: `Credibility gate applied a ${fmt(fighter.top_contender_credibility_penalty)} point penalty: ${fighter.top_contender_credibility_status}.`,
    });
  }

  if (num(fighter.snapshot_order_adjustment) > 0) {
    flags.push({
      code: "snapshot_order_tiebreaker",
      priority: "low",
      detail: `Snapshot-order tiebreaker added ${fmt(fighter.snapshot_order_adjustment)} points: ${fighter.snapshot_order_status}.`,
    });
  }

  if (rank <= 10 && recentRecord.losses >= 2 && num(fighter.recent_outcome_adjustment) < 0) {
    flags.push({
      code: "recent_loss_pressure",
      priority: "low",
      detail: `Recent losses are already dragging the score: ${fighter.recent_record_30m} in the last 30 months.`,
    });
  }

  return flags;
}

function buildExplanationText({ fighter, modelRank, policyTotal, positiveDrivers, negativeDrivers, reviewFlags }) {
  const positives = positiveDrivers.slice(0, 2).map(formatComponent).join(", ") || "no major positive component";
  const negatives = negativeDrivers.slice(0, 2).map(formatComponent).join(", ") || "no major penalty";
  const policyText =
    policyTotal === 0
      ? "Policy did not move the score."
      : `Policy moved the score by ${signed(policyTotal)} points.`;
  const reviewText =
    reviewFlags.length > 0
      ? `Review flag: ${reviewFlags[0].detail}`
      : "No automatic review flag fired.";

  return `Ranked #${fighter.rank} with model-only rank #${modelRank}. Main boosts: ${positives}. Main drags: ${negatives}. ${policyText} ${reviewText}`;
}

function summarizeBestWin(bestWin) {
  if (!bestWin) return null;
  return {
    opponent: bestWin.opponent_name ?? "",
    date: bestWin.event_date ?? "",
    method: bestWin.method ?? "",
    opponent_pre_rating: bestWin.opponent_pre_rating ?? "",
    adjusted_opponent_rating: bestWin.adjusted_opponent_rating ?? "",
    opponent_age_at_fight: bestWin.opponent_age_at_fight ?? "",
    opponent_form_score: bestWin.opponent_form_score ?? "",
    opponent_context_reasons: bestWin.opponent_context_reasons ?? [],
    opponent_elite_resume_score: bestWin.opponent_elite_resume_score ?? "",
    opponent_elite_resume_tier: bestWin.opponent_elite_resume_tier ?? "",
  };
}

function summarizeLastFive(fights = []) {
  return fights.map((fight) => ({
    date: fight.date,
    result: fight.result,
    opponent: fight.opponent_name,
    method: fight.method,
    rating_change: fight.rating_change,
    opponent_rating: fight.opponent_adjusted_rating || fight.opponent_pre_rating || "",
    opponent_title_context: fight.opponent_title_context || "",
    dominance_score: fight.dominance_score,
    round_dominance_score: fight.round_dominance_score,
  }));
}

function buildMarkdown(explanations) {
  const lines = [
    "# OctagonRank Fighter Explanations",
    "",
    `Generated at: \`${explanations.generated_at}\``,
    `Rankings as of: \`${explanations.rankings_as_of}\``,
    `Model version: \`${explanations.rankings_model_version}\``,
    "",
    "## Summary",
    "",
    `- divisions: \`${explanations.summary.divisions}\``,
    `- fighters: \`${explanations.summary.fighters}\``,
    `- review flags: \`${explanations.summary.review_flags}\``,
    `- high-priority review flags: \`${explanations.summary.high_priority_review_flags}\``,
    "",
  ];

  for (const division of explanations.divisions) {
    lines.push(`## ${division.division}`, "");
    lines.push(`Champion: ${division.champion || "Unknown"}`, "");

    if (division.review_flags.length > 0) {
      lines.push("### Review Flags", "");
      for (const flag of division.review_flags.slice(0, 12)) {
        lines.push(`- ${flag.priority.toUpperCase()} ${flag.fighter} #${flag.rank}: ${flag.detail}`);
      }
      lines.push("");
    }

    for (const fighter of division.fighters) {
      lines.push(`### ${fighter.rank}. ${fighter.fighter_name} (${fmt(fighter.final_score)})`, "");
      lines.push(fighter.explanation, "");
      lines.push(`- model score: \`${fmt(fighter.model_score)}\`; policy total: \`${signed(fighter.policy_total)}\`; model-only rank: \`#${fighter.model_rank}\``);
      lines.push(`- record: \`${fighter.record}\`; recent record: \`${fighter.recent_record_30m}\`; inactive: \`${fmt(fighter.months_inactive)} months\``);
      lines.push(`- best win: ${formatBestWin(fighter.best_win)}`);
      lines.push(`- top boosts: ${fighter.top_positive_drivers.slice(0, 3).map(formatComponent).join(", ") || "none"}`);
      lines.push(`- top drags: ${fighter.top_negative_drivers.slice(0, 3).map(formatComponent).join(", ") || "none"}`);
      if (fighter.review_flags.length > 0) {
        lines.push(`- review: ${fighter.review_flags.map((flag) => `${flag.code} (${flag.priority})`).join(", ")}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatBestWin(bestWin) {
  if (!bestWin) return "none";
  const rating = bestWin.adjusted_opponent_rating ? `, adjusted opponent rating ${fmt(bestWin.adjusted_opponent_rating)}` : "";
  return `${bestWin.opponent || "Unknown"} on ${bestWin.date || "unknown date"} by ${bestWin.method || "unknown method"}${rating}`;
}

function formatComponent(component) {
  return `${component.label} ${signed(component.value)}`;
}

function parseRecord(record) {
  const [wins = 0, losses = 0] = String(record ?? "")
    .split("-")
    .map((value) => Number(value));
  return {
    wins: Number.isFinite(wins) ? wins : 0,
    losses: Number.isFinite(losses) ? losses : 0,
  };
}

function snapshotRank(fighter) {
  const rank = num(fighter.current_snapshot_rank);
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

function priorityValue(priority) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  if (priority === "low") return 1;
  return 0;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--rankings=")) {
      args.rankingsPath = arg.slice("--rankings=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--markdown-out=")) {
      args.markdownOutPath = arg.slice("--markdown-out=".length);
    } else if (arg.startsWith("--division=")) {
      args.division = arg.slice("--division=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Generate readable explanations for OctagonRank model output.

Usage:
  npm run model:explain
  node scripts/explain-rankings.mjs --division="Light Heavyweight"

Options:
  --rankings=PATH       Rankings JSON path.
  --out=PATH            Explanation JSON output path.
  --markdown-out=PATH   Explanation Markdown output path.
  --division=NAME       Optional single-division filter.
`);
}

function printSummary(explanations, args) {
  console.log(`Wrote explanations to ${args.outPath}`);
  console.log(`Wrote explanation review to ${args.markdownOutPath}`);
  console.log(`fighters: ${explanations.summary.fighters}`);
  console.log(`review flags: ${explanations.summary.review_flags}`);
  console.log(`high-priority review flags: ${explanations.summary.high_priority_review_flags}`);
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

function fmt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return parsed.toFixed(2);
}

function signed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return `${parsed >= 0 ? "+" : ""}${fmt(parsed)}`;
}
