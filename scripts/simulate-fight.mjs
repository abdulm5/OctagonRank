#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  outPath: "data/model/simulation.json",
  markdownOutPath: "data/model/simulation.md",
  division: "",
  winner: "",
  loser: "",
  method: "Decision - Unanimous",
  round: "",
  performance: "competitive",
  titleFight: false,
  noTitleTransfer: false,
  kFactor: "",
};

const METHOD_MULTIPLIERS = [
  [/decision - split/i, 0.75, "Split decision"],
  [/decision - majority/i, 0.85, "Majority decision"],
  [/decision - unanimous/i, 1.0, "Unanimous decision"],
  [/submission/i, 1.1, "Submission finish"],
  [/ko\/tko/i, 1.12, "KO/TKO finish"],
  [/doctor/i, 0.8, "Doctor stoppage"],
  [/could not continue/i, 0.6, "Could not continue"],
  [/dq/i, 0.35, "Disqualification"],
];

const PERFORMANCE_PROFILES = {
  close: {
    multiplier: 0.82,
    dominance_score: 54,
    label: "Close or low-confidence win",
  },
  competitive: {
    multiplier: 1,
    dominance_score: 61,
    label: "Competitive but clear win",
  },
  clear: {
    multiplier: 1.12,
    dominance_score: 70,
    label: "Clear win",
  },
  dominant: {
    multiplier: 1.25,
    dominance_score: 82,
    label: "Dominant win",
  },
};

const TITLE_CONTEXT_PRE_FIGHT_POINTS = {
  recent_champion: 20,
  recent_title_loser: 16,
  interim_champion: 14,
  recent_title_challenger: 8,
  former_champion: 6,
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
  validateArgs(args);

  const rankings = await readJson(path.resolve(process.cwd(), args.rankingsPath));
  const division = findDivision(rankings, args);
  const winner = findFighter(division, args.winner, "--winner");
  const loser = findFighter(division, args.loser, "--loser");
  if (normalizeName(winner.fighter_name) === normalizeName(loser.fighter_name)) {
    throw new Error("--winner and --loser must be different fighters.");
  }

  const simulation = simulateFight({ rankings, division, winner, loser, args });
  const outputPath = path.resolve(process.cwd(), args.outPath);
  const markdownPath = path.resolve(process.cwd(), args.markdownOutPath);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await Promise.all([
    writeJson(outputPath, simulation),
    fs.writeFile(markdownPath, buildMarkdown(simulation)),
  ]);

  printSummary(simulation, args);
}

