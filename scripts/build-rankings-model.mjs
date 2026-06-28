#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  dataDir: "data/ufcstats",
  annotationsPath: "data/manual_annotations/ufc_fight_manual_annotations.csv",
  currentSnapshotPath: "data/ranking_inputs/current_division_snapshot.json",
  titleContextPath: "data/ranking_inputs/title_context.json",
  divisionContextPath: "data/ranking_inputs/division_context.json",
  outDir: "data/model",
  initialRating: 1500,
  kFactor: 32,
  activeWindowMonths: 36,
  minDivisionFights: 2,
};

const HEAD_TO_HEAD_WINDOW_MONTHS = 24;
const HEAD_TO_HEAD_SCORE_WINDOW = 45;
const STRICT_HEAD_TO_HEAD_WINDOW_MONTHS = 12;
const STRICT_HEAD_TO_HEAD_SCORE_WINDOW = 120;
const ELITE_HEAD_TO_HEAD_WINDOW_MONTHS = 36;
const ELITE_HEAD_TO_HEAD_SCORE_WINDOW = 80;
const OLD_FIGHTER_AGE = 36;
const VERY_OLD_FIGHTER_AGE = 39;

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

  const [summary, fights, fightStats, roundStats, fighters, annotations, currentSnapshot, titleContext, divisionContext] = await Promise.all([
    readJson(path.join(dataDir, "summary.json")),
    readJson(path.join(dataDir, "fights.json")),
    readJson(path.join(dataDir, "fight_fighter_stats.json")),
    readOptionalJson(path.join(dataDir, "fight_round_stats.json"), []),
    readJson(path.join(dataDir, "fighters.json")),
    readAnnotations(path.resolve(process.cwd(), args.annotationsPath)),
    readCurrentSnapshot(path.resolve(process.cwd(), args.currentSnapshotPath)),
    readTitleContext(path.resolve(process.cwd(), args.titleContextPath)),
    readDivisionContext(path.resolve(process.cwd(), args.divisionContextPath)),
  ]);

  const currentDivisionSet = new Set(CURRENT_DIVISIONS);
  const statsByFight = groupFightStats(fightStats);
  const roundStatsByFight = groupRoundStats(roundStats);
  const fighterProfiles = new Map(fighters.map((fighter) => [fighter.fighter_id, fighter]));
  const titleContextByFighter = buildTitleContextByFighter(titleContext);
  const annotationsByFight = new Map(annotations.map((annotation) => [annotation.fight_id, annotation]));
  const asOfDate = new Date(summary.end_date ?? latestDate(fights));
  const adjustedCurrentSnapshot = applyDivisionContextToSnapshot(currentSnapshot, divisionContext, asOfDate);

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
      roundStatsForFight: roundStatsByFight.get(fight.fight_id) ?? [],
      annotation: annotationsByFight.get(fight.fight_id),
      divisionRatings,
      fighterProfiles,
      titleContextByFighter,
      args,
    });

    if (!impact) {
      skipped += 1;
      continue;
    }

    fightImpacts.push(impact);
  }

  const divisions = buildDivisionRankings({
    divisionRatings,
    asOfDate,
    args,
    currentSnapshot: adjustedCurrentSnapshot,
    titleContext,
    divisionContext,
    fightImpacts,
  });
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
      entry_gate_penalty: fighter.entry_gate_penalty,
      entry_gate_status: fighter.entry_gate_status,
      title_context_adjustment: fighter.title_context_adjustment,
      title_context_status: fighter.title_context_status,
      title_context_target_rank: fighter.title_context_target_rank,
      rank_guard_adjustment: fighter.rank_guard_adjustment,
      rank_guard_target: fighter.rank_guard_target,
      rank_guard_confidence: fighter.rank_guard_confidence,
      rank_guard_status: fighter.rank_guard_status,
      head_to_head_adjustment: fighter.head_to_head_adjustment,
      head_to_head_overrides: fighter.head_to_head_overrides,
      title_guard_adjustment: fighter.title_guard_adjustment,
      current_context_adjustment: fighter.current_context_adjustment,
      base_rating: fighter.base_rating,
      recent_form_adjustment: fighter.recent_form_adjustment,
      recent_outcome_adjustment: fighter.recent_outcome_adjustment,
      schedule_strength_adjustment: fighter.schedule_strength_adjustment,
      schedule_strength_score: fighter.schedule_strength_score,
      schedule_strength_status: fighter.schedule_strength_status,
      avg_win_opponent_rating_last_5: fighter.avg_win_opponent_rating_last_5,
      best_win_opponent_rating_last_5: fighter.best_win_opponent_rating_last_5,
      recent_activity_adjustment: fighter.recent_activity_adjustment,
      dominance_adjustment: fighter.dominance_adjustment,
      finish_adjustment: fighter.finish_adjustment,
      round_dominance_adjustment: fighter.round_dominance_adjustment,
      title_win_adjustment: fighter.title_win_adjustment,
      quality_win_adjustment: fighter.quality_win_adjustment,
      division_context_status: fighter.division_context_status,
      division_context_note: fighter.division_context_note,
      division_transfer_penalty: fighter.division_transfer_penalty,
      current_division_overlay_adjustment: fighter.current_division_overlay_adjustment,
      current_division_record: fighter.current_division_record,
      transfer_source_division: fighter.transfer_source_division,
      inactivity_penalty: fighter.inactivity_penalty,
      legacy_penalty: fighter.legacy_penalty,
      recent_record_30m: fighter.recent_record_30m,
      recent_fights_30m: fighter.recent_fights_30m,
      recent_rating_change_30m: fighter.recent_rating_change_30m,
      best_win_age_months: fighter.best_win_age_months,
      best_win_opponent_age: fighter.best_win?.opponent_age_at_fight ?? "",
      best_win_opponent_form_score: fighter.best_win?.opponent_form_score ?? "",
      best_win_adjusted_rating: fighter.best_win?.adjusted_opponent_rating ?? "",
      ufc_division_fights: fighter.ufc_division_fights,
      division_record: fighter.division_record,
      last_fight_date: fighter.last_fight_date,
      months_inactive: fighter.months_inactive,
      average_dominance: fighter.average_dominance,
      average_round_dominance: fighter.average_round_dominance,
      clear_rounds_won: fighter.clear_rounds_won,
      clear_rounds_lost: fighter.clear_rounds_lost,
      best_win: fighter.best_win?.opponent_name ?? "",
      best_win_rating: fighter.best_win?.opponent_pre_rating ?? "",
    })),
  );

  const output = {
    model_version: "v0.8.3-schedule-strength",
    generated_at: new Date().toISOString(),
    as_of: toIsoDate(asOfDate),
    source: summary.source ?? "ufcstats.com",
    input_summary: {
      events: summary.event_count,
      fights: summary.fight_count,
      fighter_stat_rows: summary.fighter_stat_rows,
      round_stat_rows: summary.round_stat_rows ?? roundStats.length,
      fighters: summary.fighter_count,
      annotations: annotations.length,
      current_snapshot_divisions: adjustedCurrentSnapshot?.divisions?.length ?? 0,
      title_context_divisions: titleContext?.divisions?.length ?? 0,
      division_context_moves: divisionContext?.division_moves?.length ?? 0,
    },
    model_settings: {
      initial_rating: args.initialRating,
      k_factor: args.kFactor,
      active_window_months: args.activeWindowMonths,
      min_division_fights: args.minDivisionFights,
      current_divisions: CURRENT_DIVISIONS,
      current_snapshot_path: args.currentSnapshotPath,
      title_context_path: args.titleContextPath,
      division_context_path: args.divisionContextPath,
      strict_head_to_head_window_months: STRICT_HEAD_TO_HEAD_WINDOW_MONTHS,
      strict_head_to_head_score_window: STRICT_HEAD_TO_HEAD_SCORE_WINDOW,
      elite_head_to_head_window_months: ELITE_HEAD_TO_HEAD_WINDOW_MONTHS,
      elite_head_to_head_score_window: ELITE_HEAD_TO_HEAD_SCORE_WINDOW,
      head_to_head_window_months: HEAD_TO_HEAD_WINDOW_MONTHS,
      head_to_head_score_window: HEAD_TO_HEAD_SCORE_WINDOW,
    },
    methodology: {
      base_rating: "Division-specific Elo rating updated chronologically after each fight.",
      opponent_strength: "Built into Elo: beating a higher-rated opponent creates a larger rating gain.",
      opponent_context: "Opponent quality is adjusted at fight time using age, recent form, recent activity, and losing streak context.",
      method_multiplier: "Finishes and clean decisions move ratings more than split decisions, DQs, or weird stoppages.",
      dominance_multiplier: "Significant strike differential, knockdowns, takedowns, control time, and submission attempts adjust the size of the update.",
      round_dominance: "Per-round stats add a separate dominance score and dampen late comeback finishes when the winner was losing the round profile.",
      no_decision_activity: "Draws and no-contests update activity, stat totals, and dominance samples without changing Elo ratings.",
      result_confidence: "Manual annotations and low-repeatability stat patterns dampen noisy outcomes without deleting the official result.",
      recent_form_adjustment: "Recent wins and recent Elo movement add or remove points from the post-fight rating.",
      recent_outcome_adjustment: "The latest result adds a small recency check, with recent finish losses penalized more than decision losses.",
      schedule_strength_adjustment: "Recent win streaks are capped when built on weak opponent quality, while strong recent schedules receive a small bonus.",
      recent_activity_adjustment: "Fighters get a small positive bump for recent ranked activity before inactivity penalties are applied.",
      dominance_adjustment: "Average dominance across fights becomes a bounded score adjustment, not just a hidden Elo multiplier.",
      finish_adjustment: "A fighter's finish rate adds a small bonus, while low finish rates get a small penalty.",
      title_win_adjustment: "Recent wins over fighters with title-lineage context add visible resume credit.",
      quality_win_adjustment: "The best win adds value based on opponent rating, with older best wins and older declining opponents dampened.",
      inactivity_penalty: "Fighters keep rating value, but lose final-score confidence after 12 months without a fight.",
      legacy_penalty: "High raw ratings are dampened when they are supported mostly by older peak wins rather than recent ranked activity.",
      current_context: "A current division snapshot limits rankings to the active ranked pool and adds a smaller status prior instead of forcing contender order.",
      entry_gate: "Low-evidence ranked entries receive a visible penalty when they lack ranked or quality wins.",
      title_context: "Manual title-lineage context protects recent title losers, former champions, and similar cases when the pure score overreacts.",
      division_context: "Manual division moves remove fighters from old divisions and place them in the active division before snapshot policy is applied.",
      rank_guard: "Current elite contenders are protected by a confidence-based guard; active, proven fighters get more protection than inactive or thin-resume entries.",
      head_to_head: "Recent direct wins can move a fighter above a close-scored opponent they beat in the same division, with a stricter one-year rule.",
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

function processFight({
  fight,
  statsForFight,
  roundStatsForFight,
  annotation,
  divisionRatings,
  fighterProfiles,
  titleContextByFighter,
  args,
}) {
  if (fight.method === "Overturned") {
    return null;
  }

  if (!fight.winner_fighter_id) {
    updateNoDecisionFightActivity({
      fight,
      statsForFight,
      roundStatsForFight,
      divisionRatings,
      args,
    });
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
  const roundDominance = calculateRoundDominance({
    roundStatsForFight,
    winnerId,
    loserId,
    fight,
  });
  const annotationContext = getAnnotationContext(annotation);
  const repeatability = getRepeatabilityMultiplier(fight, dominance, roundDominance);
  const opponentContext = calculateOpponentContext({
    opponent: loser,
    opponentProfile: fighterProfiles.get(loserId),
    opponentTitleContexts: titleContextByFighter.get(normalizeName(loserName)) ?? [],
    fightDate: fight.event_date,
    opponentPreRating: loserPreRating,
  });
  const resultConfidence = clamp(annotationContext.multiplier * repeatability.multiplier, 0.25, 1.15);
  const totalMultiplier =
    method.multiplier *
    dominance.multiplier *
    roundDominance.multiplier *
    resultConfidence *
    opponentContext.ratingMultiplier;
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
    roundDominanceScore: roundDominance.score,
    roundDominance,
    opponentContext,
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
    roundDominanceScore: roundDominance.hasRounds ? 100 - roundDominance.score : 50,
    roundDominance: invertRoundDominance(roundDominance),
    opponentContext: null,
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
    round_dominance_score: roundDominance.score,
    round_dominance_multiplier: roundDominance.multiplier,
    winner_clear_rounds: roundDominance.winnerClearRounds,
    loser_clear_rounds: roundDominance.loserClearRounds,
    close_rounds: roundDominance.closeRounds,
    round_dominance_reason: roundDominance.reason,
    opponent_quality_multiplier: opponentContext.ratingMultiplier,
    opponent_adjusted_rating: opponentContext.adjustedRating,
    opponent_age_at_fight: opponentContext.ageAtFight,
    opponent_form_score: opponentContext.formScore,
    opponent_context_reason: opponentContext.reasons.join("|"),
    result_confidence: resultConfidence,
    annotation_tags: annotationContext.tags.join("|"),
    repeatability_reason: repeatability.reason,
    final_rating_change: ratingChange,
    winner_post_rating: round(winner.rating, 2),
    loser_post_rating: round(loser.rating, 2),
  };
}

function buildDivisionRankings({ divisionRatings, asOfDate, args, currentSnapshot, titleContext, divisionContext, fightImpacts }) {
  const fighterIndex = buildFighterIndex(divisionRatings, asOfDate);
  const snapshotByDivision = new Map((currentSnapshot?.divisions ?? []).map((division) => [division.division, division]));
  const titleContextByDivision = new Map((titleContext?.divisions ?? []).map((division) => [division.division, division]));
  const divisionContextByFighter = buildDivisionContextByFighter(divisionContext);

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
          titleContextDivision: titleContextByDivision.get(divisionName),
          divisionContextByFighter,
          fightImpacts,
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

function buildCurrentSnapshotRankings({
  snapshotDivision,
  rawCandidates,
  fighterIndex,
  divisionName,
  asOfDate,
  args,
  titleContextDivision,
  divisionContextByFighter,
  fightImpacts,
}) {
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
    const divisionMove = getActiveDivisionMove(divisionContextByFighter.get(normalizedName), divisionName, asOfDate);
    const transferCandidate = indexedFighter
      ? makeCandidate({
          fighter: indexedFighter.fighter,
          displayDivision: divisionName,
          sourceDivision: indexedFighter.division,
          asOfDate,
          args,
          transferPenalty: getDivisionTransferPenalty({
            sourceDivision: indexedFighter.division,
            displayDivision: divisionName,
            divisionMove,
          }),
        })
      : null;
    const baseCandidate = chooseSnapshotCandidate({ currentDivisionCandidate, transferCandidate, divisionMove }) ??
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
      division_context_status: divisionMove?.status ?? baseCandidate.division_context_status,
      division_context_note: divisionMove?.note ?? baseCandidate.division_context_note,
      current_snapshot_rank: entry.snapshotRank,
      current_snapshot_floor: null,
      current_context_prior: contextPrior,
      entry_gate_penalty: 0,
      entry_gate_status: "",
      title_context_adjustment: 0,
      title_context_status: "",
      title_context_target_rank: null,
      head_to_head_adjustment: 0,
      head_to_head_overrides: [],
      title_guard_adjustment: 0,
      current_context_adjustment: contextPrior,
      raw_score: round(modelScore, 2),
      final_score: round(finalScore, 2),
    };
  });

  const guardedCandidates = applyTitleGuard(candidates);
  const titleContextCandidates = applyTitleContextPolicy(guardedCandidates, titleContextDivision, asOfDate);
  const gatedCandidates = applyRankedEntryGate(titleContextCandidates);
  const rankGuardCandidates = applyRankDriftGuard(gatedCandidates);
  const headToHeadCandidates = applyHeadToHeadResolver(rankGuardCandidates, divisionName, fightImpacts, asOfDate);
  const finalPolicyCandidates = applyTitleContextPolicy(headToHeadCandidates, titleContextDivision, asOfDate);

  return finalPolicyCandidates
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

function applyTitleContextPolicy(candidates, titleContextDivision, asOfDate) {
  const titleEntries = titleContextDivision?.title_context ?? [];
  const orderedEntries = titleEntries
    .filter((entry) => entry.rank_policy !== false)
    .map((entry) => ({
      ...entry,
      max_overall_rank: Number(entry.max_overall_rank ?? getDefaultTitleContextRank(entry.tag)),
    }))
    .filter((entry) => Number.isFinite(entry.max_overall_rank) && entry.max_overall_rank > 0)
    .sort((a, b) => a.max_overall_rank - b.max_overall_rank);

  for (const entry of orderedEntries) {
    const candidate = findCandidateByName(candidates, entry.fighter);
    if (!candidate || !isActiveTitleContext(entry, candidate, asOfDate)) continue;

    const adjustment = applyMaxRankAdjustment({
      candidates,
      candidate,
      maxRank: entry.max_overall_rank,
      margin: 1.5,
    });
    if (adjustment <= 0) continue;

    candidate.title_context_adjustment = round(candidate.title_context_adjustment + adjustment, 2);
    candidate.title_context_status = entry.tag;
    candidate.title_context_target_rank = entry.max_overall_rank;
    candidate.current_context_adjustment = round(candidate.current_context_adjustment + adjustment, 2);
  }

  return candidates;
}

function isActiveTitleContext(entry, candidate, asOfDate) {
  if (!entry.event_date) return true;

  const ageMonths = monthsBetween(new Date(entry.event_date), asOfDate);
  const protectionMonths = Number(entry.protection_months ?? 18);
  if (Number.isFinite(protectionMonths) && ageMonths > protectionMonths) return false;

  const expiresAfterLoss = entry.expires_after_loss !== false;
  if (expiresAfterLoss && hasLossAfter(candidate, entry.event_date)) return false;

  return true;
}

function hasLossAfter(candidate, date) {
  return candidate.last_five.some((fight) => fight.result === "L" && fight.date > date);
}

function getDefaultTitleContextRank(tag) {
  if (tag === "recent_title_loser") return 2;
  if (tag === "recent_champion") return 4;
  if (tag === "interim_champion") return 4;
  if (tag === "recent_title_challenger") return 5;
  if (tag === "former_champion") return 6;
  return null;
}

function applyRankDriftGuard(candidates) {
  const guardedCandidates = candidates
    .map((candidate) => ({
      candidate,
      guard: getRankGuard(candidate),
    }))
    .filter(({ guard }) => guard !== null)
    .sort((a, b) => a.guard.maxRank - b.guard.maxRank);

  for (const { candidate, guard } of guardedCandidates) {
    const sorted = [...candidates].sort((a, b) => b.final_score - a.final_score);
    const currentRank = sorted.indexOf(candidate) + 1;
    const maxRank = guard.maxRank;
    if (currentRank > 0 && currentRank <= maxRank) continue;

    const target = sorted[Math.min(maxRank - 1, sorted.length - 1)];
    if (!target || target === candidate) continue;

    const rawAdjustment = round(target.final_score - candidate.final_score + 1.5, 2);
    const adjustment = round(Math.min(rawAdjustment, guard.maxAdjustment), 2);
    if (adjustment <= 0) continue;

    candidate.rank_guard_adjustment = round(candidate.rank_guard_adjustment + adjustment, 2);
    candidate.rank_guard_target = maxRank;
    candidate.rank_guard_confidence = guard.confidence;
    candidate.rank_guard_status = rawAdjustment > guard.maxAdjustment ? "confidence_capped" : "confidence_guard";
    candidate.current_context_adjustment = round(candidate.current_context_adjustment + adjustment, 2);
    candidate.final_score = round(candidate.final_score + adjustment, 2);
  }

  return candidates;
}

function getRankGuard(candidate) {
  if (candidate.current_status === "Champion") return null;

  const snapshotRank = Number(candidate.current_snapshot_rank);
  if (!Number.isFinite(snapshotRank) || snapshotRank <= 0) return null;
  if (snapshotRank > 6) return null;

  const confidence = calculateRankGuardConfidence(candidate);
  let maxRank = null;

  if (snapshotRank === 1) {
    if (confidence >= 0.75) maxRank = 3;
    else if (confidence >= 0.55) maxRank = 5;
  } else if (snapshotRank <= 3) {
    if (confidence >= 0.75) maxRank = 5;
    else if (confidence >= 0.55) maxRank = 7;
  } else if (snapshotRank <= 5) {
    if (confidence >= 0.75) maxRank = 6;
    else if (confidence >= 0.6) maxRank = 8;
  } else if (confidence >= 0.8) {
    maxRank = 9;
  }

  if (maxRank === null) return null;

  return {
    maxRank,
    confidence,
    maxAdjustment: round(18 + confidence * 58, 2),
  };
}

function calculateRankGuardConfidence(candidate) {
  let confidence = 0;

  if (num(candidate.months_inactive) <= 9) confidence += 0.22;
  else if (num(candidate.months_inactive) <= 15) confidence += 0.14;
  else if (num(candidate.months_inactive) <= 21) confidence += 0.06;

  if (num(candidate.ufc_division_fights) >= 7) confidence += 0.22;
  else if (num(candidate.ufc_division_fights) >= 4) confidence += 0.15;
  else if (num(candidate.ufc_division_fights) >= 2) confidence += 0.06;

  if (num(candidate.recent_rating_change_30m) >= 35) confidence += 0.18;
  else if (num(candidate.recent_rating_change_30m) >= 12) confidence += 0.12;
  else if (num(candidate.recent_rating_change_30m) <= -18) confidence -= 0.16;

  const recentRecord = parseRecord(candidate.recent_record_30m);
  if (recentRecord.wins > recentRecord.losses) confidence += 0.14;
  if (recentRecord.losses > recentRecord.wins) confidence -= 0.14;

  if (num(candidate.quality_win_adjustment) >= 20) confidence += 0.14;
  else if (num(candidate.quality_win_adjustment) >= 12) confidence += 0.08;
  if (num(candidate.title_win_adjustment) > 0) confidence += 0.08;
  if (num(candidate.average_round_dominance) >= 56) confidence += 0.06;

  if (candidate.entry_gate_status) confidence -= 0.18;
  if (num(candidate.inactivity_penalty) >= 20) confidence -= 0.14;
  if (num(candidate.legacy_penalty) >= 35) confidence -= 0.12;
  if (num(candidate.recent_outcome_adjustment) <= -8) confidence -= 0.08;

  return round(clamp(confidence, 0, 1), 2);
}

function applyRankedEntryGate(candidates) {
  const rankedNames = new Set(candidates.map((candidate) => normalizeName(candidate.fighter_name)));

  for (const candidate of candidates) {
    if (candidate.current_status === "Champion") continue;

    const snapshotRank = Number(candidate.current_snapshot_rank);
    if (!Number.isFinite(snapshotRank) || snapshotRank < 8) continue;

    const rankedWins = countRankedWins(candidate, rankedNames);
    const qualityWins = countQualityWins(candidate);
    const bestAdjustedWin = num(candidate.best_win?.adjusted_opponent_rating);
    const qualityWinScore = num(candidate.quality_win_adjustment);
    const lowFightSample = candidate.ufc_division_fights < 4;
    const protectedTransfer =
      Boolean(candidate.division_context_status || candidate.transfer_source_division) ||
      (candidate.source_division && candidate.display_division && candidate.source_division !== candidate.display_division);
    const titleLineageEvidence = num(candidate.title_win_adjustment) > 0 || Boolean(candidate.title_context_status);
    const strongEntryEvidence = rankedWins > 0 || bestAdjustedWin >= 1600 || titleLineageEvidence || protectedTransfer;

    let penalty = 0;
    let status = "";

    if (lowFightSample && snapshotRank <= 10 && !strongEntryEvidence && qualityWins < 2) {
      penalty = 28;
      status = "thin_top10_sample";
    } else if (lowFightSample && rankedWins === 0 && qualityWins < 2) {
      penalty = 30;
      status = "low_evidence_top15_entry";
    } else if (snapshotRank >= 12 && rankedWins === 0 && bestAdjustedWin < 1560 && qualityWinScore < 6) {
      penalty = 26;
      status = "unproven_ranked_jump";
    } else if (snapshotRank >= 10 && rankedWins === 0 && qualityWins < 2 && bestAdjustedWin < 1560) {
      penalty = 18;
      status = "no_ranked_or_quality_win";
    } else if (snapshotRank >= 12 && lowFightSample && bestAdjustedWin < 1580) {
      penalty = 12;
      status = "thin_ranked_sample";
    }

    if (penalty <= 0) continue;

    candidate.entry_gate_penalty = round(candidate.entry_gate_penalty + penalty, 2);
    candidate.entry_gate_status = status;
    candidate.current_context_adjustment = round(candidate.current_context_adjustment - penalty, 2);
    candidate.final_score = round(candidate.final_score - penalty, 2);
  }

  return candidates;
}

function countRankedWins(candidate, rankedNames) {
  return candidate.last_five.filter(
    (fight) => fight.result === "W" && rankedNames.has(normalizeName(fight.opponent_name)),
  ).length;
}

function countQualityWins(candidate) {
  return candidate.last_five.filter((fight) => fight.result === "W" && num(fight.rating_change) >= 16).length;
}

function applyHeadToHeadResolver(candidates, divisionName, fightImpacts, asOfDate) {
  const candidateByName = new Map(candidates.map((candidate) => [normalizeName(candidate.fighter_name), candidate]));
  const latestFightByPair = new Map();

  for (const impact of fightImpacts) {
    if (impact.division !== divisionName) continue;
    if (monthsBetween(new Date(impact.event_date), asOfDate) > ELITE_HEAD_TO_HEAD_WINDOW_MONTHS) continue;

    const winner = candidateByName.get(normalizeName(impact.winner_name));
    const loser = candidateByName.get(normalizeName(impact.loser_name));
    if (!winner || !loser) continue;

    const pairKey = [normalizeName(impact.winner_name), normalizeName(impact.loser_name)].sort().join("|");
    const existing = latestFightByPair.get(pairKey);
    if (!existing || impact.event_date > existing.impact.event_date) {
      latestFightByPair.set(pairKey, {
        impact,
        winner,
        loser,
      });
    }
  }

  const latestFights = Array.from(latestFightByPair.values()).sort((a, b) =>
    b.impact.event_date.localeCompare(a.impact.event_date),
  );

  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;

    for (const { impact, winner, loser } of latestFights) {
      if (loser.current_status === "Champion") continue;

      const ranked = sortCandidates(candidates);
      const winnerRank = ranked.indexOf(winner) + 1;
      const loserRank = ranked.indexOf(loser) + 1;
      if (winnerRank === 0 || loserRank === 0 || winnerRank < loserRank) continue;

      const scoreGap = loser.final_score - winner.final_score;
      const monthsSinceFight = monthsBetween(new Date(impact.event_date), asOfDate);
      const strictHeadToHead =
        monthsSinceFight <= STRICT_HEAD_TO_HEAD_WINDOW_MONTHS && !hasDamagingLossAfter(winner, impact.event_date);
      const eliteHeadToHead =
        monthsSinceFight <= ELITE_HEAD_TO_HEAD_WINDOW_MONTHS &&
        winnerRank <= 8 &&
        loserRank <= 8 &&
        !hasDamagingLossAfter(winner, impact.event_date);
      const closeHeadToHead = monthsSinceFight <= HEAD_TO_HEAD_WINDOW_MONTHS;
      const scoreWindow = strictHeadToHead
        ? STRICT_HEAD_TO_HEAD_SCORE_WINDOW
        : eliteHeadToHead
          ? ELITE_HEAD_TO_HEAD_SCORE_WINDOW
          : closeHeadToHead
            ? HEAD_TO_HEAD_SCORE_WINDOW
            : -Infinity;
      if (scoreGap > scoreWindow) continue;

      const adjustment = round(scoreGap + 1.25, 2);
      winner.head_to_head_adjustment = round(winner.head_to_head_adjustment + adjustment, 2);
      winner.current_context_adjustment = round(winner.current_context_adjustment + adjustment, 2);
      winner.final_score = round(winner.final_score + adjustment, 2);
      upsertHeadToHeadOverride({
        winner,
        loser,
        impact,
        adjustment,
        rule: strictHeadToHead
          ? "strict_recent_head_to_head"
          : eliteHeadToHead
            ? "elite_extended_head_to_head"
            : "close_score_head_to_head",
      });
      changed = true;
    }

    if (!changed) break;
  }

  return candidates;
}

