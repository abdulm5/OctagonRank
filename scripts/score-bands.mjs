#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  diagnosticsPath: "data/model/diagnostics.json",
  outPath: "data/model/score-bands.json",
  markdownOutPath: "data/model/score-bands.md",
  tieThreshold: 3,
  closeThreshold: 8,
  rankLimit: 15,
};

const RISK_RANK = {
  high: 3,
  medium: 2,
  low: 1,
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

  const [rankings, diagnostics] = await Promise.all([
    readJson(path.resolve(process.cwd(), args.rankingsPath)),
    readOptionalJson(path.resolve(process.cwd(), args.diagnosticsPath), null),
  ]);

  const report = buildScoreBandReport({ rankings, diagnostics, args });
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

function buildScoreBandReport({ rankings, diagnostics, args }) {
  const sensitivityByFighter = new Map(
    (diagnostics?.sensitivity?.fighter_sensitivity ?? []).map((row) => [row.key, row]),
  );
  const divisionBands = (rankings.divisions ?? []).map((division) =>
    analyzeDivision({
      division,
      sensitivityByFighter,
      thresholds: args,
    }),
  );
  const closePairs = divisionBands.flatMap((division) => division.adjacent_pairs.filter((pair) => pair.band !== "clear"));
  const scoreBands = divisionBands.flatMap((division) => division.score_bands);
  const uncertainFighters = divisionBands.flatMap((division) => division.uncertain_fighters);

  return {
    generated_at: new Date().toISOString(),
    model_version: rankings.model_version ?? "unknown",
    as_of: rankings.as_of ?? "unknown",
    rankings_path: args.rankingsPath,
    diagnostics_path: diagnostics ? args.diagnosticsPath : null,
    thresholds: {
      virtual_tie_gap: args.tieThreshold,
      close_gap: args.closeThreshold,
      rank_limit: args.rankLimit,
      units: "final_score_points",
    },
    summary: {
      divisions: divisionBands.length,
      ranked_fighters_reviewed: divisionBands.reduce((sum, division) => sum + division.ranked_count, 0),
      adjacent_pairs_reviewed: divisionBands.reduce((sum, division) => sum + division.adjacent_pairs.length, 0),
      virtual_tie_pairs: closePairs.filter((pair) => pair.band === "virtual_tie").length,
      close_pairs: closePairs.filter((pair) => pair.band === "close").length,
      score_bands: scoreBands.length,
      high_risk_bands: scoreBands.filter((band) => band.risk === "high").length,
      fragile_fighters_in_bands: new Set(
        scoreBands.flatMap((band) => band.fighters.filter((fighter) => fighter.max_sensitivity_move >= 3).map((fighter) => fighter.fighter)),
      ).size,
    },
    most_uncertain_bands: scoreBands
      .slice()
      .sort(compareBands)
      .slice(0, 25),
    most_uncertain_fighters: uncertainFighters
      .slice()
      .sort(compareUncertainFighters)
      .slice(0, 40),
    divisions: divisionBands,
  };
}

function analyzeDivision({ division, sensitivityByFighter, thresholds }) {
  const fighters = (division.rankings ?? [])
    .filter((fighter) => Number(fighter.rank) <= thresholds.rankLimit)
    .map((fighter) => {
      const sensitivity = sensitivityByFighter.get(`${division.division}::${fighter.fighter_name}`);
      return {
        rank: fighter.rank,
        fighter: fighter.fighter_name,
        final_score: num(fighter.final_score),
        model_score: num(fighter.model_score),
        policy_adjustment: totalPolicyAdjustment(fighter),
        current_status: fighter.current_status ?? "",
        snapshot_rank: Number.isFinite(Number(fighter.current_snapshot_rank)) ? Number(fighter.current_snapshot_rank) : null,
        max_sensitivity_move: num(sensitivity?.max_abs_rank_move),
        worst_sensitivity_component: sensitivity?.worst_case
          ? `${sensitivity.worst_case.component} ${sensitivity.worst_case.direction}`
          : "",
      };
    })
    .sort((a, b) => a.rank - b.rank);

  const adjacentPairs = [];
  for (let index = 0; index < fighters.length - 1; index += 1) {
    const higher = fighters[index];
    const lower = fighters[index + 1];
    const finalGap = round(higher.final_score - lower.final_score);
    const modelGap = round(higher.model_score - lower.model_score);
    const policyGap = round(higher.policy_adjustment - lower.policy_adjustment);
    const band = classifyGap(finalGap, thresholds);
    adjacentPairs.push({
      division: division.division,
      higher_rank: higher.rank,
      higher_fighter: higher.fighter,
      lower_rank: lower.rank,
      lower_fighter: lower.fighter,
      final_gap: finalGap,
      model_gap: modelGap,
      policy_gap: policyGap,
      band,
      max_sensitivity_move: Math.max(higher.max_sensitivity_move, lower.max_sensitivity_move),
      risk: riskForPair({ band, higher, lower }),
    });
  }

  const scoreBands = buildDivisionScoreBands({
    divisionName: division.division,
    fighters,
    adjacentPairs,
    thresholds,
  });

  return {
    division: division.division,
    champion: division.champion ?? null,
    ranked_count: fighters.length,
    adjacent_pairs: adjacentPairs,
    score_bands: scoreBands,
    uncertain_fighters: buildUncertainFighters({
      divisionName: division.division,
      fighters,
      adjacentPairs,
      thresholds,
    }),
  };
}

function buildDivisionScoreBands({ divisionName, fighters, adjacentPairs, thresholds }) {
  const bands = [];
  let current = [];

  for (const fighter of fighters) {
    if (!current.length) {
      current.push(fighter);
      continue;
    }

    const previous = current[current.length - 1];
    const adjacentPair = adjacentPairs.find(
      (pair) => pair.higher_rank === previous.rank && pair.lower_rank === fighter.rank,
    );
    if (adjacentPair && adjacentPair.final_gap <= thresholds.closeThreshold) {
      current.push(fighter);
    } else {
      pushBand({ bands, divisionName, cluster: current, adjacentPairs });
      current = [fighter];
    }
  }

  pushBand({ bands, divisionName, cluster: current, adjacentPairs });
  return bands;
}

function pushBand({ bands, divisionName, cluster, adjacentPairs }) {
  if (cluster.length < 2) return;

  const first = cluster[0];
  const last = cluster[cluster.length - 1];
  const internalPairs = adjacentPairs.filter((pair) => pair.higher_rank >= first.rank && pair.lower_rank <= last.rank);
  const scoreSpread = round(first.final_score - last.final_score);
  const maxAdjacentGap = round(Math.max(...internalPairs.map((pair) => pair.final_gap)));
  const minAdjacentGap = round(Math.min(...internalPairs.map((pair) => pair.final_gap)));
  const maxSensitivityMove = Math.max(...cluster.map((fighter) => fighter.max_sensitivity_move));
  const virtualTiePairs = internalPairs.filter((pair) => pair.band === "virtual_tie").length;
  const risk = riskForBand({ scoreSpread, maxAdjacentGap, maxSensitivityMove, virtualTiePairs });

  bands.push({
    division: divisionName,
    rank_range: `${first.rank}-${last.rank}`,
    start_rank: first.rank,
    end_rank: last.rank,
    fighter_count: cluster.length,
    score_spread: scoreSpread,
    max_adjacent_gap: maxAdjacentGap,
    min_adjacent_gap: minAdjacentGap,
    virtual_tie_pairs: virtualTiePairs,
    max_sensitivity_move: maxSensitivityMove,
    risk,
    interpretation: bandInterpretation({ risk, scoreSpread, maxAdjacentGap, maxSensitivityMove, virtualTiePairs }),
    fighters: cluster.map((fighter) => ({
      rank: fighter.rank,
      fighter: fighter.fighter,
      final_score: fighter.final_score,
      model_score: fighter.model_score,
      policy_adjustment: fighter.policy_adjustment,
      max_sensitivity_move: fighter.max_sensitivity_move,
      worst_sensitivity_component: fighter.worst_sensitivity_component,
    })),
  });
}

function buildUncertainFighters({ divisionName, fighters, adjacentPairs, thresholds }) {
  return fighters
    .map((fighter, index) => {
      const gap_above = index === 0 ? null : adjacentPairs[index - 1]?.final_gap ?? null;
      const gap_below = index === fighters.length - 1 ? null : adjacentPairs[index]?.final_gap ?? null;
      const finiteGaps = [gap_above, gap_below].filter((gap) => Number.isFinite(gap));
      const nearestGap = finiteGaps.length ? Math.min(...finiteGaps) : null;
      const uncertainty = uncertaintyForFighter({ nearestGap, sensitivityMove: fighter.max_sensitivity_move, thresholds });
      return {
        division: divisionName,
        rank: fighter.rank,
        fighter: fighter.fighter,
        final_score: fighter.final_score,
        gap_above,
        gap_below,
        nearest_gap: nearestGap,
        max_sensitivity_move: fighter.max_sensitivity_move,
        worst_sensitivity_component: fighter.worst_sensitivity_component,
        uncertainty,
      };
    })
    .filter((fighter) => fighter.uncertainty !== "stable");
}

function classifyGap(gap, thresholds) {
  if (gap <= thresholds.tieThreshold) return "virtual_tie";
  if (gap <= thresholds.closeThreshold) return "close";
  return "clear";
}

function riskForPair({ band, higher, lower }) {
  const maxSensitivityMove = Math.max(higher.max_sensitivity_move, lower.max_sensitivity_move);
  if (band === "virtual_tie" || maxSensitivityMove >= 3) return "high";
  if (band === "close" || maxSensitivityMove >= 2) return "medium";
  return "low";
}

function riskForBand({ scoreSpread, maxAdjacentGap, maxSensitivityMove, virtualTiePairs }) {
  if (virtualTiePairs > 0 || maxSensitivityMove >= 3 || scoreSpread <= 3) return "high";
  if (maxAdjacentGap <= 8 || maxSensitivityMove >= 2) return "medium";
  return "low";
}

function uncertaintyForFighter({ nearestGap, sensitivityMove, thresholds }) {
  if (sensitivityMove >= 3) return "fragile";
  if (nearestGap !== null && nearestGap <= thresholds.tieThreshold) return "virtual_tie";
  if (nearestGap !== null && nearestGap <= thresholds.closeThreshold) return "close";
  if (sensitivityMove >= 2) return "sensitive";
  return "stable";
}

function bandInterpretation({ risk, scoreSpread, maxAdjacentGap, maxSensitivityMove, virtualTiePairs }) {
  if (risk === "high" && virtualTiePairs > 0) {
    return `Contains ${virtualTiePairs} virtual-tie adjacent pair(s); rank order should be treated as low-confidence.`;
  }
  if (risk === "high" && maxSensitivityMove >= 3) {
    return `At least one fighter moves ${maxSensitivityMove} spots in diagnostics sensitivity checks.`;
  }
  if (risk === "medium") {
    return `Adjacent gaps stay within ${fmt(maxAdjacentGap)} points; rank order is close but not a full tie.`;
  }
  return `Score spread is ${fmt(scoreSpread)} points; ranking is relatively separated.`;
}

function buildMarkdownReport(report) {
  const summaryRows = Object.entries(report.summary).map(([key, value]) => [humanizeKey(key), value]);
  const bandRows = report.most_uncertain_bands.map((band) => [
    band.risk,
    band.division,
    band.rank_range,
    band.fighters.map((fighter) => `${fighter.rank}. ${fighter.fighter}`).join(", "),
    fmt(band.score_spread),
    fmt(band.max_adjacent_gap),
    band.max_sensitivity_move,
    band.interpretation,
  ]);
  const fighterRows = report.most_uncertain_fighters.map((fighter) => [
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
  const pairRows = report.divisions
    .flatMap((division) => division.adjacent_pairs)
    .filter((pair) => pair.band !== "clear")
    .sort((a, b) => a.final_gap - b.final_gap || RISK_RANK[b.risk] - RISK_RANK[a.risk])
    .slice(0, 80)
    .map((pair) => [
      pair.band,
      pair.risk,
      pair.division,
      `${pair.higher_rank}. ${pair.higher_fighter}`,
      `${pair.lower_rank}. ${pair.lower_fighter}`,
      fmt(pair.final_gap),
      fmt(pair.model_gap),
      fmt(pair.policy_gap),
      pair.max_sensitivity_move,
    ]);
  const divisionRows = report.divisions.map((division) => [
    division.division,
    division.score_bands.length,
    division.score_bands.filter((band) => band.risk === "high").length,
    division.adjacent_pairs.filter((pair) => pair.band === "virtual_tie").length,
    division.adjacent_pairs.filter((pair) => pair.band === "close").length,
    division.score_bands[0]
      ? `${division.score_bands[0].rank_range}: ${division.score_bands[0].fighters.map((fighter) => fighter.fighter).join(", ")}`
      : "-",
  ]);

  return [
    "# OctagonRank Score Bands",
    "",
    `Generated at: \`${report.generated_at}\``,
    `Model version: \`${report.model_version}\``,
    `Rankings as of: \`${report.as_of}\``,
    "",
    `Thresholds: virtual tie <= \`${report.thresholds.virtual_tie_gap}\`, close <= \`${report.thresholds.close_gap}\` final-score points.`,
    "",
    markdownTable("## Summary", ["Metric", "Value"], summaryRows, "No summary data."),
    "",
    markdownTable(
      "## Most Uncertain Bands",
      ["Risk", "Division", "Ranks", "Fighters", "Spread", "Max Adj Gap", "Max Sensitivity", "Interpretation"],
      bandRows,
      "No close-score bands detected.",
    ),
    "",
    markdownTable(
      "## Most Uncertain Fighters",
      ["Uncertainty", "Division", "Rank", "Fighter", "Nearest Gap", "Gap Above", "Gap Below", "Max Sensitivity", "Worst Component"],
      fighterRows,
      "No unstable fighters detected.",
    ),
    "",
    markdownTable(
      "## Close Adjacent Pairs",
      ["Band", "Risk", "Division", "Higher", "Lower", "Final Gap", "Model Gap", "Policy Gap", "Max Sensitivity"],
      pairRows,
      "No close adjacent pairs detected.",
    ),
    "",
    markdownTable(
      "## Division Band Counts",
      ["Division", "Bands", "High-Risk Bands", "Virtual-Tie Pairs", "Close Pairs", "First Band"],
      divisionRows,
      "No division bands detected.",
    ),
    "",
    "## How To Read This",
    "",
    "- A `virtual_tie` means adjacent fighters are within the smallest score band; rank order should be treated as provisional.",
    "- A `close` pair means the order has some signal but should not drive aggressive tuning by itself.",
    "- `Max sensitivity` comes from diagnostics and shows how far a fighter can move under small local component changes.",
    "",
  ].join("\n");
}

function compareBands(a, b) {
  return (
    RISK_RANK[b.risk] - RISK_RANK[a.risk] ||
    b.max_sensitivity_move - a.max_sensitivity_move ||
    a.score_spread - b.score_spread ||
    a.start_rank - b.start_rank
  );
}

function compareUncertainFighters(a, b) {
  return (
    uncertaintyRank(b.uncertainty) - uncertaintyRank(a.uncertainty) ||
    b.max_sensitivity_move - a.max_sensitivity_move ||
    num(a.nearest_gap) - num(b.nearest_gap) ||
    a.rank - b.rank
  );
}

function uncertaintyRank(value) {
  if (value === "fragile") return 4;
  if (value === "virtual_tie") return 3;
  if (value === "sensitive") return 2;
  if (value === "close") return 1;
  return 0;
}

function totalPolicyAdjustment(fighter) {
  return round(num(fighter.final_score) - num(fighter.model_score));
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
    } else if (arg.startsWith("--diagnostics=")) {
      args.diagnosticsPath = arg.slice("--diagnostics=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--markdown-out=")) {
      args.markdownOutPath = arg.slice("--markdown-out=".length);
    } else if (arg.startsWith("--tie-threshold=")) {
      args.tieThreshold = Number(arg.slice("--tie-threshold=".length));
    } else if (arg.startsWith("--close-threshold=")) {
      args.closeThreshold = Number(arg.slice("--close-threshold=".length));
    } else if (arg.startsWith("--rank-limit=")) {
      args.rankLimit = Number(arg.slice("--rank-limit=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.tieThreshold) || args.tieThreshold < 0) {
    throw new Error("--tie-threshold must be a non-negative number.");
  }
  if (!Number.isFinite(args.closeThreshold) || args.closeThreshold < args.tieThreshold) {
    throw new Error("--close-threshold must be greater than or equal to --tie-threshold.");
  }
  if (!Number.isInteger(args.rankLimit) || args.rankLimit < 2) {
    throw new Error("--rank-limit must be an integer of at least 2.");
  }

  return args;
}

function printHelp() {
  console.log(`Generate close-score bands for OctagonRank rankings.

Usage:
  npm run model:bands
  node scripts/score-bands.mjs --rankings=data/model/rankings.json --diagnostics=data/model/diagnostics.json

Options:
  --rankings=PATH         Generated rankings JSON path.
  --diagnostics=PATH      Generated diagnostics JSON path.
  --out=PATH              Score-band JSON output path.
  --markdown-out=PATH     Score-band Markdown output path.
  --tie-threshold=N       Final-score gap for virtual ties. Default: 3.
  --close-threshold=N     Final-score gap for close pairs. Default: 8.
  --rank-limit=N          Ranked fighters per division to inspect. Default: 15.
`);
}

function printSummary(report, args) {
  console.log(`Wrote score bands to ${args.outPath}`);
  console.log(`Wrote score-band review to ${args.markdownOutPath}`);
  console.log(`virtual_tie_pairs: ${report.summary.virtual_tie_pairs}`);
  console.log(`close_pairs: ${report.summary.close_pairs}`);
  console.log(`score_bands: ${report.summary.score_bands}`);
  console.log(`high_risk_bands: ${report.summary.high_risk_bands}`);
}

function markdownTable(title, headers, rows, emptyText) {
  if (!rows.length) return [title, "", emptyText].join("\n");
  const headerLine = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`);
  return [title, "", headerLine, separatorLine, ...rowLines].join("\n");
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
  return parsed.toFixed(2);
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