function simulateFight({ rankings, division, winner, loser, args }) {
  const method = getMethod(args.method);
  const performance = getPerformance(args.performance);
  const roundNumber = args.round ? Number(args.round) : "";
  const kFactor = Number(args.kFactor || rankings.model_settings?.k_factor || 32);
  const titleTransferEnabled = !args.noTitleTransfer;
  const isTitleFight = args.titleFight || winner.current_status === "Champion" || loser.current_status === "Champion";
  const championChangesHands = titleTransferEnabled && isTitleFight && loser.current_status === "Champion";

  const winnerBasis = getRatingBasis(winner);
  const loserBasis = getRatingBasis(loser);
  const winnerContext = calculatePreFightContext(winner);
  const loserContext = calculatePreFightContext(loser);
  const rawExpectedWinner = expectedScore(winnerBasis, loserBasis);
  const expectedWinner = expectedScore(winnerBasis + winnerContext.adjustment, loserBasis + loserContext.adjustment);
  const baseRatingChange = kFactor * (1 - expectedWinner);
  const roundMultiplier = calculateRoundMultiplier({ method: args.method, roundNumber });
  const ratingChange = round(
    clamp(baseRatingChange * method.multiplier * performance.multiplier * roundMultiplier, 2, 48),
    2,
  );

  const projectedRankings = buildProjectedRankings({
    division,
    winner,
    loser,
    ratingChange,
    championChangesHands,
  });
  const winnerProjection = projectedRankings.find((fighter) => fighter.fighter_name === winner.fighter_name);
  const loserProjection = projectedRankings.find((fighter) => fighter.fighter_name === loser.fighter_name);

  return {
    generated_at: new Date().toISOString(),
    rankings_path: args.rankingsPath,
    rankings_as_of: rankings.as_of,
    rankings_model_version: rankings.model_version,
    simulation_type: "single_fight_snapshot_projection",
    methodology_note:
      "This is a snapshot simulator. It applies a transparent hypothetical fight delta to the latest generated rankings; it does not rewrite the historical fight dataset or rerun every downstream policy rule.",
    input: {
      division: division.division,
      winner: winner.fighter_name,
      loser: loser.fighter_name,
      method: args.method,
      round: roundNumber,
      performance: args.performance,
      title_fight: isTitleFight,
      title_transfer_enabled: titleTransferEnabled,
      k_factor: kFactor,
    },
    fight_projection: {
      winner: winner.fighter_name,
      loser: loser.fighter_name,
      method: args.method,
      method_multiplier: method.multiplier,
      method_reason: method.reason,
      performance_multiplier: performance.multiplier,
      performance_reason: performance.label,
      round_multiplier: roundMultiplier,
      raw_expected_winner_probability: round(rawExpectedWinner, 4),
      expected_winner_probability: round(expectedWinner, 4),
      expected_loser_probability: round(1 - expectedWinner, 4),
      contextual_rating_gap: round(winnerBasis + winnerContext.adjustment - (loserBasis + loserContext.adjustment), 2),
      winner_context_adjustment: winnerContext.adjustment,
      winner_context_reasons: winnerContext.reasons,
      loser_context_adjustment: loserContext.adjustment,
      loser_context_reasons: loserContext.reasons,
      base_rating_change: round(baseRatingChange, 2),
      projected_rating_change: ratingChange,
      champion_changes_hands: championChangesHands,
    },
    fighter_impacts: [
      buildFighterImpact({ original: winner, projected: winnerProjection, scoreChange: ratingChange, result: "W" }),
      buildFighterImpact({ original: loser, projected: loserProjection, scoreChange: -ratingChange, result: "L" }),
    ],
    projected_division: {
      division: division.division,
      champion: championChangesHands ? winner.fighter_name : division.champion,
      previous_champion: division.champion,
      rankings: projectedRankings,
    },
  };
}

function buildProjectedRankings({ division, winner, loser, ratingChange, championChangesHands }) {
  const winnerName = normalizeName(winner.fighter_name);
  const loserName = normalizeName(loser.fighter_name);
  const projected = (division.rankings ?? []).map((fighter) => {
    const isWinner = normalizeName(fighter.fighter_name) === winnerName;
    const isLoser = normalizeName(fighter.fighter_name) === loserName;
    const modelChange = isWinner ? ratingChange : isLoser ? -ratingChange : 0;
    const currentModelScore = num(fighter.model_score);
    const currentFinalScore = num(fighter.final_score);
    const projectedModelScore = round(currentModelScore + modelChange, 2);
    const policy = calculateProjectedPolicy({ fighter, isWinner, isLoser, championChangesHands });
    const projectedFinalScore = round(projectedModelScore + policy.projectedPolicyAdjustment, 2);

    return {
      fighter_id: fighter.fighter_id,
      fighter_name: fighter.fighter_name,
      previous_rank: fighter.rank,
      projected_rank: null,
      rank_delta: 0,
      current_status: fighter.current_status,
      projected_status: policy.projectedStatus,
      current_final_score: currentFinalScore,
      projected_final_score: projectedFinalScore,
      final_score_change: round(projectedFinalScore - currentFinalScore, 2),
      current_model_score: currentModelScore,
      projected_model_score: projectedModelScore,
      model_score_change: modelChange,
      current_policy_adjustment: round(currentFinalScore - currentModelScore, 2),
      projected_policy_adjustment: policy.projectedPolicyAdjustment,
      policy_adjustment_change: policy.policyAdjustmentChange,
      championship_transfer_adjustment: 0,
      simulation_result: isWinner ? "W" : isLoser ? "L" : "",
      projection_notes: policy.notes,
      score_confidence: "",
      score_confidence_label: "",
      score_gap_above: null,
      score_gap_below: null,
      nearest_score_gap: null,
    };
  });

  if (championChangesHands) {
    applyTitleLoserGuard(projected, loserName);
    applyChampionTransfer(projected, winnerName);
  }

  return addProjectionConfidence(
    projected
      .sort((a, b) => b.projected_final_score - a.projected_final_score)
      .map((fighter, index) => ({
        ...fighter,
        projected_rank: index + 1,
        rank_delta: Number(fighter.previous_rank) - (index + 1),
      })),
  );
}

