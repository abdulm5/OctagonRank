#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  dataDir: "data/ufcstats",
  annotationsPath: "data/manual_annotations/ufc_fight_manual_annotations.csv",
  currentSnapshotPath: "data/ranking_inputs/current_division_snapshot.json",
  outDir: "data/model",
  initialRating: 1500,
  kFactor: 32,
  activeWindowMonths: 36,
  minDivisionFights: 2,
};

const CURRENT_DIVISIONS = [
  "Flyweight",
  "Bantamweight",
  "Featherweight",
  "Lightweight",
  "Welterweight",
  "Middleweight",
  "Light Heavyweight",
  "Heavyweight",
  "Women's Strawweight",
  "Women's Flyweight",
  "Women's Bantamweight",
];

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

const ANNOTATION_MULTIPLIERS = {
  controversial_decision: 0.7,
  injury_finish: 0.45,
  short_notice_fight: 0.85,
  weight_miss: 0.9,
  fighter_moving_divisions: 0.9,
  major_layoff: 0.9,
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

  const dataDir = path.resolve(process.cwd(), args.dataDir);
  const outDir = path.resolve(process.cwd(), args.outDir);
  await fs.mkdir(outDir, { recursive: true });

  const [summary, fights, fightStats, annotations, currentSnapshot] = await Promise.all([
    readJson(path.join(dataDir, "summary.json")),
    readJson(path.join(dataDir, "fights.json")),
    readJson(path.join(dataDir, "fight_fighter_stats.json")),
    readAnnotations(path.resolve(process.cwd(), args.annotationsPath)),
    readCurrentSnapshot(path.resolve(process.cwd(), args.currentSnapshotPath)),
  ]);

  const currentDivisionSet = new Set(CURRENT_DIVISIONS);
  const statsByFight = groupFightStats(fightStats);
  const annotationsByFight = new Map(annotations.map((annotation) => [annotation.fight_id, annotation]));
  const asOfDate = new Date(summary.end_date ?? latestDate(fights));

  const divisionRatings = new Map();
  const fightImpacts = [];
  let skipped = 0;

  const orderedFights = fights
    .filter((fight) => currentDivisionSet.has(fight.weight_class))
    .sort((a, b) => {
      const dateCompare = a.event_date.localeCompare(b.event_date);
      if (dateCompare !== 0) return dateCompare;
      return Number(a.fight_order ?? 0) - Number(b.fight_order ?? 0);
    });

  for (const fight of orderedFights) {
    const impact = processFight({
      fight,
      statsForFight: statsByFight.get(fight.fight_id),
      annotation: annotationsByFight.get(fight.fight_id),
      divisionRatings,
      args,
    });

    if (!impact) {
      skipped += 1;
      continue;
    }

    fightImpacts.push(impact);
  }

  const divisions = buildDivisionRankings({ divisionRatings, asOfDate, args, currentSnapshot });
  const fighterScores = divisions.flatMap((division) =>
    division.rankings.map((fighter) => ({
      division: division.division,
      rank: fighter.rank,
      current_status: fighter.current_status,
      fighter_id: fighter.fighter_id,
      fighter_name: fighter.fighter_name,
      final_score: fighter.final_score,
      raw_score: fighter.raw_score,
      current_context_adjustment: fighter.current_context_adjustment,
      base_rating: fighter.base_rating,
      inactivity_penalty: fighter.inactivity_penalty,
      ufc_division_fights: fighter.ufc_division_fights,
      division_record: fighter.division_record,
      last_fight_date: fighter.last_fight_date,
      months_inactive: fighter.months_inactive,
      average_dominance: fighter.average_dominance,
      best_win: fighter.best_win?.opponent_name ?? "",
      best_win_rating: fighter.best_win?.opponent_pre_rating ?? "",
    })),
  );

  const output = {
    model_version: "v0.2-current-context-elo",
    generated_at: new Date().toISOString(),
    as_of: toIsoDate(asOfDate),
    source: summary.source ?? "ufcstats.com",
    input_summary: {
      events: summary.event_count,
      fights: summary.fight_count,
      fighter_stat_rows: summary.fighter_stat_rows,
      annotations: annotations.length,
      current_snapshot_divisions: currentSnapshot?.divisions?.length ?? 0,
    },
    model_settings: {
      initial_rating: args.initialRating,
      k_factor: args.kFactor,
      active_window_months: args.activeWindowMonths,
      min_division_fights: args.minDivisionFights,
      current_divisions: CURRENT_DIVISIONS,
      current_snapshot_path: args.currentSnapshotPath,
    },
    methodology: {
      base_rating: "Division-specific Elo rating updated chronologically after each fight.",
      opponent_strength: "Built into Elo: beating a higher-rated opponent creates a larger rating gain.",
      method_multiplier: "Finishes and clean decisions move ratings more than split decisions, DQs, or weird stoppages.",
      dominance_multiplier: "Significant strike differential, knockdowns, takedowns, control time, and submission attempts adjust the size of the update.",
      result_confidence: "Manual annotations and low-repeatability stat patterns dampen noisy outcomes without deleting the official result.",
      inactivity_penalty: "Fighters keep rating value, but lose final-score confidence after 12 months without a fight.",
      current_context: "A current division snapshot anchors champions, transfers ratings for fighters who moved divisions, and limits rankings to the active ranked pool.",
    },
    divisions,
  };

  await Promise.all([
    writeJson(path.join(outDir, "rankings.json"), output),
    writeJson(path.join(outDir, "fight_impacts.json"), fightImpacts),
    writeJson(path.join(outDir, "summary.json"), {
      generated_at: output.generated_at,
      as_of: output.as_of,
      processed_fights: fightImpacts.length,
      skipped_fights: skipped,
      ranked_fighters: fighterScores.length,
      division_count: divisions.length,
      output_files: ["rankings.json", "fighter_scores.csv", "fight_impacts.json"],
    }),
    writeCsv(path.join(outDir, "fighter_scores.csv"), fighterScores),
    writeCsv(path.join(outDir, "fight_impacts.csv"), fightImpacts),
  ]);

  printRunSummary({ outDir, divisions, fightImpacts, skipped });
}