function upsertHeadToHeadOverride({ winner, loser, impact, adjustment, rule }) {
  const existing = winner.head_to_head_overrides.find(
    (override) => override.opponent === loser.fighter_name && override.fight_date === impact.event_date,
  );

  if (existing) {
    existing.adjustment = round(existing.adjustment + adjustment, 2);
    existing.rule = rule;
    return;
  }

  winner.head_to_head_overrides.push({
    opponent: loser.fighter_name,
    fight_date: impact.event_date,
    method: impact.method,
    adjustment,
    rule,
  });
}

function hasDamagingLossAfter(candidate, date) {
  return candidate.last_five.some(
    (fight) =>
      fight.result === "L" &&
      fight.date > date &&
      (isFinish(fight.method) || num(fight.rating_change) <= -18),
  );
}

function applyMaxRankAdjustment({ candidates, candidate, maxRank, margin }) {
  const ranked = sortCandidates(candidates);
  const currentRank = ranked.indexOf(candidate) + 1;
  if (currentRank > 0 && currentRank <= maxRank) return 0;

  const target = ranked[Math.min(maxRank - 1, ranked.length - 1)];
  if (!target || target === candidate) return 0;

  const adjustment = round(target.final_score - candidate.final_score + margin, 2);
  if (adjustment <= 0) return 0;

  candidate.final_score = round(candidate.final_score + adjustment, 2);
  return adjustment;
}