function applyTitleLoserGuard(projected, loserName) {
  const loserRow = projected.find((fighter) => normalizeName(fighter.fighter_name) === loserName);
  const sorted = [...projected].sort((a, b) => b.projected_final_score - a.projected_final_score);
  const currentRank = sorted.indexOf(loserRow) + 1;
  if (currentRank > 0 && currentRank <= 2) return;

  const target = sorted[Math.min(1, sorted.length - 1)];
  if (!target || target === loserRow) return;

  const adjustment = round(target.projected_final_score - loserRow.projected_final_score + 1.5, 2);
  if (adjustment <= 0) return;

  loserRow.projected_policy_adjustment = round(loserRow.projected_policy_adjustment + adjustment, 2);
  loserRow.policy_adjustment_change = round(loserRow.policy_adjustment_change + adjustment, 2);
  loserRow.projected_final_score = round(loserRow.projected_final_score + adjustment, 2);
  loserRow.final_score_change = round(loserRow.projected_final_score - loserRow.current_final_score, 2);
  loserRow.projection_notes.push(`recent_title_loser_guard:+${adjustment}`);
}

function applyChampionTransfer(projected, winnerName) {
  const winnerRow = projected.find((fighter) => normalizeName(fighter.fighter_name) === winnerName);
  const bestOtherScore = Math.max(
    ...projected
      .filter((fighter) => normalizeName(fighter.fighter_name) !== winnerName)
      .map((fighter) => fighter.projected_final_score),
  );
  const neededAdjustment = round(bestOtherScore - winnerRow.projected_final_score + 3, 2);
  if (neededAdjustment <= 0) return;

  winnerRow.championship_transfer_adjustment = round(winnerRow.championship_transfer_adjustment + neededAdjustment, 2);
  winnerRow.projected_policy_adjustment = round(winnerRow.projected_policy_adjustment + neededAdjustment, 2);
  winnerRow.policy_adjustment_change = round(winnerRow.policy_adjustment_change + neededAdjustment, 2);
  winnerRow.projected_final_score = round(winnerRow.projected_final_score + neededAdjustment, 2);
  winnerRow.final_score_change = round(winnerRow.projected_final_score - winnerRow.current_final_score, 2);
  winnerRow.projection_notes.push(`champion_transfer:+${neededAdjustment}`);
}

function calculateProjectedPolicy({ fighter, isWinner, isLoser, championChangesHands }) {
  const currentPolicyAdjustment = round(num(fighter.final_score) - num(fighter.model_score), 2);
  let projectedPolicyAdjustment = currentPolicyAdjustment;
  let projectedStatus = fighter.current_status;
  const notes = [];

  if (championChangesHands && isWinner) {
    projectedStatus = "Projected champion";
    notes.push("title_fight_win");
  }

  if (championChangesHands && isLoser) {
    const removedChampionPolicy = num(fighter.current_context_prior) + num(fighter.title_guard_adjustment);
    projectedPolicyAdjustment = round(Math.max(0, currentPolicyAdjustment - removedChampionPolicy) + 54.5, 2);
    projectedStatus = "Projected recent title loser";
    notes.push(`champion_policy_removed:-${round(removedChampionPolicy, 2)}`);
    notes.push("contender_prior:+54.5");
  }

  return {
    projectedPolicyAdjustment,
    projectedStatus,
    policyAdjustmentChange: round(projectedPolicyAdjustment - currentPolicyAdjustment, 2),
    notes,
  };
}