function processFight({ fight, statsForFight, annotation, divisionRatings, args }) {
  if (!fight.winner_fighter_id || fight.method === "Overturned") {
    return null;
  }

  const winnerId = fight.winner_fighter_id;
  const loserId = winnerId === fight.fighter_1_id ? fight.fighter_2_id : fight.fighter_1_id;
  if (!winnerId || !loserId) return null;

  const winnerName = winnerId === fight.fighter_1_id ? fight.fighter_1_name : fight.fighter_2_name;
  const loserName = winnerId === fight.fighter_1_id ? fight.fighter_2_name : fight.fighter_1_name;

  const division = getDivisionState(divisionRatings, fight.weight_class);
  const winner = getFighterState(division, winnerId, winnerName, fight.weight_class, args.initialRating);
  const loser = getFighterState(division, loserId, loserName, fight.weight_class, args.initialRating);

  const winnerPreRating = winner.rating;
  const loserPreRating = loser.rating;
  const expectedWinner = expectedScore(winnerPreRating, loserPreRating);
  const baseEloChange = args.kFactor * (1 - expectedWinner);

  const winnerStats = statsForFight?.get(winnerId);
  const loserStats = statsForFight?.get(loserId);
  const method = getMethodMultiplier(fight.method);
  const dominance = calculateDominance(winnerStats, loserStats);
  const annotationContext = getAnnotationContext(annotation);
  const repeatability = getRepeatabilityMultiplier(fight, dominance);
  const resultConfidence = clamp(annotationContext.multiplier * repeatability.multiplier, 0.25, 1.15);
  const totalMultiplier = method.multiplier * dominance.multiplier * resultConfidence;
  const ratingChange = round(baseEloChange * totalMultiplier, 2);

  winner.rating += ratingChange;
  loser.rating -= ratingChange;

  updateFighterAggregate({
    fighter: winner,
    opponent: loser,
    fight,
    isWinner: true,
    ratingChange,
    preRating: winnerPreRating,
    opponentPreRating: loserPreRating,
    stats: winnerStats,
    opponentStats: loserStats,
    dominanceScore: dominance.score,
  });

  updateFighterAggregate({
    fighter: loser,
    opponent: winner,
    fight,
    isWinner: false,
    ratingChange: -ratingChange,
    preRating: loserPreRating,
    opponentPreRating: winnerPreRating,
    stats: loserStats,
    opponentStats: winnerStats,
    dominanceScore: 100 - dominance.score,
  });

  return {
    fight_id: fight.fight_id,
    event_date: fight.event_date,
    event_name: fight.event_name,
    division: fight.weight_class,
    winner_id: winnerId,
    winner_name: winnerName,
    loser_id: loserId,
    loser_name: loserName,
    method: fight.method,
    winner_pre_rating: round(winnerPreRating, 2),
    loser_pre_rating: round(loserPreRating, 2),
    expected_winner: round(expectedWinner, 4),
    base_elo_change: round(baseEloChange, 2),
    method_multiplier: method.multiplier,
    method_reason: method.reason,
    dominance_score: dominance.score,
    dominance_multiplier: dominance.multiplier,
    result_confidence: resultConfidence,
    annotation_tags: annotationContext.tags.join("|"),
    repeatability_reason: repeatability.reason,
    final_rating_change: ratingChange,
    winner_post_rating: round(winner.rating, 2),
    loser_post_rating: round(loser.rating, 2),
  };
}

