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
      model_score: fighter.model_score,
      current_context_prior: fighter.current_context_prior,
      rank_guard_adjustment: fighter.rank_guard_adjustment,
      rank_guard_target: fighter.rank_guard_target,
      title_guard_adjustment: fighter.title_guard_adjustment,
      current_context_adjustment: fighter.current_context_adjustment,
      base_rating: fighter.base_rating,
      recent_form_adjustment: fighter.recent_form_adjustment,
      recent_activity_adjustment: fighter.recent_activity_adjustment,
      dominance_adjustment: fighter.dominance_adjustment,
      finish_adjustment: fighter.finish_adjustment,
      quality_win_adjustment: fighter.quality_win_adjustment,
      inactivity_penalty: fighter.inactivity_penalty,
      legacy_penalty: fighter.legacy_penalty,
      recent_record_30m: fighter.recent_record_30m,
      recent_fights_30m: fighter.recent_fights_30m,
      recent_rating_change_30m: fighter.recent_rating_change_30m,
      best_win_age_months: fighter.best_win_age_months,
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
    model_version: "v0.5-context-calibrated-score",
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
      recent_form_adjustment: "Recent wins and recent Elo movement add or remove points from the post-fight rating.",
      recent_activity_adjustment: "Fighters get a small positive bump for recent ranked activity before inactivity penalties are applied.",
      dominance_adjustment: "Average dominance across fights becomes a bounded score adjustment, not just a hidden Elo multiplier.",
      finish_adjustment: "A fighter's finish rate adds a small bonus, while low finish rates get a small penalty.",
      quality_win_adjustment: "The best win adds value based on opponent rating, with older best wins decayed.",
      inactivity_penalty: "Fighters keep rating value, but lose final-score confidence after 12 months without a fight.",
      legacy_penalty: "High raw ratings are dampened when they are supported mostly by older peak wins rather than recent ranked activity.",
      current_context: "A current division snapshot limits rankings to the active ranked pool and adds a smaller status prior instead of forcing contender order.",
      rank_guard: "Current elite contenders are prevented from falling too far below their active divisional context; the guard adjustment is exposed.",
      title_guard: "The current champion is kept above contenders in that division; the required adjustment is exposed in the output.",
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
  const snapshotEntries = [
    {
      name: snapshotDivision.champion,
      currentStatus: "Champion",
      snapshotRank: 0,
    },
    ...snapshotDivision.rankings.map((name, index) => ({
      name,
      currentStatus: `Contender #${index + 1}`,
      snapshotRank: index + 1,
    })),
  ];

  const candidates = snapshotEntries.map((entry) => {
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

    const contextPrior = calculateCurrentContextPrior(entry);
    const modelScore = baseCandidate.model_score;
    const finalScore = modelScore + contextPrior;
    return {
      ...baseCandidate,
      fighter_name: entry.name,
      eligible: true,
      current_status: entry.currentStatus,
      current_snapshot_rank: entry.snapshotRank,
      current_snapshot_floor: null,
      current_context_prior: contextPrior,
      title_guard_adjustment: 0,
      current_context_adjustment: contextPrior,
      raw_score: round(modelScore, 2),
      final_score: round(finalScore, 2),
    };
  });

  return applyRankDriftGuard(applyTitleGuard(candidates))
    .sort((a, b) => b.final_score - a.final_score)
    .map((fighter, index) => ({ ...fighter, rank: index + 1 }));
}

function calculateCurrentContextPrior(entry) {
  if (entry.currentStatus === "Champion") return 95;
  return round(clamp(58 - entry.snapshotRank * 3.5, 0, 58), 2);
}

function applyTitleGuard(candidates) {
  const champion = candidates.find((candidate) => candidate.current_status === "Champion");
  if (!champion) return candidates;

  const bestContenderScore = candidates
    .filter((candidate) => candidate !== champion)
    .reduce((best, candidate) => Math.max(best, candidate.final_score), -Infinity);
  if (!Number.isFinite(bestContenderScore) || champion.final_score > bestContenderScore) {
    return candidates;
  }

  const titleGuardAdjustment = round(bestContenderScore - champion.final_score + 3, 2);
  champion.title_guard_adjustment = titleGuardAdjustment;
  champion.current_context_adjustment = round(champion.current_context_prior + titleGuardAdjustment, 2);
  champion.final_score = round(champion.final_score + titleGuardAdjustment, 2);
  return candidates;
}