function addProjectionConfidence(rows) {
  return rows.map((fighter, index) => {
    const above = rows[index - 1];
    const below = rows[index + 1];
    const gapAbove = above ? round(above.projected_final_score - fighter.projected_final_score, 2) : null;
    const gapBelow = below ? round(fighter.projected_final_score - below.projected_final_score, 2) : null;
    const finiteGaps = [gapAbove, gapBelow].filter((value) => Number.isFinite(value));
    const nearest = finiteGaps.length ? Math.min(...finiteGaps) : null;
    const confidence =
      nearest === null ? "clear" : nearest <= 3 ? "virtual_tie" : nearest <= 8 ? "close" : "clear";

    return {
      ...fighter,
      score_gap_above: gapAbove,
      score_gap_below: gapBelow,
      nearest_score_gap: nearest,
      score_confidence: confidence,
      score_confidence_label:
        confidence === "virtual_tie" ? "Virtual tie" : confidence === "close" ? "Close score" : "Clear separation",
    };
  });
}

function calculatePreFightContext(fighter) {
  const reasons = [];
  let adjustment = 0;

  const titleContext = fighter.title_context_status;
  if (titleContext && TITLE_CONTEXT_PRE_FIGHT_POINTS[titleContext]) {
    adjustment += TITLE_CONTEXT_PRE_FIGHT_POINTS[titleContext];
    reasons.push(`title_context:${titleContext}`);
  }

  const eliteScore = num(fighter.elite_resume_score);
  if (eliteScore >= 70) {
    adjustment += 16;
    reasons.push("elite_resume:long_term_elite");
  } else if (eliteScore >= 50) {
    adjustment += 11;
    reasons.push("elite_resume:elite");
  } else if (eliteScore >= 35) {
    adjustment += 7;
    reasons.push("elite_resume:proven_elite");
  }

  const recentRecord = parseRecord(fighter.recent_record_30m);
  const recordAdjustment = clamp((recentRecord.wins - recentRecord.losses) * 4, -14, 14);
  if (recordAdjustment !== 0) {
    adjustment += recordAdjustment;
    reasons.push(`recent_record:${fighter.recent_record_30m}`);
  }

  const recentTrendAdjustment = clamp(num(fighter.recent_rating_change_30m) * 0.12, -18, 18);
  if (Math.abs(recentTrendAdjustment) >= 1) {
    adjustment += recentTrendAdjustment;
    reasons.push(`recent_trend:${round(num(fighter.recent_rating_change_30m), 2)}`);
  }

  const monthsInactive = num(fighter.months_inactive);
  if (monthsInactive <= 6) {
    adjustment += 4;
    reasons.push("recent_activity");
  } else if (monthsInactive > 18) {
    adjustment -= 10;
    reasons.push(`inactivity:${round(monthsInactive, 1)}m`);
  } else if (monthsInactive > 12) {
    adjustment -= 5;
    reasons.push(`inactivity:${round(monthsInactive, 1)}m`);
  }

  const legacyDrag = clamp(num(fighter.legacy_penalty) * 0.2, 0, 10);
  if (legacyDrag > 0) {
    adjustment -= legacyDrag;
    reasons.push(`legacy_drag:${round(legacyDrag, 2)}`);
  }

  return {
    adjustment: round(clamp(adjustment, -50, 35), 2),
    reasons,
  };
}