function findCandidateByName(candidates, name) {
  const normalizedName = normalizeName(name);
  return candidates.find((candidate) => normalizeName(candidate.fighter_name) === normalizedName);
}

function sortCandidates(candidates) {
  return [...candidates].sort((a, b) => b.final_score - a.final_score);
}

function chooseBestCandidate(...candidates) {
  return candidates
    .filter(Boolean)
    .sort((a, b) => b.final_score - a.final_score)[0];
}

function getDivisionTransferPenalty({ sourceDivision, displayDivision, divisionMove }) {
  if (sourceDivision === displayDivision) return 0;

  const explicitPenalty = Number(divisionMove?.transfer_penalty);
  if (Number.isFinite(explicitPenalty)) return Math.max(0, explicitPenalty);

  if (divisionMove?.resume_carryover === "elite_champion") return 5;
  if (divisionMove?.resume_carryover === "recent_champion") return 10;
  if (divisionMove?.resume_carryover === "ranked_veteran") return 18;
  return 25;
}

function chooseSnapshotCandidate({ currentDivisionCandidate, transferCandidate, divisionMove }) {
  if (!currentDivisionCandidate) return transferCandidate;
  if (!transferCandidate || transferCandidate.source_division === currentDivisionCandidate.display_division) {
    return currentDivisionCandidate;
  }

  if (divisionMove) {
    return mergeDivisionMoveCandidate({ currentDivisionCandidate, transferCandidate, divisionMove });
  }

  if (currentDivisionCandidate.ufc_division_fights > 0) {
    return currentDivisionCandidate;
  }

  return chooseBestCandidate(currentDivisionCandidate, transferCandidate);
}