function buildDivisionRankings({ divisionRatings, asOfDate, args, currentSnapshot }) {
  const fighterIndex = buildFighterIndex(divisionRatings, asOfDate);
  const snapshotByDivision = new Map((currentSnapshot?.divisions ?? []).map((division) => [division.division, division]));

  return CURRENT_DIVISIONS.map((divisionName) => {
    const division = divisionRatings.get(divisionName);
    const fighters = Array.from(division?.values() ?? []);
    const snapshotDivision = snapshotByDivision.get(divisionName);
    const rawCandidates = fighters.map((fighter) =>
      makeCandidate({
        fighter,
        displayDivision: divisionName,
        sourceDivision: divisionName,
        asOfDate,
        args,
      }),
    );

    const rankings = snapshotDivision
      ? buildCurrentSnapshotRankings({
          snapshotDivision,
          rawCandidates,
          fighterIndex,
          divisionName,
          asOfDate,
          args,
        })
      : rawCandidates
          .filter((fighter) => fighter.eligible)
          .sort((a, b) => b.final_score - a.final_score)
          .map((fighter, index) => ({ ...fighter, rank: index + 1 }));

    return {
      division: divisionName,
      champion: snapshotDivision?.champion ?? null,
      current_snapshot_source: snapshotDivision?.source ?? null,
      ranked_count: rankings.length,
      rankings,
    };
  });
}

function buildCurrentSnapshotRankings({ snapshotDivision, rawCandidates, fighterIndex, divisionName, asOfDate, args }) {
  const rawByName = new Map(rawCandidates.map((candidate) => [normalizeName(candidate.fighter_name), candidate]));
  const maxRawScore = rawCandidates.reduce((max, candidate) => Math.max(max, candidate.final_score), args.initialRating);
  const championFloor = Math.max(1725, maxRawScore + 30);
  const snapshotEntries = [
    {
      name: snapshotDivision.champion,
      currentStatus: "Champion",
      snapshotRank: 0,
      floor: championFloor,
    },
    ...snapshotDivision.rankings.map((name, index) => ({
      name,
      currentStatus: `Contender #${index + 1}`,
      snapshotRank: index + 1,
      floor: championFloor - 35 - index * 6,
    })),
  ];

  return snapshotEntries
    .map((entry) => {
      const normalizedName = normalizeName(entry.name);
      const currentDivisionCandidate = rawByName.get(normalizedName);
      const indexedFighter = fighterIndex.get(normalizedName);
      const transferCandidate = indexedFighter
        ? makeCandidate({
            fighter: indexedFighter.fighter,
            displayDivision: divisionName,
            sourceDivision: indexedFighter.division,
            asOfDate,
            args,
            transferPenalty: indexedFighter.division === divisionName ? 0 : 25,
          })
        : null;
      const baseCandidate = chooseBestCandidate(currentDivisionCandidate, transferCandidate) ??
        makeSyntheticCandidate({
          name: entry.name,
          divisionName,
          args,
        });

      const rawScore = baseCandidate.final_score;
      const finalScore = Math.max(rawScore, entry.floor);
      return {
        ...baseCandidate,
        fighter_name: entry.name,
        eligible: true,
        current_status: entry.currentStatus,
        current_snapshot_rank: entry.snapshotRank,
        current_snapshot_floor: round(entry.floor, 2),
        current_context_adjustment: round(finalScore - rawScore, 2),
        raw_score: round(rawScore, 2),
        final_score: round(finalScore, 2),
      };
    })
    .sort((a, b) => {
      const statusCompare = Number(b.current_status === "Champion") - Number(a.current_status === "Champion");
      if (statusCompare !== 0) return statusCompare;
      return b.final_score - a.final_score;
    })
    .map((fighter, index) => ({ ...fighter, rank: index + 1 }));
}