function buildFighterImpact({ original, projected, scoreChange, result }) {
  return {
    fighter_name: original.fighter_name,
    result,
    previous_rank: original.rank,
    projected_rank: projected.projected_rank,
    rank_delta: projected.rank_delta,
    current_final_score: projected.current_final_score,
    projected_final_score: projected.projected_final_score,
    final_score_change: projected.final_score_change,
    model_score_change: scoreChange,
    current_status: original.current_status,
    projected_status: projected.projected_status,
    projection_notes: projected.projection_notes,
  };
}

function buildMarkdown(simulation) {
  const fight = simulation.fight_projection;
  const winner = simulation.fighter_impacts.find((fighter) => fighter.result === "W");
  const loser = simulation.fighter_impacts.find((fighter) => fighter.result === "L");
  const rows = simulation.projected_division.rankings.slice(0, 15);

  return `# OctagonRank Fight Simulation

Generated at: \`${simulation.generated_at}\`
Rankings as of: \`${simulation.rankings_as_of}\`
Division: \`${simulation.input.division}\`

${simulation.methodology_note}

## Fight Input

${fight.winner} def. ${fight.loser} by ${fight.method}${simulation.input.round ? `, round ${simulation.input.round}` : ""}.

- Performance: ${simulation.input.performance} (${fight.performance_reason})
- Title fight: ${simulation.input.title_fight ? "yes" : "no"}
- Champion changes hands: ${fight.champion_changes_hands ? "yes" : "no"}

## Model Impact

- Raw expected winner probability: ${percent(fight.raw_expected_winner_probability)}
- Context-adjusted winner probability: ${percent(fight.expected_winner_probability)}
- Contextual rating gap: ${signed(fight.contextual_rating_gap)}
- Base rating change: ${signed(fight.base_rating_change)}
- Projected model-score change: ${signed(fight.projected_rating_change)}
- Method multiplier: ${fight.method_multiplier} (${fight.method_reason})
- Performance multiplier: ${fight.performance_multiplier}
- Round multiplier: ${fight.round_multiplier}
- Winner context: ${formatReasons(fight.winner_context_reasons, fight.winner_context_adjustment)}
- Loser context: ${formatReasons(fight.loser_context_reasons, fight.loser_context_adjustment)}

## Fighter Movement

| Fighter | Result | Rank | Model Change | Final Score Change | Status |
| --- | --- | --- | ---: | ---: | --- |
| ${winner.fighter_name} | W | ${rankMove(winner)} | ${signed(winner.model_score_change)} | ${signed(winner.final_score_change)} | ${winner.projected_status} |
| ${loser.fighter_name} | L | ${rankMove(loser)} | ${signed(loser.model_score_change)} | ${signed(loser.final_score_change)} | ${loser.projected_status} |

## Projected Rankings

| Rank | Move | Fighter | Projected Score | Score Change | Confidence | Notes |
| --- | ---: | --- | ---: | ---: | --- | --- |
${rows
  .map(
    (fighter) =>
      `| ${fighter.projected_rank} | ${signedRankDelta(fighter.rank_delta)} | ${fighter.fighter_name} | ${fmt(
        fighter.projected_final_score,
      )} | ${signed(fighter.final_score_change)} | ${fighter.score_confidence_label} | ${fighter.projection_notes.join("; ")} |`,
  )
  .join("\n")}
`;
}