function mergeDivisionMoveCandidate({ currentDivisionCandidate, transferCandidate, divisionMove }) {
  const overlayAdjustment = calculateCurrentDivisionOverlayAdjustment(currentDivisionCandidate);
  const mergedLastFive = [...currentDivisionCandidate.last_five, ...transferCandidate.last_five]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((fight, index, fights) =>
      fights.findIndex(
        (candidate) =>
          candidate.date === fight.date &&
          normalizeName(candidate.opponent_name) === normalizeName(fight.opponent_name) &&
          candidate.result === fight.result,
      ) === index,
    )
    .slice(0, 5);

  return {
    ...transferCandidate,
    display_division: currentDivisionCandidate.display_division,
    final_score: round(transferCandidate.final_score + overlayAdjustment, 2),
    model_score: round(transferCandidate.model_score + overlayAdjustment, 2),
    raw_score: round(transferCandidate.raw_score + overlayAdjustment, 2),
    current_division_overlay_adjustment: overlayAdjustment,
    current_division_fights: currentDivisionCandidate.ufc_division_fights,
    current_division_record: currentDivisionCandidate.division_record,
    transfer_source_division: transferCandidate.source_division,
    transfer_source_model_score: transferCandidate.model_score,
    ufc_division_fights: currentDivisionCandidate.ufc_division_fights,
    division_record: currentDivisionCandidate.division_record,
    wins: currentDivisionCandidate.wins,
    losses: currentDivisionCandidate.losses,
    finishes: currentDivisionCandidate.finishes,
    last_fight_date: currentDivisionCandidate.last_fight_date,
    months_inactive: currentDivisionCandidate.months_inactive,
    average_dominance: currentDivisionCandidate.average_dominance,
    average_round_dominance: currentDivisionCandidate.average_round_dominance,
    clear_rounds_won: currentDivisionCandidate.clear_rounds_won,
    clear_rounds_lost: currentDivisionCandidate.clear_rounds_lost,
    close_rounds: currentDivisionCandidate.close_rounds,
    comeback_finishes: currentDivisionCandidate.comeback_finishes,
    last_five: mergedLastFive,
    totals: currentDivisionCandidate.totals,
    division_context_status: divisionMove.status ?? "division_transfer",
    division_context_note: divisionMove.note ?? "",
  };
}