function chooseBestCandidate(...candidates) {
  return candidates
    .filter(Boolean)
    .sort((a, b) => b.final_score - a.final_score)[0];
}

function makeCandidate({ fighter, displayDivision, sourceDivision, asOfDate, args, transferPenalty = 0 }) {
  const monthsInactive = monthsBetween(new Date(fighter.lastFightDate), asOfDate);
  const inactivityPenalty = calculateInactivityPenalty(monthsInactive);
  const baseRating = fighter.rating - transferPenalty;
  const finalScore = baseRating - inactivityPenalty;
  const averageDominance = fighter.dominanceSamples > 0 ? fighter.dominanceTotal / fighter.dominanceSamples : 50;
  const eligible =
    fighter.fights >= args.minDivisionFights && monthsInactive <= args.activeWindowMonths && fighter.lastFightDate;

  return {
    fighter_id: fighter.fighterId,
    fighter_name: fighter.name,
    rank: null,
    eligible,
    current_status: "Model ranked",
    current_context_adjustment: 0,
    raw_score: round(finalScore, 2),
    final_score: round(finalScore, 2),
    base_rating: round(baseRating, 2),
    source_division: sourceDivision,
    display_division: displayDivision,
    division_transfer_penalty: transferPenalty,
    inactivity_penalty: round(inactivityPenalty, 2),
    ufc_division_fights: fighter.fights,
    division_record: `${fighter.wins}-${fighter.losses}`,
    wins: fighter.wins,
    losses: fighter.losses,
    finishes: fighter.finishes,
    last_fight_date: fighter.lastFightDate,
    months_inactive: round(monthsInactive, 1),
    average_dominance: round(averageDominance, 1),
    best_win: fighter.bestWin,
    last_five: fighter.lastFive.slice(-5).reverse(),
    totals: fighter.totals,
  };
}

function makeSyntheticCandidate({ name, divisionName, args }) {
  return {
    fighter_id: "",
    fighter_name: name,
    rank: null,
    eligible: true,
    current_status: "Current snapshot only",
    current_context_adjustment: 0,
    raw_score: args.initialRating,
    final_score: args.initialRating,
    base_rating: args.initialRating,
    source_division: divisionName,
    display_division: divisionName,
    division_transfer_penalty: 0,
    inactivity_penalty: 0,
    ufc_division_fights: 0,
    division_record: "0-0",
    wins: 0,
    losses: 0,
    finishes: 0,
    last_fight_date: "",
    months_inactive: 0,
    average_dominance: 50,
    best_win: null,
    last_five: [],
    totals: {
      knockdowns: 0,
      sig_strikes_landed: 0,
      sig_strikes_attempted: 0,
      sig_strikes_absorbed: 0,
      takedowns_landed: 0,
      takedowns_attempted: 0,
      submission_attempts: 0,
      control_seconds: 0,
    },
  };
}

function buildFighterIndex(divisionRatings, asOfDate) {
  const index = new Map();
  for (const [divisionName, fighters] of divisionRatings.entries()) {
    for (const fighter of fighters.values()) {
      const normalizedName = normalizeName(fighter.name);
      const monthsInactive = monthsBetween(new Date(fighter.lastFightDate), asOfDate);
      const score = fighter.rating - calculateInactivityPenalty(monthsInactive);
      const existing = index.get(normalizedName);
      if (!existing || score > existing.score) {
        index.set(normalizedName, {
          fighter,
          division: divisionName,
          score,
        });
      }
    }
  }
  return index;
}

