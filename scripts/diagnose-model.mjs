#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  fighterProfilesPath: "data/ufcstats/fighters.json",
  outPath: "data/model/diagnostics.json",
  markdownOutPath: "data/model/diagnostics.md",
  sensitivityPct: 0.1,
};

const SENSITIVITY_COMPONENTS = [
  { key: "recent_form_adjustment", label: "recent form", sign: 1, type: "model" },
  { key: "recent_outcome_adjustment", label: "latest result", sign: 1, type: "model" },
  { key: "schedule_strength_adjustment", label: "schedule strength", sign: 1, type: "model" },
  { key: "dominance_adjustment", label: "fight dominance", sign: 1, type: "model" },
  { key: "round_dominance_adjustment", label: "round dominance", sign: 1, type: "model" },
  { key: "finish_adjustment", label: "finish rate", sign: 1, type: "model" },
  { key: "quality_win_adjustment", label: "quality win", sign: 1, type: "model" },
  { key: "title_win_adjustment", label: "title-lineage win", sign: 1, type: "model" },
  { key: "elite_resume_adjustment", label: "elite resume", sign: 1, type: "model" },
  { key: "recent_activity_adjustment", label: "recent activity", sign: 1, type: "model" },
  { key: "inactivity_penalty", label: "inactivity penalty", sign: -1, type: "model" },
  { key: "legacy_penalty", label: "legacy penalty", sign: -1, type: "model" },
  { key: "entry_gate_penalty", label: "entry gate", sign: -1, type: "policy" },
  { key: "current_context_prior", label: "snapshot prior", sign: 1, type: "policy" },
  { key: "rank_guard_adjustment", label: "rank guard", sign: 1, type: "policy" },
  { key: "head_to_head_adjustment", label: "head-to-head", sign: 1, type: "policy" },
  { key: "title_context_adjustment", label: "title context", sign: 1, type: "policy" },
  { key: "title_guard_adjustment", label: "champion guard", sign: 1, type: "policy" },
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

  const [rankings, fighterProfiles] = await Promise.all([
    readJson(path.resolve(process.cwd(), args.rankingsPath)),
    readOptionalJson(path.resolve(process.cwd(), args.fighterProfilesPath), []),
  ]);

  const report = buildDiagnostics({
    rankings,
    fighterProfiles,
    sensitivityPct: args.sensitivityPct,
  });
  const markdown = buildMarkdownReport(report);

  const outputPath = path.resolve(process.cwd(), args.outPath);
  const markdownPath = path.resolve(process.cwd(), args.markdownOutPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await Promise.all([
    fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(markdownPath, markdown),
  ]);

  printSummary(report, args);
}

function buildDiagnostics({ rankings, fighterProfiles, sensitivityPct }) {
  const profilesById = new Map(fighterProfiles.map((profile) => [profile.fighter_id, profile]));
  const profilesByName = new Map(fighterProfiles.map((profile) => [normalizeName(profile.name), profile]));
  const fighters = flattenRankings({ rankings, profilesById, profilesByName });
  const sensitivity = buildSensitivity({ rankings, sensitivityPct });
  const sensitivityByFighter = new Map(sensitivity.fighter_sensitivity.map((row) => [row.key, row]));
  const groups = buildBiasGroups(fighters, sensitivityByFighter);
  const biasFlags = buildBiasFlags(groups);

  return {
    generated_at: new Date().toISOString(),
    model_version: rankings.model_version ?? "unknown",
    as_of: rankings.as_of ?? "unknown",
    sensitivity_pct: sensitivityPct,
    notes: [
      "Diagnostics are not proof of fairness. They identify where the model may need review.",
      "Sensitivity tests are local perturbations of generated score components; they do not re-run head-to-head or guard policy.",
      "Style groups are stat-profile proxies, not true scouting labels.",
    ],
    summary: {
      ranked_fighters: fighters.length,
      divisions: rankings.divisions?.length ?? 0,
      bias_flags: biasFlags.length,
      sensitivity_tests: sensitivity.component_tests.length,
      fragile_fighters: sensitivity.fighter_sensitivity.filter((row) => row.max_abs_rank_move >= 3).length,
      max_rank_move: sensitivity.summary.max_rank_move,
      most_sensitive_component: sensitivity.summary.most_sensitive_component,
    },
    bias_groups: groups,
    bias_flags: biasFlags,
    sensitivity,
  };
}

function flattenRankings({ rankings, profilesById, profilesByName }) {
  const asOfDate = new Date(rankings.as_of);
  return (rankings.divisions ?? []).flatMap((division) => {
    const modelRankByName = new Map(
      [...(division.rankings ?? [])]
        .sort((a, b) => num(b.model_score) - num(a.model_score) || String(a.fighter_name).localeCompare(b.fighter_name))
        .map((fighter, index) => [normalizeName(fighter.fighter_name), index + 1]),
    );

    return (division.rankings ?? []).map((fighter) => {
      const profile = profilesById.get(fighter.fighter_id) ?? profilesByName.get(normalizeName(fighter.fighter_name));
      const age = calculateAgeAtDate(profile?.dob_iso, asOfDate);
      const snapshotRank = Number.isFinite(Number(fighter.current_snapshot_rank))
        ? Number(fighter.current_snapshot_rank) + 1
        : null;
      const modelRank = modelRankByName.get(normalizeName(fighter.fighter_name)) ?? null;
      const finalMinusModel = round(num(fighter.final_score) - num(fighter.model_score), 2);
      const snapshotDelta = snapshotRank ? fighter.rank - snapshotRank : null;
      const modelDelta = modelRank ? fighter.rank - modelRank : null;
      const style = getStyleProxy(fighter);

      return {
        key: `${division.division}::${fighter.fighter_name}`,
        division: division.division,
        fighter: fighter.fighter_name,
        rank: fighter.rank,
        model_rank: modelRank,
        snapshot_rank: snapshotRank,
        final_score: num(fighter.final_score),
        model_score: num(fighter.model_score),
        final_minus_model: finalMinusModel,
        snapshot_delta: snapshotDelta,
        model_delta: modelDelta,
        age: Number.isFinite(age) ? round(age, 1) : null,
        months_inactive: num(fighter.months_inactive),
        ufc_division_fights: num(fighter.ufc_division_fights),
        recent_fights_30m: num(fighter.recent_fights_30m),
        recent_rating_change_30m: num(fighter.recent_rating_change_30m),
        recent_outcome_adjustment: num(fighter.recent_outcome_adjustment),
        schedule_strength_adjustment: num(fighter.schedule_strength_adjustment),
        schedule_strength_status: fighter.schedule_strength_status ?? "",
        dominant_wins_last_5: num(fighter.dominant_wins_last_5),
        quality_win_adjustment: num(fighter.quality_win_adjustment),
        title_win_adjustment: num(fighter.title_win_adjustment),
        elite_resume_adjustment: num(fighter.elite_resume_adjustment),
        elite_resume_score: num(fighter.elite_resume_score),
        elite_resume_tier: fighter.elite_resume_tier ?? "",
        rank_guard_adjustment: num(fighter.rank_guard_adjustment),
        entry_gate_penalty: num(fighter.entry_gate_penalty),
        division_context_status: fighter.division_context_status ?? "",
        title_context_status: fighter.title_context_status ?? "",
        source_division: fighter.source_division ?? "",
        display_division: fighter.display_division ?? division.division,
        style_proxy: style.label,
        grappling_proxy_score: style.grappling,
        striking_proxy_score: style.striking,
        raw_fighter: fighter,
      };
    });
  });
}

function buildBiasGroups(fighters, sensitivityByFighter) {
  const groupDefs = [
    { key: "all_ranked", label: "All ranked fighters", test: () => true },
    { key: "age_35_plus", label: "Age 35+", test: (row) => row.age !== null && row.age >= 35 },
    { key: "age_28_under", label: "Age 28 and under", test: (row) => row.age !== null && row.age <= 28 },
    { key: "active_6m", label: "Active within 6 months", test: (row) => row.months_inactive <= 6 },
    { key: "inactive_12m_plus", label: "Inactive 12+ months", test: (row) => row.months_inactive >= 12 },
    { key: "low_sample_lt4", label: "Low UFC sample (<4 division fights)", test: (row) => row.ufc_division_fights < 4 },
    { key: "veteran_10plus", label: "Veteran sample (10+ division fights)", test: (row) => row.ufc_division_fights >= 10 },
    {
      key: "weak_schedule_penalized",
      label: "Weak schedule penalized",
      test: (row) => row.schedule_strength_adjustment <= -8,
    },
    {
      key: "strong_schedule_bonus",
      label: "Strong schedule bonus",
      test: (row) => row.schedule_strength_adjustment >= 3,
    },
    {
      key: "dominant_recent_wins",
      label: "2+ dominant recent wins",
      test: (row) => row.dominant_wins_last_5 >= 2,
    },
    {
      key: "latest_finish_loss",
      label: "Recent damaging loss",
      test: (row) => row.recent_outcome_adjustment <= -8,
    },
    {
      key: "division_transfer",
      label: "Division transfer context",
      test: (row) => Boolean(row.division_context_status) || row.source_division !== row.display_division,
    },
    {
      key: "title_context_protected",
      label: "Title-context protected",
      test: (row) => Boolean(row.title_context_status),
    },
    {
      key: "elite_resume_credit",
      label: "Elite-resume credit",
      test: (row) => row.elite_resume_adjustment >= 6,
    },
    {
      key: "rank_guard_protected",
      label: "Rank guard protected",
      test: (row) => row.rank_guard_adjustment > 0,
    },
    {
      key: "grappling_heavy_proxy",
      label: "Grappling-heavy stat proxy",
      test: (row) => row.style_proxy === "grappling-heavy",
    },
    {
      key: "striking_heavy_proxy",
      label: "Striking-heavy stat proxy",
      test: (row) => row.style_proxy === "striking-heavy",
    },
  ];

  return groupDefs.map((group) => summarizeBiasGroup(group, fighters.filter(group.test), sensitivityByFighter));
}

function summarizeBiasGroup(group, rows, sensitivityByFighter) {
  const sensitivities = rows
    .map((row) => sensitivityByFighter.get(row.key)?.max_abs_rank_move)
    .filter((value) => Number.isFinite(value));
  const snapshotRows = rows.filter((row) => row.snapshot_delta !== null);
  const modelRows = rows.filter((row) => row.model_delta !== null);
  const ageRows = rows.filter((row) => row.age !== null);

  return {
    key: group.key,
    label: group.label,
    count: rows.length,
    avg_rank: avg(rows.map((row) => row.rank)),
    avg_age: avg(ageRows.map((row) => row.age)),
    avg_final_minus_model: avg(rows.map((row) => row.final_minus_model)),
    avg_snapshot_delta: avg(snapshotRows.map((row) => row.snapshot_delta)),
    avg_model_delta: avg(modelRows.map((row) => row.model_delta)),
    avg_schedule_adjustment: avg(rows.map((row) => row.schedule_strength_adjustment)),
    avg_recent_outcome_adjustment: avg(rows.map((row) => row.recent_outcome_adjustment)),
    avg_quality_win_adjustment: avg(rows.map((row) => row.quality_win_adjustment)),
    avg_elite_resume_adjustment: avg(rows.map((row) => row.elite_resume_adjustment)),
    avg_rank_guard_adjustment: avg(rows.map((row) => row.rank_guard_adjustment)),
    avg_sensitivity_max_move: avg(sensitivities),
    notable_examples: rows
      .sort((a, b) => Math.abs(b.final_minus_model) - Math.abs(a.final_minus_model))
      .slice(0, 5)
      .map((row) => ({
        division: row.division,
        rank: row.rank,
        fighter: row.fighter,
        final_minus_model: row.final_minus_model,
        snapshot_delta: row.snapshot_delta,
        schedule_strength_adjustment: row.schedule_strength_adjustment,
        elite_resume_adjustment: row.elite_resume_adjustment,
        rank_guard_adjustment: row.rank_guard_adjustment,
      })),
  };
}

function buildBiasFlags(groups) {
  const baseline = groups.find((group) => group.key === "all_ranked");
  if (!baseline) return [];

  const flags = [];
  for (const group of groups) {
    if (group.key === "all_ranked" || group.count < 5) continue;

    const policyDelta = group.avg_final_minus_model - baseline.avg_final_minus_model;
    const sensitivityDelta = group.avg_sensitivity_max_move - baseline.avg_sensitivity_max_move;

    if (Math.abs(policyDelta) >= 18) {
      flags.push({
        group: group.label,
        type: policyDelta > 0 ? "policy_boost" : "policy_drag",
        severity: Math.abs(policyDelta) >= 30 ? "high" : "medium",
        detail: `Average final-minus-model differs from baseline by ${fmtSigned(policyDelta)} points.`,
      });
    }

    if (Math.abs(group.avg_snapshot_delta) >= 3) {
      flags.push({
        group: group.label,
        type: group.avg_snapshot_delta > 0 ? "below_snapshot" : "above_snapshot",
        severity: Math.abs(group.avg_snapshot_delta) >= 5 ? "high" : "medium",
        detail: `Average final rank is ${fmt(Math.abs(group.avg_snapshot_delta))} places ${group.avg_snapshot_delta > 0 ? "below" : "above"} snapshot rank.`,
      });
    }

    if (sensitivityDelta >= 1.2) {
      flags.push({
        group: group.label,
        type: "fragile_group",
        severity: sensitivityDelta >= 2 ? "high" : "medium",
        detail: `Average max sensitivity is ${fmt(sensitivityDelta)} rank places above baseline.`,
      });
    }
  }

  return flags.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function buildSensitivity({ rankings, sensitivityPct }) {
  const tests = [];
  const fighterMoves = new Map();

  for (const component of SENSITIVITY_COMPONENTS) {
    for (const direction of [-1, 1]) {
      const factor = 1 + direction * sensitivityPct;
      const allMoves = [];

      for (const division of rankings.divisions ?? []) {
        const originalByName = new Map((division.rankings ?? []).map((fighter) => [normalizeName(fighter.fighter_name), fighter.rank]));
        const perturbed = (division.rankings ?? [])
          .map((fighter) => ({
            fighter,
            score: num(fighter.final_score) + component.sign * num(fighter[component.key]) * (factor - 1),
          }))
          .sort((a, b) => b.score - a.score || String(a.fighter.fighter_name).localeCompare(b.fighter.fighter_name));

        perturbed.forEach((row, index) => {
          const newRank = index + 1;
          const oldRank = originalByName.get(normalizeName(row.fighter.fighter_name));
          const rankMove = oldRank - newRank;
          const absRankMove = Math.abs(rankMove);
          const move = {
            key: `${division.division}::${row.fighter.fighter_name}`,
            division: division.division,
            fighter: row.fighter.fighter_name,
            component: component.key,
            component_label: component.label,
            component_type: component.type,
            direction: direction > 0 ? "plus" : "minus",
            factor,
            old_rank: oldRank,
            new_rank: newRank,
            rank_move: rankMove,
            abs_rank_move: absRankMove,
            old_score: num(row.fighter.final_score),
            new_score: round(row.score, 2),
            component_value: round(component.sign * num(row.fighter[component.key]), 2),
          };
          allMoves.push(move);
          updateFighterSensitivity(fighterMoves, move);
        });
      }

      tests.push({
        component: component.key,
        label: component.label,
        type: component.type,
        direction: direction > 0 ? "plus_10pct" : "minus_10pct",
        factor,
        avg_abs_rank_move: avg(allMoves.map((move) => move.abs_rank_move)),
        max_abs_rank_move: max(allMoves.map((move) => move.abs_rank_move)),
        unstable_count_2plus: allMoves.filter((move) => move.abs_rank_move >= 2).length,
        unstable_count_3plus: allMoves.filter((move) => move.abs_rank_move >= 3).length,
        biggest_movers: allMoves
          .filter((move) => move.abs_rank_move > 0)
          .sort((a, b) => b.abs_rank_move - a.abs_rank_move || a.fighter.localeCompare(b.fighter))
          .slice(0, 12)
          .map(stripMoveForOutput),
      });
    }
  }

  const fighterSensitivity = [...fighterMoves.values()]
    .sort((a, b) => b.max_abs_rank_move - a.max_abs_rank_move || b.tests_moved_2plus - a.tests_moved_2plus)
    .slice(0, 40);
  const mostSensitiveComponent = [...tests].sort(
    (a, b) => b.unstable_count_3plus - a.unstable_count_3plus || b.max_abs_rank_move - a.max_abs_rank_move,
  )[0];

  return {
    summary: {
      components_tested: SENSITIVITY_COMPONENTS.length,
      tests: tests.length,
      max_rank_move: max(tests.map((test) => test.max_abs_rank_move)),
      most_sensitive_component: mostSensitiveComponent
        ? `${mostSensitiveComponent.label} ${mostSensitiveComponent.direction}`
        : "",
    },
    component_tests: tests,
    fighter_sensitivity: fighterSensitivity,
  };
}

function updateFighterSensitivity(fighterMoves, move) {
  const existing =
    fighterMoves.get(move.key) ??
    {
      key: move.key,
      division: move.division,
      fighter: move.fighter,
      max_abs_rank_move: 0,
      tests_moved_2plus: 0,
      tests_moved_3plus: 0,
      worst_case: null,
    };

  if (move.abs_rank_move > existing.max_abs_rank_move) {
    existing.max_abs_rank_move = move.abs_rank_move;
    existing.worst_case = stripMoveForOutput(move);
  }
  if (move.abs_rank_move >= 2) existing.tests_moved_2plus += 1;
  if (move.abs_rank_move >= 3) existing.tests_moved_3plus += 1;
  fighterMoves.set(move.key, existing);
}

function stripMoveForOutput(move) {
  return {
    division: move.division,
    fighter: move.fighter,
    component: move.component_label,
    direction: move.direction,
    old_rank: move.old_rank,
    new_rank: move.new_rank,
    rank_move: move.rank_move,
    old_score: move.old_score,
    new_score: move.new_score,
    component_value: move.component_value,
  };
}

function getStyleProxy(fighter) {
  const fights = Math.max(1, num(fighter.ufc_division_fights));
  const totals = fighter.totals ?? {};
  const takedownAttemptsPerFight = num(totals.takedowns_attempted) / fights;
  const takedownsLandedPerFight = num(totals.takedowns_landed) / fights;
  const submissionsPerFight = num(totals.submission_attempts) / fights;
  const controlSecondsPerFight = num(totals.control_seconds) / fights;
  const sigAttemptsPerFight = num(totals.sig_strikes_attempted) / fights;
  const grappling = takedownAttemptsPerFight * 4 + takedownsLandedPerFight * 6 + submissionsPerFight * 7 + controlSecondsPerFight / 30;
  const striking = sigAttemptsPerFight / 10 + num(totals.knockdowns) / fights * 8;

  let label = "balanced";
  if (grappling >= 18 && grappling >= striking * 1.2) label = "grappling-heavy";
  else if (striking >= 10 && striking >= grappling * 1.4) label = "striking-heavy";

  return {
    label,
    grappling: round(grappling, 2),
    striking: round(striking, 2),
  };
}

function buildMarkdownReport(report) {
  const baseline = report.bias_groups.find((group) => group.key === "all_ranked");
  const groupRows = report.bias_groups
    .filter((group) => group.key !== "all_ranked")
    .filter((group) => group.count > 0)
    .map((group) => [
      group.label,
      group.count,
      fmt(group.avg_final_minus_model),
      fmt(group.avg_snapshot_delta),
      fmt(group.avg_model_delta),
      fmt(group.avg_schedule_adjustment),
      fmt(group.avg_sensitivity_max_move),
    ]);
  const sensitivityRows = report.sensitivity.component_tests
    .slice()
    .sort((a, b) => b.unstable_count_3plus - a.unstable_count_3plus || b.max_abs_rank_move - a.max_abs_rank_move)
    .slice(0, 12)
    .map((test) => [
      test.label,
      test.direction,
      test.type,
      fmt(test.avg_abs_rank_move),
      test.max_abs_rank_move,
      test.unstable_count_3plus,
      test.biggest_movers[0] ? `${test.biggest_movers[0].fighter} (${fmtSigned(test.biggest_movers[0].rank_move)})` : "-",
    ]);
  const fragileRows = report.sensitivity.fighter_sensitivity
    .slice(0, 15)
    .map((row) => [
      row.division,
      row.fighter,
      row.max_abs_rank_move,
      row.tests_moved_2plus,
      row.worst_case ? `${row.worst_case.component} ${row.worst_case.direction}` : "-",
      row.worst_case ? `${row.worst_case.old_rank} -> ${row.worst_case.new_rank}` : "-",
    ]);
  const flagRows = report.bias_flags.map((flag) => [flag.severity, flag.group, flag.type, flag.detail]);

  return [
    "# OctagonRank Model Diagnostics",
    "",
    `Generated at: \`${report.generated_at}\``,
    `Model version: \`${report.model_version}\``,
    `Rankings as of: \`${report.as_of}\``,
    "",
    "## Summary",
    "",
    `- Ranked fighters: \`${report.summary.ranked_fighters}\``,
    `- Bias flags: \`${report.summary.bias_flags}\``,
    `- Sensitivity tests: \`${report.summary.sensitivity_tests}\``,
    `- Fragile fighters with 3+ rank movement: \`${report.summary.fragile_fighters}\``,
    `- Max rank move under local perturbation: \`${report.summary.max_rank_move}\``,
    `- Most sensitive component: \`${report.summary.most_sensitive_component || "none"}\``,
    "",
    "## Baseline",
    "",
    baseline
      ? `Average final-minus-model score: \`${fmt(baseline.avg_final_minus_model)}\`; average max sensitivity: \`${fmt(baseline.avg_sensitivity_max_move)}\`.`
      : "Baseline unavailable.",
    "",
    markdownTable("## Bias Flags", ["Severity", "Group", "Type", "Detail"], flagRows, "No category-level bias flags crossed thresholds."),
    "",
    markdownTable(
      "## Group Audit",
      ["Group", "Count", "Avg Final-Model", "Avg Snapshot Delta", "Avg Model Delta", "Avg Schedule Adj", "Avg Sensitivity"],
      groupRows,
      "No groups to report.",
    ),
    "",
    markdownTable(
      "## Most Sensitive Components",
      ["Component", "Direction", "Type", "Avg Move", "Max Move", "3+ Movers", "Largest Mover"],
      sensitivityRows,
      "No sensitivity movement detected.",
    ),
    "",
    markdownTable(
      "## Fragile Fighters",
      ["Division", "Fighter", "Max Move", "2+ Move Tests", "Worst Component", "Worst Rank Change"],
      fragileRows,
      "No fragile fighters crossed the reporting threshold.",
    ),
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}

function markdownTable(title, headers, rows, emptyText) {
  if (!rows.length) return [title, "", emptyText].join("\n");
  const headerLine = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`);
  return [title, "", headerLine, separatorLine, ...rowLines].join("\n");
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
    } else if (arg.startsWith("--fighters=")) {
      args.fighterProfilesPath = arg.slice("--fighters=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--markdown-out=")) {
      args.markdownOutPath = arg.slice("--markdown-out=".length);
    } else if (arg.startsWith("--sensitivity-pct=")) {
      args.sensitivityPct = Number(arg.slice("--sensitivity-pct=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.sensitivityPct) || args.sensitivityPct <= 0) {
    throw new Error("--sensitivity-pct must be a positive number, such as 0.1");
  }

  return args;
}

function printHelp() {
  console.log(`Generate bias and sensitivity diagnostics for OctagonRank output.

Usage:
  npm run model:diagnostics
  node scripts/diagnose-model.mjs --rankings=data/model/rankings.json --out=data/model/diagnostics.json

Options:
  --rankings=PATH         Generated rankings JSON path.
  --fighters=PATH         Scraped UFCStats fighter profiles path.
  --out=PATH              Diagnostics JSON output path.
  --markdown-out=PATH     Diagnostics Markdown output path.
  --sensitivity-pct=N     Local perturbation amount. Default: 0.1.
`);
}

function printSummary(report, args) {
  console.log(`Wrote diagnostics report to ${args.outPath}`);
  console.log(`Wrote diagnostics review to ${args.markdownOutPath}`);
  console.log(`bias flags: ${report.summary.bias_flags}`);
  console.log(`fragile fighters: ${report.summary.fragile_fighters}`);
  console.log(`max rank move: ${report.summary.max_rank_move}`);
  console.log(`most sensitive component: ${report.summary.most_sensitive_component || "none"}`);
}

function calculateAgeAtDate(dobIso, date) {
  if (!dobIso) return NaN;
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return NaN;
  return (date - dob) / (365.25 * 24 * 60 * 60 * 1000);
}

function avg(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length, 2);
}

function max(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : 0;
}

function severityRank(severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function num(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function fmt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  if (Number.isInteger(parsed)) return String(parsed);
  return parsed.toFixed(2).replace(/\.?0+$/, "");
}

function fmtSigned(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  if (parsed === 0) return "0";
  return `${parsed > 0 ? "+" : ""}${fmt(parsed)}`;
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();
}