function calculateCurrentDivisionOverlayAdjustment(candidate) {
  const record = parseRecord(candidate.division_record);
  const recordAdjustment = clamp((record.wins - record.losses) * 18, -36, 36);
  const trendAdjustment = clamp(num(candidate.recent_rating_change_30m) * 0.35, -24, 24);
  const roundAdjustment = clamp((num(candidate.average_round_dominance) - 50) * 0.18, -8, 8);
  return round(recordAdjustment + trendAdjustment + roundAdjustment, 2);
}

function makeCandidate({ fighter, displayDivision, sourceDivision, asOfDate, args, transferPenalty = 0 }) {
  const monthsInactive = monthsBetween(new Date(fighter.lastFightDate), asOfDate);
  const inactivityPenalty = calculateInactivityPenalty(monthsInactive);
  const baseRating = fighter.rating - transferPenalty;
  const legacy = calculateLegacyPenalty(fighter, asOfDate, baseRating);
  const averageDominance = fighter.dominanceSamples > 0 ? fighter.dominanceTotal / fighter.dominanceSamples : 50;
  const averageRoundDominance =
    fighter.roundDominanceSamples > 0 ? fighter.roundDominanceTotal / fighter.roundDominanceSamples : 50;
  const scoreComponents = calculateScoreComponents({
    fighter,
    legacy,
    averageDominance,
    averageRoundDominance,
    monthsInactive,
  });
  const modelScore =
    baseRating +
    scoreComponents.recentFormAdjustment +
    scoreComponents.recentOutcomeAdjustment +
    scoreComponents.scheduleStrengthAdjustment +
    scoreComponents.recentActivityAdjustment +
    scoreComponents.dominanceAdjustment +
    scoreComponents.roundDominanceAdjustment +
    scoreComponents.finishAdjustment +
    scoreComponents.titleWinAdjustment +
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
    entry_gate_penalty: 0,
    entry_gate_status: "",
    title_context_adjustment: 0,
    title_context_status: "",
    title_context_target_rank: null,
    rank_guard_adjustment: 0,
    rank_guard_target: null,
    rank_guard_confidence: null,
    rank_guard_status: "",
    head_to_head_adjustment: 0,
    head_to_head_overrides: [],
    title_guard_adjustment: 0,
    raw_score: round(modelScore, 2),
    model_score: round(modelScore, 2),
    final_score: round(modelScore, 2),
    base_rating: round(baseRating, 2),
    recent_form_adjustment: scoreComponents.recentFormAdjustment,
    recent_outcome_adjustment: scoreComponents.recentOutcomeAdjustment,
    schedule_strength_adjustment: scoreComponents.scheduleStrengthAdjustment,
    schedule_strength_score: scoreComponents.scheduleStrengthScore,
    schedule_strength_status: scoreComponents.scheduleStrengthStatus,
    avg_win_opponent_rating_last_5: scoreComponents.avgWinOpponentRatingLast5,
    best_win_opponent_rating_last_5: scoreComponents.bestWinOpponentRatingLast5,
    recent_activity_adjustment: scoreComponents.recentActivityAdjustment,
    dominance_adjustment: scoreComponents.dominanceAdjustment,
    round_dominance_adjustment: scoreComponents.roundDominanceAdjustment,
    finish_adjustment: scoreComponents.finishAdjustment,
    title_win_adjustment: scoreComponents.titleWinAdjustment,
    quality_win_adjustment: scoreComponents.qualityWinAdjustment,
    source_division: sourceDivision,
    display_division: displayDivision,
    division_context_status: "",
    division_context_note: "",
    division_transfer_penalty: transferPenalty,
    current_division_overlay_adjustment: 0,
    current_division_fights: fighter.fights,
    current_division_record: `${fighter.wins}-${fighter.losses}`,
    transfer_source_division: "",
    transfer_source_model_score: "",
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
    average_round_dominance: round(averageRoundDominance, 1),
    clear_rounds_won: fighter.clearRoundsWon,
    clear_rounds_lost: fighter.clearRoundsLost,
    close_rounds: fighter.closeRounds,
    comeback_finishes: fighter.comebackFinishes,
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
    entry_gate_penalty: 0,
    entry_gate_status: "",
    title_context_adjustment: 0,
    title_context_status: "",
    title_context_target_rank: null,
    rank_guard_adjustment: 0,
    rank_guard_target: null,
    rank_guard_confidence: null,
    rank_guard_status: "",
    head_to_head_adjustment: 0,
    head_to_head_overrides: [],
    title_guard_adjustment: 0,
    raw_score: args.initialRating,
    model_score: args.initialRating,
    final_score: args.initialRating,
    base_rating: args.initialRating,
    recent_form_adjustment: 0,
    recent_outcome_adjustment: 0,
    schedule_strength_adjustment: 0,
    schedule_strength_score: "",
    schedule_strength_status: "",
    avg_win_opponent_rating_last_5: "",
    best_win_opponent_rating_last_5: "",
    recent_activity_adjustment: 0,
    dominance_adjustment: 0,
    round_dominance_adjustment: 0,
    finish_adjustment: 0,
    title_win_adjustment: 0,
    quality_win_adjustment: 0,
    source_division: divisionName,
    display_division: divisionName,
    division_context_status: "",
    division_context_note: "",
    division_transfer_penalty: 0,
    current_division_overlay_adjustment: 0,
    current_division_fights: 0,
    current_division_record: "0-0",
    transfer_source_division: "",
    transfer_source_model_score: "",
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
    average_round_dominance: 50,
    clear_rounds_won: 0,
    clear_rounds_lost: 0,
    close_rounds: 0,
    comeback_finishes: 0,
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
  roundDominanceScore,
  roundDominance,
  opponentContext,
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
    const adjustedOpponentRating = opponentContext?.adjustedRating ?? opponentPreRating;
    if (!fighter.bestWin || adjustedOpponentRating > fighter.bestWin.adjusted_opponent_rating) {
      fighter.bestWin = {
        fight_id: fight.fight_id,
        event_date: fight.event_date,
        opponent_name: opponent.name,
        opponent_pre_rating: round(opponentPreRating, 2),
        adjusted_opponent_rating: round(adjustedOpponentRating, 2),
        opponent_age_at_fight: opponentContext?.ageAtFight ?? "",
        opponent_form_score: opponentContext?.formScore ?? "",
        opponent_quality_multiplier: opponentContext?.ratingMultiplier ?? "",
        opponent_context_reasons: opponentContext?.reasons ?? [],
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
    opponent_pre_rating: round(opponentPreRating, 2),
    opponent_adjusted_rating: round(opponentContext?.adjustedRating ?? opponentPreRating, 2),
    opponent_form_score: opponentContext?.formScore ?? "",
    opponent_context_reasons: opponentContext?.reasons ?? [],
    method: fight.method,
    rating_change: round(ratingChange, 2),
    opponent_title_context: opponentContext?.titleContextTag ?? "",
  });

  fighter.dominanceTotal += dominanceScore;
  fighter.dominanceSamples += 1;
  if (roundDominance?.hasRounds) {
    fighter.roundDominanceTotal += roundDominanceScore;
    fighter.roundDominanceSamples += 1;
    fighter.clearRoundsWon += roundDominance.winnerClearRounds;
    fighter.clearRoundsLost += roundDominance.loserClearRounds;
    fighter.closeRounds += roundDominance.closeRounds;
    if (roundDominance.comebackFinish) fighter.comebackFinishes += 1;
  }

  addFighterStatTotals({ fighter, stats, opponentStats });
}