function updateFighterAggregate({
  fighter,
  opponent,
  fight,
  isWinner,
  ratingChange,
  preRating,
  opponentPreRating,
  stats,
  opponentStats,
  dominanceScore,
}) {
  fighter.fights += 1;
  fighter.lastFightDate = fight.event_date;
  fighter.ratingHistory.push({
    fight_id: fight.fight_id,
    event_date: fight.event_date,
    opponent_name: opponent.name,
    pre_rating: round(preRating, 2),
    post_rating: round(fighter.rating, 2),
    rating_change: round(ratingChange, 2),
  });

  if (isWinner) {
    fighter.wins += 1;
    if (isFinish(fight.method)) fighter.finishes += 1;
    if (!fighter.bestWin || opponentPreRating > fighter.bestWin.opponent_pre_rating) {
      fighter.bestWin = {
        fight_id: fight.fight_id,
        event_date: fight.event_date,
        opponent_name: opponent.name,
        opponent_pre_rating: round(opponentPreRating, 2),
        method: fight.method,
      };
    }
  } else {
    fighter.losses += 1;
  }

  fighter.lastFive.push({
    date: fight.event_date,
    result: isWinner ? "W" : "L",
    opponent_name: opponent.name,
    method: fight.method,
    rating_change: round(ratingChange, 2),
  });

  fighter.dominanceTotal += dominanceScore;
  fighter.dominanceSamples += 1;

  if (stats) {
    fighter.totals.knockdowns += num(stats.knockdowns);
    fighter.totals.sig_strikes_landed += num(stats.sig_strikes_landed);
    fighter.totals.sig_strikes_attempted += num(stats.sig_strikes_attempted);
    fighter.totals.sig_strikes_absorbed += num(opponentStats?.sig_strikes_landed);
    fighter.totals.takedowns_landed += num(stats.takedowns_landed);
    fighter.totals.takedowns_attempted += num(stats.takedowns_attempted);
    fighter.totals.submission_attempts += num(stats.submission_attempts);
    fighter.totals.control_seconds += num(stats.control_seconds);
  }
}

function calculateDominance(winnerStats, loserStats) {
  if (!winnerStats || !loserStats) {
    return {
      score: 50,
      multiplier: 1,
      advantage: 0,
    };
  }

  const sigTotal = Math.max(1, num(winnerStats.sig_strikes_landed) + num(loserStats.sig_strikes_landed));
  const sigAdvantage = (num(winnerStats.sig_strikes_landed) - num(loserStats.sig_strikes_landed)) / sigTotal;
  const knockdownAdvantage = clamp((num(winnerStats.knockdowns) - num(loserStats.knockdowns)) * 0.16, -0.4, 0.4);
  const takedownAdvantage = clamp((num(winnerStats.takedowns_landed) - num(loserStats.takedowns_landed)) * 0.04, -0.18, 0.18);
  const submissionAdvantage = clamp((num(winnerStats.submission_attempts) - num(loserStats.submission_attempts)) * 0.04, -0.16, 0.16);
  const controlTotal = Math.max(1, num(winnerStats.control_seconds) + num(loserStats.control_seconds));
  const controlAdvantage =
    ((num(winnerStats.control_seconds) - num(loserStats.control_seconds)) / controlTotal) * 0.12;

  const advantage = clamp(
    sigAdvantage * 0.55 + knockdownAdvantage + takedownAdvantage + submissionAdvantage + controlAdvantage,
    -1,
    1,
  );

  return {
    score: round(50 + advantage * 50, 1),
    multiplier: round(clamp(1 + advantage * 0.25, 0.85, 1.15), 4),
    advantage: round(advantage, 4),
  };
}

function getRepeatabilityMultiplier(fight, dominance) {
  const finish = isFinish(fight.method);
  if (finish && dominance.advantage < -0.2) {
    return {
      multiplier: 0.8,
      reason: "Winner finished the fight despite trailing the stat profile.",
    };
  }

  if (finish && dominance.advantage < -0.1) {
    return {
      multiplier: 0.9,
      reason: "Winner finished the fight from a slightly negative stat profile.",
    };
  }

  return {
    multiplier: 1,
    reason: "",
  };
}

function getAnnotationContext(annotation) {
  if (!annotation) {
    return {
      multiplier: 1,
      tags: [],
    };
  }

  const tags = Object.keys(ANNOTATION_MULTIPLIERS).filter((key) => annotation[key] === true);
  const multiplier = tags.reduce((value, tag) => value * ANNOTATION_MULTIPLIERS[tag], 1);

  return {
    multiplier: round(clamp(multiplier, 0.35, 1), 4),
    tags,
  };
}

function calculateInactivityPenalty(monthsInactive) {
  if (!Number.isFinite(monthsInactive) || monthsInactive <= 12) return 0;
  return Math.min(85, (monthsInactive - 12) * 3);
}

function getMethodMultiplier(methodName) {
  const method = methodName ?? "";
  const match = METHOD_MULTIPLIERS.find(([pattern]) => pattern.test(method));
  if (!match) {
    return {
      multiplier: 1,
      reason: method || "Unknown method",
    };
  }

  return {
    multiplier: match[1],
    reason: match[2],
  };
}