function applyRankDriftGuard(candidates) {
  const guardedCandidates = candidates
    .map((candidate) => ({
      candidate,
      maxRank: getMaxAllowedRank(candidate),
    }))
    .filter(({ maxRank }) => maxRank !== null)
    .sort((a, b) => a.maxRank - b.maxRank);

  for (const { candidate, maxRank } of guardedCandidates) {
    const sorted = [...candidates].sort((a, b) => b.final_score - a.final_score);
    const currentRank = sorted.indexOf(candidate) + 1;
    if (currentRank > 0 && currentRank <= maxRank) continue;

    const target = sorted[Math.min(maxRank - 1, sorted.length - 1)];
    if (!target || target === candidate) continue;

    const adjustment = round(target.final_score - candidate.final_score + 1.5, 2);
    if (adjustment <= 0) continue;

    candidate.rank_guard_adjustment = round(candidate.rank_guard_adjustment + adjustment, 2);
    candidate.rank_guard_target = maxRank;
    candidate.current_context_adjustment = round(candidate.current_context_adjustment + adjustment, 2);
    candidate.final_score = round(candidate.final_score + adjustment, 2);
  }

  return candidates;
}

function getMaxAllowedRank(candidate) {
  if (candidate.current_status === "Champion") return null;

  const snapshotRank = Number(candidate.current_snapshot_rank);
  if (!Number.isFinite(snapshotRank) || snapshotRank <= 0) return null;
  if (snapshotRank === 1) return 3;
  if (snapshotRank <= 3) return 5;
  if (snapshotRank <= 5) return 6;
  return null;
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
  const legacy = calculateLegacyPenalty(fighter, asOfDate, baseRating);
  const averageDominance = fighter.dominanceSamples > 0 ? fighter.dominanceTotal / fighter.dominanceSamples : 50;
  const scoreComponents = calculateScoreComponents({
    fighter,
    legacy,
    averageDominance,
  });
  const modelScore =
    baseRating +
    scoreComponents.recentFormAdjustment +
    scoreComponents.recentActivityAdjustment +
    scoreComponents.dominanceAdjustment +
    scoreComponents.finishAdjustment +
    scoreComponents.qualityWinAdjustment -
    inactivityPenalty -
    legacy.penalty;
  const eligible =
    fighter.fights >= args.minDivisionFights && monthsInactive <= args.activeWindowMonths && fighter.lastFightDate;

  return {
    fighter_id: fighter.fighterId,
    fighter_name: fighter.name,
    rank: null,
    eligible,
    current_status: "Model ranked",
    current_context_adjustment: 0,
    current_context_prior: 0,
    rank_guard_adjustment: 0,
    rank_guard_target: null,
    title_guard_adjustment: 0,
    raw_score: round(modelScore, 2),
    model_score: round(modelScore, 2),
    final_score: round(modelScore, 2),
    base_rating: round(baseRating, 2),
    recent_form_adjustment: scoreComponents.recentFormAdjustment,
    recent_activity_adjustment: scoreComponents.recentActivityAdjustment,
    dominance_adjustment: scoreComponents.dominanceAdjustment,
    finish_adjustment: scoreComponents.finishAdjustment,
    quality_win_adjustment: scoreComponents.qualityWinAdjustment,
    source_division: sourceDivision,
    display_division: displayDivision,
    division_transfer_penalty: transferPenalty,
    inactivity_penalty: round(inactivityPenalty, 2),
    legacy_penalty: legacy.penalty,
    legacy_reasons: legacy.reasons,
    recent_record_30m: legacy.recentRecord,
    recent_fights_30m: legacy.recentFightCount,
    recent_rating_change_30m: legacy.recentRatingChange,
    best_win_age_months: legacy.bestWinAgeMonths,
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
    current_context_prior: 0,
    rank_guard_adjustment: 0,
    rank_guard_target: null,
    title_guard_adjustment: 0,
    raw_score: args.initialRating,
    model_score: args.initialRating,
    final_score: args.initialRating,
    base_rating: args.initialRating,
    recent_form_adjustment: 0,
    recent_activity_adjustment: 0,
    dominance_adjustment: 0,
    finish_adjustment: 0,
    quality_win_adjustment: 0,
    source_division: divisionName,
    display_division: divisionName,
    division_transfer_penalty: 0,
    inactivity_penalty: 0,
    legacy_penalty: 0,
    legacy_reasons: [],
    recent_record_30m: "0-0",
    recent_fights_30m: 0,
    recent_rating_change_30m: 0,
    best_win_age_months: "",
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

function calculateLegacyPenalty(fighter, asOfDate, baseRating) {
  const recentWindowMonths = 30;
  const recentFights = fighter.lastFive.filter((fight) => {
    const age = monthsBetween(new Date(fight.date), asOfDate);
    return age <= recentWindowMonths;
  });
  const recentWins = recentFights.filter((fight) => fight.result === "W").length;
  const recentLosses = recentFights.filter((fight) => fight.result === "L").length;
  const recentRatingChange = recentFights.reduce((sum, fight) => sum + num(fight.rating_change), 0);
  const bestWinAgeMonths = fighter.bestWin
    ? monthsBetween(new Date(fighter.bestWin.event_date), asOfDate)
    : Infinity;

  let penalty = 0;
  const reasons = [];

  if (baseRating >= 1580) {
    const sparseRecentPenalty = Math.max(0, 2 - recentFights.length) * 18;
    if (sparseRecentPenalty > 0) {
      penalty += sparseRecentPenalty;
      reasons.push(`Only ${recentFights.length} fight(s) in the last ${recentWindowMonths} months.`);
    }

    const staleBestWinPenalty = clamp((bestWinAgeMonths - 36) * 0.75, 0, 35);
    if (staleBestWinPenalty > 0) {
      penalty += staleBestWinPenalty;
      reasons.push(`Best win is ${round(bestWinAgeMonths, 1)} months old.`);
    }
  }

  if (recentFights.length > 0 && recentLosses > recentWins) {
    const losingFormPenalty = Math.min(18, (recentLosses - recentWins) * 9);
    penalty += losingFormPenalty;
    reasons.push(`Recent record is ${recentWins}-${recentLosses}.`);
  }

  if (recentFights.length > 0 && recentRatingChange < -15) {
    const negativeTrendPenalty = clamp((-recentRatingChange - 15) * 0.4, 0, 15);
    penalty += negativeTrendPenalty;
    reasons.push(`Recent rating trend is ${round(recentRatingChange, 2)}.`);
  }

  return {
    penalty: round(clamp(penalty, 0, 70), 2),
    reasons,
    recentWins,
    recentLosses,
    recentRecord: `${recentWins}-${recentLosses}`,
    recentFightCount: recentFights.length,
    recentRatingChange: round(recentRatingChange, 2),
    bestWinAgeMonths: Number.isFinite(bestWinAgeMonths) ? round(bestWinAgeMonths, 1) : "",
  };
}

function calculateScoreComponents({ fighter, legacy, averageDominance }) {
  const recentRecordAdjustment = clamp((legacy.recentWins - legacy.recentLosses) * 8, -24, 24);
  const recentTrendAdjustment = clamp(legacy.recentRatingChange * 0.25, -20, 20);
  const recentFormAdjustment = round(recentRecordAdjustment + recentTrendAdjustment, 2);
  const recentActivityAdjustment = round(clamp(legacy.recentFightCount * 4, 0, 16), 2);
  const dominanceAdjustment = round(clamp((averageDominance - 50) * 0.45, -18, 18), 2);
  const finishRate = fighter.fights > 0 ? fighter.finishes / fighter.fights : 0;
  const finishAdjustment = round(clamp((finishRate - 0.35) * 24, -8, 14), 2);
  const qualityWinAdjustment = calculateQualityWinAdjustment(fighter.bestWin, legacy.bestWinAgeMonths);

  return {
    recentFormAdjustment,
    recentActivityAdjustment,
    dominanceAdjustment,
    finishAdjustment,
    qualityWinAdjustment,
  };
}

function calculateQualityWinAdjustment(bestWin, bestWinAgeMonths) {
  if (!bestWin?.opponent_pre_rating || bestWinAgeMonths === "") return 0;

  const ageFactor = bestWinAgeMonths <= 24 ? 1 : bestWinAgeMonths <= 48 ? 0.65 : 0.35;
  const adjustment = (bestWin.opponent_pre_rating - 1540) * 0.22 * ageFactor;
  return round(clamp(adjustment, 0, 28), 2);
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