function updateNoDecisionFightActivity({ fight, statsForFight, roundStatsForFight, divisionRatings, args }) {
  const division = getDivisionState(divisionRatings, fight.weight_class);
  const fighterOne = getFighterState(division, fight.fighter_1_id, fight.fighter_1_name, fight.weight_class, args.initialRating);
  const fighterTwo = getFighterState(division, fight.fighter_2_id, fight.fighter_2_name, fight.weight_class, args.initialRating);
  const fighterOneStats = statsForFight?.get(fight.fighter_1_id);
  const fighterTwoStats = statsForFight?.get(fight.fighter_2_id);
  const dominance = calculateDominance(fighterOneStats, fighterTwoStats);
  const roundDominance = calculateRoundDominance({
    roundStatsForFight,
    winnerId: fight.fighter_1_id,
    loserId: fight.fighter_2_id,
    fight,
  });

  updateNoDecisionFighterAggregate({
    fighter: fighterOne,
    opponent: fighterTwo,
    fight,
    result: fight.fighter_1_status || "NC",
    stats: fighterOneStats,
    opponentStats: fighterTwoStats,
    dominanceScore: dominance.score,
    roundDominanceScore: roundDominance.score,
    roundDominance,
  });

  updateNoDecisionFighterAggregate({
    fighter: fighterTwo,
    opponent: fighterOne,
    fight,
    result: fight.fighter_2_status || "NC",
    stats: fighterTwoStats,
    opponentStats: fighterOneStats,
    dominanceScore: 100 - dominance.score,
    roundDominanceScore: roundDominance.hasRounds ? 100 - roundDominance.score : 50,
    roundDominance: invertRoundDominance(roundDominance),
  });
}

function updateNoDecisionFighterAggregate({
  fighter,
  opponent,
  fight,
  result,
  stats,
  opponentStats,
  dominanceScore,
  roundDominanceScore,
  roundDominance,
}) {
  fighter.fights += 1;
  fighter.lastFightDate = fight.event_date;
  fighter.ratingHistory.push({
    fight_id: fight.fight_id,
    event_date: fight.event_date,
    opponent_name: opponent.name,
    pre_rating: round(fighter.rating, 2),
    post_rating: round(fighter.rating, 2),
    rating_change: 0,
  });
  fighter.lastFive.push({
    date: fight.event_date,
    result,
    opponent_name: opponent.name,
    opponent_pre_rating: round(opponent.rating, 2),
    opponent_adjusted_rating: round(opponent.rating, 2),
    opponent_form_score: "",
    opponent_context_reasons: [],
    method: fight.method,
    rating_change: 0,
    opponent_title_context: "",
  });
  fighter.dominanceTotal += dominanceScore;
  fighter.dominanceSamples += 1;
  if (roundDominance?.hasRounds) {
    fighter.roundDominanceTotal += roundDominanceScore;
    fighter.roundDominanceSamples += 1;
    fighter.clearRoundsWon += roundDominance.winnerClearRounds;
    fighter.clearRoundsLost += roundDominance.loserClearRounds;
    fighter.closeRounds += roundDominance.closeRounds;
  }
  addFighterStatTotals({ fighter, stats, opponentStats });
}