function isFinish(methodName) {
  return /ko\/tko|submission|doctor|could not continue|dq/i.test(methodName ?? "");
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function groupFightStats(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.fight_id)) grouped.set(row.fight_id, new Map());
    grouped.get(row.fight_id).set(row.fighter_id, row);
  }
  return grouped;
}

function getDivisionState(divisionRatings, divisionName) {
  if (!divisionRatings.has(divisionName)) {
    divisionRatings.set(divisionName, new Map());
  }
  return divisionRatings.get(divisionName);
}

function getFighterState(division, fighterId, name, divisionName, initialRating) {
  if (!division.has(fighterId)) {
    division.set(fighterId, {
      fighterId,
      name,
      division: divisionName,
      rating: initialRating,
      fights: 0,
      wins: 0,
      losses: 0,
      finishes: 0,
      lastFightDate: null,
      lastFive: [],
      ratingHistory: [],
      bestWin: null,
      dominanceTotal: 0,
      dominanceSamples: 0,
      totals: {
        knockdowns: 0,
        sig_strikes_landed: 0,
        sig_strikes_attempted: 0,
        sig_strikes_absorbed: 0,
        takedowns_landed: 0,
        takedowns_attempted: 0,
        submission_attempts: 0,
        control_seconds: 0,
      },
    });
  }

  return division.get(fighterId);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    await fs.writeFile(filePath, "");
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ];
  await fs.writeFile(filePath, `${lines.join("\n")}\n`);
}

async function readAnnotations(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parseCsv(text).map((row) => ({
      ...row,
      controversial_decision: row.controversial_decision === "true",
      injury_finish: row.injury_finish === "true",
      short_notice_fight: row.short_notice_fight === "true",
      weight_miss: row.weight_miss === "true",
      fighter_moving_divisions: row.fighter_moving_divisions === "true",
      major_layoff: row.major_layoff === "true",
    }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readCurrentSnapshot(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...body] = rows;
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--data-dir=")) {
      args.dataDir = arg.slice("--data-dir=".length);
    } else if (arg.startsWith("--annotations=")) {
      args.annotationsPath = arg.slice("--annotations=".length);
    } else if (arg.startsWith("--current-snapshot=")) {
      args.currentSnapshotPath = arg.slice("--current-snapshot=".length);
    } else if (arg.startsWith("--out-dir=")) {
      args.outDir = arg.slice("--out-dir=".length);
    } else if (arg.startsWith("--initial-rating=")) {
      args.initialRating = Number(arg.slice("--initial-rating=".length));
    } else if (arg.startsWith("--k-factor=")) {
      args.kFactor = Number(arg.slice("--k-factor=".length));
    } else if (arg.startsWith("--active-window-months=")) {
      args.activeWindowMonths = Number(arg.slice("--active-window-months=".length));
    } else if (arg.startsWith("--min-division-fights=")) {
      args.minDivisionFights = Number(arg.slice("--min-division-fights=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Build explainable MMA rankings from scraped UFCStats data.

Usage:
  npm run model:rankings
  node scripts/build-rankings-model.mjs --data-dir=data/ufcstats --out-dir=data/model

Options:
  --data-dir=PATH                Scraped UFCStats output directory.
  --annotations=PATH             Manual annotation CSV path.
  --current-snapshot=PATH        Current champion/ranked-pool snapshot JSON path.
  --out-dir=PATH                 Output directory for model files.
  --initial-rating=NUMBER        Starting Elo rating per division.
  --k-factor=NUMBER              Elo update size.
  --active-window-months=NUMBER  Eligibility window since last fight.
  --min-division-fights=NUMBER   Minimum UFC fights in a division to rank.
`);
}

function printRunSummary({ outDir, divisions, fightImpacts, skipped }) {
  console.log(`Processed ${fightImpacts.length} fights and skipped ${skipped}.`);
  console.log(`Wrote model output to ${path.relative(process.cwd(), outDir)}`);
  console.log("");

  for (const division of divisions) {
    const topFive = division.rankings
      .slice(0, 5)
      .map((fighter) => `${fighter.rank}. ${fighter.fighter_name} (${fighter.final_score})`)
      .join("; ");
    console.log(`${division.division}: ${topFive || "no eligible fighters"}`);
  }
}

function latestDate(rows) {
  return rows.reduce((latest, row) => (row.event_date > latest ? row.event_date : latest), "1900-01-01");
}

function monthsBetween(startDate, endDate) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return Infinity;
  const days = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, days / 30.4375);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