function findDivision(rankings, args) {
  const divisions = rankings.divisions ?? [];
  if (args.division) {
    const division = divisions.find((entry) => normalizeName(entry.division) === normalizeName(args.division));
    if (!division) throw new Error(`Unknown division: ${args.division}`);
    return division;
  }

  const matches = divisions.filter((division) => {
    const names = new Set((division.rankings ?? []).map((fighter) => normalizeName(fighter.fighter_name)));
    return names.has(normalizeName(args.winner)) && names.has(normalizeName(args.loser));
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Multiple divisions contain those fighters. Pass --division. Matches: ${matches.map((d) => d.division).join(", ")}`);
  }
  throw new Error("Could not infer division. Pass --division with fighters from that generated ranking pool.");
}

function findFighter(division, fighterName, argName) {
  const normalizedTarget = normalizeName(fighterName);
  const exact = (division.rankings ?? []).find((fighter) => normalizeName(fighter.fighter_name) === normalizedTarget);
  if (exact) return exact;

  const partial = (division.rankings ?? []).filter((fighter) => normalizeName(fighter.fighter_name).includes(normalizedTarget));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(`${argName} is ambiguous in ${division.division}: ${partial.map((fighter) => fighter.fighter_name).join(", ")}`);
  }
  throw new Error(`${argName} fighter not found in ${division.division}: ${fighterName}`);
}

function getRatingBasis(fighter) {
  return num(fighter.model_score || fighter.base_rating || fighter.final_score);
}

function getMethod(methodName) {
  const match = METHOD_MULTIPLIERS.find(([pattern]) => pattern.test(methodName ?? ""));
  if (!match) {
    return {
      multiplier: 1,
      reason: "Generic result",
    };
  }
  return {
    multiplier: match[1],
    reason: match[2],
  };
}

function getPerformance(performanceName) {
  const profile = PERFORMANCE_PROFILES[normalizeName(performanceName).replaceAll(" ", "_")];
  if (!profile) {
    throw new Error(`Unknown --performance value: ${performanceName}. Use close, competitive, clear, or dominant.`);
  }
  return profile;
}

function calculateRoundMultiplier({ method, roundNumber }) {
  if (!isFinish(method) || !Number.isFinite(roundNumber)) return 1;
  if (roundNumber <= 1) return 1.08;
  if (roundNumber === 2) return 1.05;
  if (roundNumber === 3) return 1.02;
  if (roundNumber === 4) return 1;
  return 0.97;
}

function isFinish(methodName) {
  return /ko\/tko|submission|doctor|could not continue|dq/i.test(methodName ?? "");
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing rankings file: ${filePath}. Run npm run model:rankings first.`);
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--title-fight") {
      args.titleFight = true;
    } else if (arg === "--no-title-transfer") {
      args.noTitleTransfer = true;
    } else if (arg === "--rankings") {
      args.rankingsPath = readNextArg(argv, ++index, arg);
    } else if (arg === "--out") {
      args.outPath = readNextArg(argv, ++index, arg);
    } else if (arg === "--markdown-out") {
      args.markdownOutPath = readNextArg(argv, ++index, arg);
    } else if (arg === "--division") {
      args.division = readNextArg(argv, ++index, arg);
    } else if (arg === "--winner") {
      args.winner = readNextArg(argv, ++index, arg);
    } else if (arg === "--loser") {
      args.loser = readNextArg(argv, ++index, arg);
    } else if (arg === "--method") {
      args.method = readNextArg(argv, ++index, arg);
    } else if (arg === "--round") {
      args.round = readNextArg(argv, ++index, arg);
    } else if (arg === "--performance") {
      args.performance = readNextArg(argv, ++index, arg);
    } else if (arg === "--k-factor") {
      args.kFactor = readNextArg(argv, ++index, arg);
    } else if (arg.startsWith("--rankings=")) {
      args.rankingsPath = arg.slice("--rankings=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--markdown-out=")) {
      args.markdownOutPath = arg.slice("--markdown-out=".length);
    } else if (arg.startsWith("--division=")) {
      args.division = arg.slice("--division=".length);
    } else if (arg.startsWith("--winner=")) {
      args.winner = arg.slice("--winner=".length);
    } else if (arg.startsWith("--loser=")) {
      args.loser = arg.slice("--loser=".length);
    } else if (arg.startsWith("--method=")) {
      args.method = arg.slice("--method=".length);
    } else if (arg.startsWith("--round=")) {
      args.round = arg.slice("--round=".length);
    } else if (arg.startsWith("--performance=")) {
      args.performance = arg.slice("--performance=".length);
    } else if (arg.startsWith("--k-factor=")) {
      args.kFactor = arg.slice("--k-factor=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readNextArg(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

function validateArgs(args) {
  if (!args.winner) throw new Error("Missing required --winner=NAME.");
  if (!args.loser) throw new Error("Missing required --loser=NAME.");
  if (args.round && (!Number.isFinite(Number(args.round)) || Number(args.round) < 1 || Number(args.round) > 5)) {
    throw new Error("--round must be a number from 1 to 5.");
  }
  if (args.kFactor && (!Number.isFinite(Number(args.kFactor)) || Number(args.kFactor) <= 0)) {
    throw new Error("--k-factor must be a positive number.");
  }
}

function printHelp() {
  console.log(`Simulate a hypothetical fight against the latest generated OctagonRank snapshot.

Usage:
  npm run model:simulate -- --division=Lightweight --winner="Arman Tsarukyan" --loser="Justin Gaethje" --method=Submission --round=3 --performance=clear --title-fight
  npm run model:simulate -- --division "Light Heavyweight" --winner "Khalil Rountree Jr." --loser "Carlos Ulberg" --method "KO/TKO" --round 2 --performance dominant --title-fight

Options:
  --rankings=PATH       Rankings JSON path. Default: data/model/rankings.json
  --out=PATH            JSON output path. Default: data/model/simulation.json
  --markdown-out=PATH   Markdown output path. Default: data/model/simulation.md
  --division=NAME       Division to simulate inside. Optional when both fighters uniquely share a division.
  --winner=NAME         Required winner name from the generated ranking pool.
  --loser=NAME          Required loser name from the generated ranking pool.
  --method=METHOD       Decision - Unanimous, Decision - Split, KO/TKO, Submission, etc.
  --round=NUMBER        Finish round, 1-5. Only affects finish simulations.
  --performance=LEVEL   close, competitive, clear, or dominant. Default: competitive.
  --title-fight         Treat the fight as a title fight.
  --no-title-transfer   Keep champion-transfer policy disabled even if the champion loses.
  --k-factor=NUMBER     Override model k-factor for the simulation.
`);
}

function printSummary(simulation, args) {
  const winner = simulation.fighter_impacts.find((fighter) => fighter.result === "W");
  const loser = simulation.fighter_impacts.find((fighter) => fighter.result === "L");

  console.log(`Wrote simulation to ${args.outPath}`);
  console.log(`Wrote simulation review to ${args.markdownOutPath}`);
  console.log(
    `${winner.fighter_name}: #${winner.previous_rank} -> #${winner.projected_rank} (${signedRankDelta(
      winner.rank_delta,
    )}), model ${signed(winner.model_score_change)}, final ${signed(winner.final_score_change)}`,
  );
  console.log(
    `${loser.fighter_name}: #${loser.previous_rank} -> #${loser.projected_rank} (${signedRankDelta(
      loser.rank_delta,
    )}), model ${signed(loser.model_score_change)}, final ${signed(loser.final_score_change)}`,
  );
  console.log(`Projected rating change: ${signed(simulation.fight_projection.projected_rating_change)}`);
  console.log(`Expected winner probability: ${percent(simulation.fight_projection.expected_winner_probability)}`);
}

function parseRecord(record) {
  const match = String(record ?? "").match(/(\d+)-(\d+)/);
  if (!match) {
    return {
      wins: 0,
      losses: 0,
    };
  }
  return {
    wins: Number(match[1]),
    losses: Number(match[2]),
  };
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function signedRankDelta(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "0";
  return `${parsed > 0 ? "+" : ""}${parsed}`;
}

function rankMove(fighter) {
  return `#${fighter.previous_rank} -> #${fighter.projected_rank} (${signedRankDelta(fighter.rank_delta)})`;
}

function percent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return `${(parsed * 100).toFixed(1)}%`;
}

function formatReasons(reasons, adjustment) {
  if (!reasons.length) return `${signed(adjustment)} (none)`;
  return `${signed(adjustment)} (${reasons.join(", ")})`;
}