function addFighterStatTotals({ fighter, stats, opponentStats }) {
  if (!stats) return;

  fighter.totals.knockdowns += num(stats.knockdowns);
  fighter.totals.sig_strikes_landed += num(stats.sig_strikes_landed);
  fighter.totals.sig_strikes_attempted += num(stats.sig_strikes_attempted);
  fighter.totals.sig_strikes_absorbed += num(opponentStats?.sig_strikes_landed);
  fighter.totals.takedowns_landed += num(stats.takedowns_landed);
  fighter.totals.takedowns_attempted += num(stats.takedowns_attempted);
  fighter.totals.submission_attempts += num(stats.submission_attempts);
  fighter.totals.control_seconds += num(stats.control_seconds);
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

function calculateRoundDominance({ roundStatsForFight, winnerId, loserId, fight }) {
  if (!roundStatsForFight.length) {
    return {
      hasRounds: false,
      score: 50,
      multiplier: 1,
      winnerClearRounds: 0,
      loserClearRounds: 0,
      closeRounds: 0,
      comebackFinish: false,
      reason: "",
    };
  }

  const rowsByRound = new Map();
  for (const row of roundStatsForFight) {
    if (!rowsByRound.has(row.round)) rowsByRound.set(row.round, new Map());
    rowsByRound.get(row.round).set(row.fighter_id, row);
  }

  let winnerClearRounds = 0;
  let loserClearRounds = 0;
  let closeRounds = 0;
  let winnerClearBeforeFinish = 0;
  let loserClearBeforeFinish = 0;
  let totalScore = 0;
  let scoredRounds = 0;
  const finishRound = Number(fight.finish_round);

  for (const [roundNumber, rows] of [...rowsByRound.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const winnerRound = rows.get(winnerId);
    const loserRound = rows.get(loserId);
    if (!winnerRound || !loserRound) continue;

    const dominance = calculateDominance(winnerRound, loserRound);
    totalScore += dominance.score;
    scoredRounds += 1;

    if (dominance.advantage >= 0.12) {
      winnerClearRounds += 1;
      if (Number(roundNumber) < finishRound) winnerClearBeforeFinish += 1;
    } else if (dominance.advantage <= -0.12) {
      loserClearRounds += 1;
      if (Number(roundNumber) < finishRound) loserClearBeforeFinish += 1;
    } else {
      closeRounds += 1;
    }
  }

  if (scoredRounds === 0) {
    return {
      hasRounds: false,
      score: 50,
      multiplier: 1,
      winnerClearRounds: 0,
      loserClearRounds: 0,
      closeRounds: 0,
      comebackFinish: false,
      reason: "",
    };
  }

  const score = round(totalScore / scoredRounds, 1);
  const finish = isFinish(fight.method);
  const trailingBeforeFinish = finish && loserClearBeforeFinish > winnerClearBeforeFinish;
  const comebackFinish = trailingBeforeFinish && finishRound >= 2;
  let multiplier = 1;
  const reasons = [];

  if (winnerClearRounds > loserClearRounds + 1) {
    multiplier += 0.04;
    reasons.push("winner_clear_round_edge");
  } else if (loserClearRounds > winnerClearRounds + 1) {
    multiplier -= 0.07;
    reasons.push("winner_lost_round_profile");
  }

  if (comebackFinish) {
    multiplier -= finishRound >= 3 ? 0.08 : 0.05;
    reasons.push("comeback_finish_after_trailing_rounds");
  }

  if (closeRounds >= Math.max(2, scoredRounds - 1)) {
    multiplier -= 0.03;
    reasons.push("mostly_close_rounds");
  }

  return {
    hasRounds: true,
    score,
    multiplier: round(clamp(multiplier, 0.84, 1.06), 4),
    winnerClearRounds,
    loserClearRounds,
    closeRounds,
    comebackFinish,
    reason: reasons.join("|"),
  };
}

function invertRoundDominance(roundDominance) {
  return {
    ...roundDominance,
    score: round(100 - num(roundDominance.score), 1),
    winnerClearRounds: roundDominance.loserClearRounds,
    loserClearRounds: roundDominance.winnerClearRounds,
    comebackFinish: false,
  };
}

function getRepeatabilityMultiplier(fight, dominance, roundDominance) {
  const finish = isFinish(fight.method);
  if (finish && roundDominance?.comebackFinish) {
    return {
      multiplier: 1,
      reason: roundDominance.reason,
    };
  }

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

function calculateOpponentContext({ opponent, opponentProfile, opponentTitleContexts, fightDate, opponentPreRating }) {
  const fightDateValue = new Date(fightDate);
  const ageAtFight = calculateAgeAtDate(opponentProfile?.dob_iso, fightDateValue);
  const recentWindowMonths = 30;
  const recentFights = opponent.lastFive.filter((previousFight) => {
    const age = monthsBetween(new Date(previousFight.date), fightDateValue);
    return age <= recentWindowMonths;
  });
  const recentWins = recentFights.filter((previousFight) => previousFight.result === "W").length;
  const recentLosses = recentFights.filter((previousFight) => previousFight.result === "L").length;
  const recentRatingChange = recentFights.reduce((sum, previousFight) => sum + num(previousFight.rating_change), 0);
  const losingStreak = calculateCurrentLosingStreak(opponent.lastFive);
  const monthsInactive = opponent.lastFightDate ? monthsBetween(new Date(opponent.lastFightDate), fightDateValue) : Infinity;
  const declining = recentLosses > recentWins || recentRatingChange < -10 || losingStreak > 0;
  const inactive = Number.isFinite(monthsInactive) && monthsInactive > 12;

  let ratingAdjustment = 0;
  const reasons = [];

  if (Number.isFinite(ageAtFight) && ageAtFight >= OLD_FIGHTER_AGE && (declining || inactive)) {
    const ageDeclinePenalty =
      ageAtFight >= VERY_OLD_FIGHTER_AGE
        ? 18 + (ageAtFight - VERY_OLD_FIGHTER_AGE) * 4
        : (ageAtFight - OLD_FIGHTER_AGE) * 6;
    const boundedPenalty = clamp(ageDeclinePenalty, 0, 35);
    ratingAdjustment -= boundedPenalty;
    reasons.push(`age_decline:${round(ageAtFight, 1)}`);
  }

  if (recentFights.length > 0 && recentLosses > recentWins) {
    const formPenalty = clamp((recentLosses - recentWins) * 9, 0, 27);
    ratingAdjustment -= formPenalty;
    reasons.push(`negative_form:${recentWins}-${recentLosses}`);
  }

  if (losingStreak >= 2) {
    const streakPenalty = clamp(losingStreak * 5, 0, 20);
    ratingAdjustment -= streakPenalty;
    reasons.push(`losing_streak:${losingStreak}`);
  }

  if (recentRatingChange < -15) {
    const trendPenalty = clamp((-recentRatingChange - 15) * 0.35, 0, 18);
    ratingAdjustment -= trendPenalty;
    reasons.push(`negative_trend:${round(recentRatingChange, 2)}`);
  }

  if (inactive) {
    const inactivityPenalty = clamp((monthsInactive - 12) * 1.25, 0, 22);
    ratingAdjustment -= inactivityPenalty;
    reasons.push(`opponent_inactivity:${round(monthsInactive, 1)}m`);
  }

  const primeAge = Number.isFinite(ageAtFight) && ageAtFight >= 27 && ageAtFight <= 33;
  if (primeAge && recentWins >= recentLosses && recentFights.length >= 2 && recentRatingChange > 15) {
    const primeBonus = clamp(8 + recentRatingChange * 0.08, 0, 18);
    ratingAdjustment += primeBonus;
    reasons.push(`prime_positive_form:${recentWins}-${recentLosses}`);
  }

  const titleContext = getActiveOpponentTitleContext(opponentTitleContexts, fightDateValue);
  if (titleContext) {
    const titleBonus = getOpponentTitleContextBonus(titleContext.tag);
    if (titleBonus > 0) {
      ratingAdjustment += titleBonus;
      reasons.push(`title_context:${titleContext.tag}`);
    }
  }

  const formScore = round(
    recentWins * 10 -
      recentLosses * 10 +
      recentRatingChange * 0.25 +
      Math.min(recentFights.length, 4) * 2 -
      losingStreak * 5 -
      (inactive ? Math.min(12, monthsInactive - 12) : 0),
    2,
  );
  const adjustedRating = round(opponentPreRating + clamp(ratingAdjustment, -65, 25), 2);
  const ratingMultiplier = round(clamp(1 + (adjustedRating - opponentPreRating) / 375, 0.82, 1.08), 4);

  return {
    ageAtFight: Number.isFinite(ageAtFight) ? round(ageAtFight, 1) : "",
    adjustedRating,
    formScore,
    ratingMultiplier,
    titleContextTag: titleContext?.tag ?? "",
    reasons,
  };
}

function getActiveOpponentTitleContext(titleContexts, fightDate) {
  return titleContexts.find((entry) => {
    if (!entry.event_date) return true;
    const eventDate = new Date(entry.event_date);
    if (Number.isNaN(eventDate.getTime())) return false;
    if (fightDate < eventDate) return false;
    const protectionMonths = Number(entry.protection_months ?? 18);
    return !Number.isFinite(protectionMonths) || monthsBetween(eventDate, fightDate) <= protectionMonths;
  });
}

function getOpponentTitleContextBonus(tag) {
  if (tag === "recent_champion") return 28;
  if (tag === "recent_title_loser") return 18;
  if (tag === "interim_champion") return 18;
  if (tag === "recent_title_challenger") return 12;
  if (tag === "former_champion") return 10;
  return 0;
}

function calculateAgeAtDate(dobIso, targetDate) {
  if (!dobIso) return Infinity;
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(targetDate.getTime())) return Infinity;
  return (targetDate.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function calculateCurrentLosingStreak(fights) {
  let streak = 0;
  for (let index = fights.length - 1; index >= 0; index -= 1) {
    if (fights[index].result !== "L") break;
    streak += 1;
  }
  return streak;
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

function calculateScoreComponents({ fighter, legacy, averageDominance, averageRoundDominance, monthsInactive }) {
  const recentRecordAdjustment = clamp((legacy.recentWins - legacy.recentLosses) * 8, -24, 24);
  const recentTrendAdjustment = clamp(legacy.recentRatingChange * 0.25, -20, 20);
  const recentFormAdjustment = round(recentRecordAdjustment + recentTrendAdjustment, 2);
  const recentOutcomeAdjustment = calculateRecentOutcomeAdjustment(fighter.lastFive, monthsInactive);
  const scheduleStrength = calculateScheduleStrength({
    fights: fighter.lastFive,
    recentFormAdjustment,
    totalFights: fighter.fights,
  });
  const recentActivityAdjustment = round(clamp(legacy.recentFightCount * 4, 0, 16), 2);
  const dominanceAdjustment = round(clamp((averageDominance - 50) * 0.45, -18, 18), 2);
  const roundDominanceAdjustment = round(clamp((averageRoundDominance - 50) * 0.25, -10, 10), 2);
  const finishRate = fighter.fights > 0 ? fighter.finishes / fighter.fights : 0;
  const finishAdjustment = round(clamp((finishRate - 0.35) * 24, -8, 14), 2);
  const titleWinAdjustment = calculateTitleWinAdjustment(fighter.lastFive);
  const qualityWinAdjustment = calculateQualityWinAdjustment(fighter.bestWin, legacy.bestWinAgeMonths);

  return {
    recentFormAdjustment,
    recentOutcomeAdjustment,
    scheduleStrengthAdjustment: scheduleStrength.adjustment,
    scheduleStrengthScore: scheduleStrength.score,
    scheduleStrengthStatus: scheduleStrength.status,
    avgWinOpponentRatingLast5: scheduleStrength.avgWinOpponentRatingLast5,
    bestWinOpponentRatingLast5: scheduleStrength.bestWinOpponentRatingLast5,
    recentActivityAdjustment,
    dominanceAdjustment,
    roundDominanceAdjustment,
    finishAdjustment,
    titleWinAdjustment,
    qualityWinAdjustment,
  };
}

function calculateScheduleStrength({ fights, recentFormAdjustment, totalFights }) {
  const recentFights = fights.slice(-5);
  const wins = recentFights.filter((fight) => fight.result === "W");
  const winRatings = wins.map(getFightOpponentRating).filter(Number.isFinite);
  const avgWinRating =
    winRatings.length > 0 ? winRatings.reduce((sum, rating) => sum + rating, 0) / winRatings.length : NaN;
  const bestWinRating = winRatings.length > 0 ? Math.max(...winRatings) : NaN;
  const provenWins = wins.filter((fight) => isProvenScheduleWin(fight)).length;
  const eliteWins = wins.filter((fight) => isEliteScheduleWin(fight)).length;
  const titleLineageWins = wins.filter((fight) => Boolean(fight.opponent_title_context)).length;
  const latestFight = recentFights.at(-1);

  let adjustment = 0;
  const statuses = [];

  if (wins.length >= 2 && Number.isFinite(avgWinRating) && avgWinRating >= 1605) {
    adjustment += clamp((avgWinRating - 1600) * 0.08 + eliteWins * 2, 2, 8);
    statuses.push("strong_recent_schedule");
  }

  if (
    wins.length >= 3 &&
    recentFormAdjustment > 18 &&
    provenWins === 0 &&
    titleLineageWins === 0 &&
    Number.isFinite(avgWinRating) &&
    avgWinRating < 1545
  ) {
    adjustment -= clamp(6 + (1545 - avgWinRating) * 0.16 + (wins.length - 3) * 2, 6, 16);
    statuses.push("weak_recent_schedule");
  }

  if (
    wins.length >= 4 &&
    recentFormAdjustment > 18 &&
    provenWins === 0 &&
    titleLineageWins === 0 &&
    Number.isFinite(bestWinRating) &&
    bestWinRating < 1560
  ) {
    adjustment -= 8;
    statuses.push("inflated_win_streak");
  }

  if (
    recentFormAdjustment > 28 &&
    provenWins === 0 &&
    titleLineageWins === 0 &&
    Number.isFinite(avgWinRating) &&
    avgWinRating < 1545
  ) {
    adjustment -= clamp(recentFormAdjustment - 20, 0, 12);
    statuses.push("recent_form_cap");
  }

  if (isEliteExposureLoss({ latestFight, previousFights: recentFights.slice(0, -1), totalFights })) {
    adjustment -= 10;
    statuses.push("elite_exposure_loss");
  }

  const score = Number.isFinite(avgWinRating) ? clamp((avgWinRating - 1500) / 1.6 + provenWins * 8 + eliteWins * 5, 0, 100) : NaN;

  return {
    adjustment: round(clamp(adjustment, -30, 10), 2),
    score: Number.isFinite(score) ? round(score, 1) : "",
    status: statuses.join("|"),
    avgWinOpponentRatingLast5: Number.isFinite(avgWinRating) ? round(avgWinRating, 2) : "",
    bestWinOpponentRatingLast5: Number.isFinite(bestWinRating) ? round(bestWinRating, 2) : "",
  };
}

function isProvenScheduleWin(fight) {
  const opponentRating = getFightOpponentRating(fight);
  return opponentRating >= 1560 || Boolean(fight.opponent_title_context);
}

function isEliteScheduleWin(fight) {
  const opponentRating = getFightOpponentRating(fight);
  return (
    opponentRating >= 1625 ||
    ["recent_champion", "recent_title_loser", "interim_champion"].includes(fight.opponent_title_context)
  );
}

function isEliteExposureLoss({ latestFight, previousFights, totalFights }) {
  if (!latestFight || latestFight.result !== "L") return false;
  if (totalFights > 10) return false;

  const opponentRating = getFightOpponentRating(latestFight);
  if (opponentRating < 1600) return false;
  if (!isFinish(latestFight.method) && num(latestFight.rating_change) > -16) return false;

  const previousWins = previousFights.filter((fight) => fight.result === "W");
  if (previousWins.length < 3) return false;

  const previousWinRatings = previousWins.map(getFightOpponentRating).filter(Number.isFinite);
  if (previousWinRatings.length === 0) return false;

  const previousAverage = previousWinRatings.reduce((sum, rating) => sum + rating, 0) / previousWinRatings.length;
  return previousAverage < 1580 && !previousWins.some(isEliteScheduleWin) && !previousWins.some(hasTitleLineageWin);
}

function hasTitleLineageWin(fight) {
  return Boolean(fight.opponent_title_context);
}

function getFightOpponentRating(fight) {
  const adjustedRating = num(fight?.opponent_adjusted_rating);
  if (Number.isFinite(adjustedRating) && adjustedRating > 0) return adjustedRating;

  const preRating = num(fight?.opponent_pre_rating);
  return Number.isFinite(preRating) && preRating > 0 ? preRating : NaN;
}

function calculateRecentOutcomeAdjustment(fights, monthsInactive) {
  const latestFight = fights.at(-1);
  if (!latestFight || latestFight.result !== "L") return 0;

  const recencyFactor = monthsInactive <= 12 ? 1 : monthsInactive <= 18 ? 0.6 : 0;
  if (recencyFactor === 0) return 0;

  const basePenalty = isFinish(latestFight.method) ? -10 : -5;
  return round(basePenalty * recencyFactor, 2);
}

function calculateTitleWinAdjustment(fights) {
  const adjustment = fights.reduce((total, fight) => {
    if (fight.result !== "W") return total;
    if (fight.opponent_title_context === "recent_champion") return total + 8;
    if (fight.opponent_title_context === "recent_title_loser") return total + 5;
    if (fight.opponent_title_context === "interim_champion") return total + 5;
    if (fight.opponent_title_context === "recent_title_challenger") return total + 4;
    if (fight.opponent_title_context === "former_champion") return total + 3;
    return total;
  }, 0);

  return round(clamp(adjustment, 0, 12), 2);
}

function calculateQualityWinAdjustment(bestWin, bestWinAgeMonths) {
  const opponentRating = bestWin?.adjusted_opponent_rating ?? bestWin?.opponent_pre_rating;
  if (!opponentRating || bestWinAgeMonths === "") return 0;

  const ageFactor = bestWinAgeMonths <= 24 ? 1 : bestWinAgeMonths <= 48 ? 0.65 : 0.35;
  const opponentAge = num(bestWin?.opponent_age_at_fight);
  const opponentFormScore = num(bestWin?.opponent_form_score);
  const opponentReasons = bestWin?.opponent_context_reasons ?? [];
  const olderDecliningOpponent = opponentAge >= OLD_FIGHTER_AGE && opponentFormScore < 0;
  const contextFactor = olderDecliningOpponent
    ? 0.6
    : opponentAge >= OLD_FIGHTER_AGE && opponentReasons.some((reason) => String(reason).startsWith("age_decline"))
      ? 0.75
      : 1;
  const adjustment = (opponentRating - 1540) * 0.22 * ageFactor * contextFactor;
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

function groupRoundStats(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.fight_id)) grouped.set(row.fight_id, []);
    grouped.get(row.fight_id).push(row);
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
      roundDominanceTotal: 0,
      roundDominanceSamples: 0,
      clearRoundsWon: 0,
      clearRoundsLost: 0,
      closeRounds: 0,
      comebackFinishes: 0,
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

async function readOptionalJson(filePath, fallback = null) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
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

async function readTitleContext(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readDivisionContext(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function buildTitleContextByFighter(titleContext) {
  const index = new Map();
  for (const division of titleContext?.divisions ?? []) {
    for (const entry of division.title_context ?? []) {
      const normalizedName = normalizeName(entry.fighter);
      if (!index.has(normalizedName)) index.set(normalizedName, []);
      index.get(normalizedName).push({
        ...entry,
        division: division.division,
      });
    }
  }
  return index;
}

function buildDivisionContextByFighter(divisionContext) {
  const index = new Map();
  for (const move of divisionContext?.division_moves ?? []) {
    const normalizedName = normalizeName(move.fighter);
    if (!index.has(normalizedName)) index.set(normalizedName, []);
    index.get(normalizedName).push(move);
  }
  return index;
}

function applyDivisionContextToSnapshot(currentSnapshot, divisionContext, asOfDate) {
  if (!currentSnapshot || !divisionContext?.division_moves?.length) return currentSnapshot;

  const snapshot = {
    ...currentSnapshot,
    divisions: currentSnapshot.divisions.map((division) => ({
      ...division,
      rankings: [...(division.rankings ?? [])],
    })),
  };
  const byDivision = new Map(snapshot.divisions.map((division) => [division.division, division]));

  for (const move of divisionContext.division_moves) {
    if (!isActiveDivisionMove(move, asOfDate)) continue;

    for (const division of snapshot.divisions) {
      division.rankings = division.rankings.filter((name) => normalizeName(name) !== normalizeName(move.fighter));
      if (normalizeName(division.champion) === normalizeName(move.fighter) && division.division !== move.to_division) {
        division.champion = "";
      }
    }

    const targetDivision = byDivision.get(move.to_division);
    if (!targetDivision || normalizeName(targetDivision.champion) === normalizeName(move.fighter)) continue;

    const contenderRank = Number(move.current_rank);
    const insertIndex = Number.isFinite(contenderRank)
      ? clamp(Math.max(0, contenderRank - 1), 0, targetDivision.rankings.length)
      : targetDivision.rankings.length;
    targetDivision.rankings.splice(insertIndex, 0, move.fighter);
    targetDivision.rankings = targetDivision.rankings.slice(0, 15);
  }

  return snapshot;
}

function getActiveDivisionMove(moves = [], divisionName, asOfDate) {
  return moves
    .filter((move) => move.to_division === divisionName && isActiveDivisionMove(move, asOfDate))
    .sort((a, b) => String(b.effective_date ?? "").localeCompare(String(a.effective_date ?? "")))[0];
}

function isActiveDivisionMove(move, asOfDate) {
  if (!move?.to_division) return false;
  if (move.effective_date) {
    const effectiveDate = new Date(move.effective_date);
    if (Number.isNaN(effectiveDate.getTime()) || effectiveDate > asOfDate) return false;
  }
  if (move.expires_on) {
    const expiresOn = new Date(move.expires_on);
    if (!Number.isNaN(expiresOn.getTime()) && expiresOn < asOfDate) return false;
  }
  return true;
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
    } else if (arg.startsWith("--title-context=")) {
      args.titleContextPath = arg.slice("--title-context=".length);
    } else if (arg.startsWith("--division-context=")) {
      args.divisionContextPath = arg.slice("--division-context=".length);
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
  --title-context=PATH           Manual title-lineage context JSON path.
  --division-context=PATH        Manual current-division transfer context JSON path.
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
