#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  fightImpactsPath: "data/model/fight_impacts.json",
  titleContextPath: "data/ranking_inputs/title_context.json",
  currentSnapshotPath: "data/ranking_inputs/current_division_snapshot.json",
  divisionContextPath: "data/ranking_inputs/division_context.json",
  outPath: "data/model/audit.json",
};

const STRICT_HEAD_TO_HEAD_WINDOW_MONTHS = 12;

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

  const [rankings, fightImpacts, titleContext, currentSnapshot, divisionContext] = await Promise.all([
    readJson(path.resolve(process.cwd(), args.rankingsPath)),
    readJson(path.resolve(process.cwd(), args.fightImpactsPath)),
    readOptionalJson(path.resolve(process.cwd(), args.titleContextPath)),
    readOptionalJson(path.resolve(process.cwd(), args.currentSnapshotPath)),
    readOptionalJson(path.resolve(process.cwd(), args.divisionContextPath)),
  ]);

  const audit = buildAudit({ rankings, fightImpacts, titleContext, currentSnapshot, divisionContext });
  await fs.mkdir(path.dirname(path.resolve(process.cwd(), args.outPath)), { recursive: true });
  await writeJson(path.resolve(process.cwd(), args.outPath), audit);
  printAuditSummary(audit, args.outPath);
}

function buildAudit({ rankings, fightImpacts, titleContext, currentSnapshot, divisionContext }) {
  const titleContextByDivision = new Map((titleContext?.divisions ?? []).map((division) => [division.division, division]));
  const divisionContextByFighter = buildDivisionContextByFighter(divisionContext);
  const checks = {
    champion: [],
    title_context: [],
    recent_head_to_head: [],
    elite_snapshot_drift: [],
    justified_elite_snapshot_drift: [],
    inactive_top_ranked: [],
    prospect_overboost: [],
    old_opponent_overcredit: [],
    large_policy_adjustments: [],
    large_baseline_policy_adjustments: [],
    data_quality: buildSnapshotDataQualityChecks(currentSnapshot),
  };
  const asOfDate = new Date(rankings.as_of);

  for (const division of rankings.divisions) {
    const ranked = division.rankings ?? [];
    const byName = new Map(ranked.map((fighter) => [normalizeName(fighter.fighter_name), fighter]));
    const champion = ranked[0];

    checks.champion.push({
      division: division.division,
      expected_champion: division.champion,
      actual_rank_1: champion?.fighter_name ?? "",
      pass: normalizeName(champion?.fighter_name) === normalizeName(division.champion),
    });

    for (const entry of titleContextByDivision.get(division.division)?.title_context ?? []) {
      if (entry.rank_policy === false) continue;
      const fighter = byName.get(normalizeName(entry.fighter));
      const maxRank = Number(entry.max_overall_rank ?? getDefaultTitleContextRank(entry.tag));
      checks.title_context.push({
        division: division.division,
        fighter: entry.fighter,
        tag: entry.tag,
        max_overall_rank: maxRank,
        actual_rank: fighter?.rank ?? null,
        pass: Boolean(fighter && fighter.rank <= maxRank),
      });
    }

    for (const fighter of ranked.slice(0, 10)) {
      if (num(fighter.months_inactive) > 18) {
        checks.inactive_top_ranked.push({
          division: division.division,
          rank: fighter.rank,
          fighter: fighter.fighter_name,
          months_inactive: fighter.months_inactive,
        });
      }

      if (isProspectOverboost(fighter, ranked)) {
        checks.prospect_overboost.push({
          division: division.division,
          rank: fighter.rank,
          fighter: fighter.fighter_name,
          ufc_division_fights: fighter.ufc_division_fights,
          entry_gate_status: fighter.entry_gate_status,
          entry_gate_penalty: fighter.entry_gate_penalty,
        });
      }
    }

    for (const fighter of ranked) {
      const eliteSnapshotMaxRank = getEliteSnapshotMaxRank(fighter);
      if (eliteSnapshotMaxRank !== null && fighter.rank > eliteSnapshotMaxRank) {
        const driftCheck = {
          division: division.division,
          fighter: fighter.fighter_name,
          current_status: fighter.current_status,
          snapshot_rank: fighter.current_snapshot_rank,
          actual_rank: fighter.rank,
          max_expected_rank: eliteSnapshotMaxRank,
          title_context_status: fighter.title_context_status,
          rank_guard_status: fighter.rank_guard_status,
          justification: getEliteSnapshotDriftJustification(fighter),
        };
        if (driftCheck.justification) {
          checks.justified_elite_snapshot_drift.push(driftCheck);
        } else {
          checks.elite_snapshot_drift.push(driftCheck);
        }
      }

      if (
        num(fighter.quality_win_adjustment) >= 20 &&
        num(fighter.best_win?.opponent_age_at_fight) >= 36 &&
        hasMaterialDeclineContext(fighter.best_win)
      ) {
        checks.old_opponent_overcredit.push({
          division: division.division,
          rank: fighter.rank,
          fighter: fighter.fighter_name,
          best_win: fighter.best_win?.opponent_name ?? "",
          opponent_age_at_fight: fighter.best_win?.opponent_age_at_fight ?? "",
          opponent_form_score: fighter.best_win?.opponent_form_score ?? "",
          quality_win_adjustment: fighter.quality_win_adjustment,
        });
      }

      const policyAdjustments = {
        current_context_prior: num(fighter.current_context_prior),
        current_context_adjustment: num(fighter.current_context_adjustment),
        title_context_adjustment: num(fighter.title_context_adjustment),
        rank_guard_adjustment: num(fighter.rank_guard_adjustment),
        head_to_head_adjustment: num(fighter.head_to_head_adjustment),
        snapshot_order_adjustment: num(fighter.snapshot_order_adjustment),
        title_guard_adjustment: num(fighter.title_guard_adjustment),
        entry_gate_penalty: -num(fighter.entry_gate_penalty),
        top_contender_credibility_penalty: -num(fighter.top_contender_credibility_penalty),
      };

      const rescuePolicyAdjustments = {
        title_context_adjustment: policyAdjustments.title_context_adjustment,
        rank_guard_adjustment: policyAdjustments.rank_guard_adjustment,
        head_to_head_adjustment: policyAdjustments.head_to_head_adjustment,
        snapshot_order_adjustment: policyAdjustments.snapshot_order_adjustment,
        title_guard_adjustment: policyAdjustments.title_guard_adjustment,
        entry_gate_penalty: policyAdjustments.entry_gate_penalty,
        top_contender_credibility_penalty: policyAdjustments.top_contender_credibility_penalty,
      };
      const rescuePolicyTotal = Object.values(rescuePolicyAdjustments).reduce((total, value) => total + value, 0);
      const largeRescueComponent = Object.entries(rescuePolicyAdjustments)
        .filter(([, value]) => Math.abs(value) >= 50)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];

      if (largeRescueComponent || Math.abs(rescuePolicyTotal) >= 50) {
        checks.large_policy_adjustments.push({
          division: division.division,
          rank: fighter.rank,
          fighter: fighter.fighter_name,
          rescue_policy_adjustment: round(rescuePolicyTotal, 2),
          primary_large_component: largeRescueComponent?.[0] ?? "combined_rescue_policy",
          ...policyAdjustments,
        });
      }

      if (
        Math.abs(policyAdjustments.current_context_prior) >= 50 &&
        !largeRescueComponent &&
        Math.abs(rescuePolicyTotal) < 50
      ) {
        checks.large_baseline_policy_adjustments.push({
          division: division.division,
          rank: fighter.rank,
          fighter: fighter.fighter_name,
          current_context_prior: policyAdjustments.current_context_prior,
          current_context_adjustment: policyAdjustments.current_context_adjustment,
        });
      }

      const sourceDivision = fighter.source_division;
      const displayDivision = fighter.display_division ?? division.division;
      const hasDivisionContext = Boolean(
        getActiveDivisionMove(divisionContextByFighter.get(normalizeName(fighter.fighter_name)), displayDivision, asOfDate),
      );
      if (!fighter.fighter_id || fighter.current_status === "Current snapshot only") {
        checks.data_quality.push({
          type: "snapshot_missing_ufcstats_profile",
          division: division.division,
          fighter: fighter.fighter_name,
          detail: "Ranked in the current snapshot but no UFCStats profile/model row was matched.",
        });
      }
      if (sourceDivision && displayDivision && sourceDivision !== displayDivision && !hasDivisionContext) {
        checks.data_quality.push({
          type: "uncontextualized_division_transfer",
          division: division.division,
          fighter: fighter.fighter_name,
          detail: `Model source division is ${sourceDivision}, display division is ${displayDivision}, but no division_context entry explains it.`,
        });
      }
      if (fighter.current_status === "Champion" && num(fighter.months_inactive) > 24) {
        checks.data_quality.push({
          type: "stale_champion_activity",
          division: division.division,
          fighter: fighter.fighter_name,
          detail: `Champion has ${fighter.months_inactive} months inactive in the model output.`,
        });
      }
    }

    for (const impact of fightImpacts) {
      if (impact.division !== division.division) continue;
      if (monthsBetween(new Date(impact.event_date), new Date(rankings.as_of)) > STRICT_HEAD_TO_HEAD_WINDOW_MONTHS) {
        continue;
      }

      const winner = byName.get(normalizeName(impact.winner_name));
      const loser = byName.get(normalizeName(impact.loser_name));
      if (!winner || !loser || loser.current_status === "Champion") continue;
      if (hasDamagingLossAfter(winner, impact.event_date)) continue;
      if (winner.rank > loser.rank) {
        checks.recent_head_to_head.push({
          division: division.division,
          fight_date: impact.event_date,
          winner: winner.fighter_name,
          winner_rank: winner.rank,
          loser: loser.fighter_name,
          loser_rank: loser.rank,
          method: impact.method,
        });
      }
    }
  }

  for (const impact of fightImpacts) {
    if (impact.event_date > rankings.as_of) {
      checks.data_quality.push({
        type: "fight_after_rankings_as_of",
        division: impact.division,
        fighter: impact.winner_name,
        detail: `${impact.event_date} is after rankings as_of ${rankings.as_of}.`,
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    model_version: rankings.model_version,
    as_of: rankings.as_of,
    summary: {
      champion_failures: checks.champion.filter((check) => !check.pass).length,
      title_context_failures: checks.title_context.filter((check) => !check.pass).length,
      recent_head_to_head_violations: checks.recent_head_to_head.length,
      elite_snapshot_drift: checks.elite_snapshot_drift.length,
      justified_elite_snapshot_drift: checks.justified_elite_snapshot_drift.length,
      inactive_top_ranked: checks.inactive_top_ranked.length,
      prospect_overboost: checks.prospect_overboost.length,
      old_opponent_overcredit: checks.old_opponent_overcredit.length,
      large_policy_adjustments: checks.large_policy_adjustments.length,
      large_baseline_policy_adjustments: checks.large_baseline_policy_adjustments.length,
      data_quality_flags: checks.data_quality.length,
    },
    checks,
  };
}

function getDefaultTitleContextRank(tag) {
  if (tag === "recent_title_loser") return 2;
  if (tag === "recent_champion") return 4;
  if (tag === "interim_champion") return 4;
  if (tag === "recent_title_challenger") return 5;
  if (tag === "former_champion") return 6;
  return null;
}

function getEliteSnapshotMaxRank(fighter) {
  if (fighter.current_status === "Champion") return 1;

  const snapshotRank = Number(fighter.current_snapshot_rank);
  if (!Number.isFinite(snapshotRank) || snapshotRank <= 0 || snapshotRank > 5) return null;
  if (snapshotRank === 1) return 3;
  if (snapshotRank <= 3) return 7;
  return 8;
}

function getEliteSnapshotDriftJustification(fighter) {
  const losses = (fighter.last_five ?? []).filter((fight) => fight.result === "L").length;
  const recentLosses = (fighter.last_five ?? [])
    .slice(0, 3)
    .filter((fight) => fight.result === "L").length;
  const latestFight = fighter.last_five?.[0];

  if (latestFight?.result === "L" && isFinish(latestFight.method)) return "latest_finish_loss";
  if (recentLosses >= 2 && num(fighter.recent_form_adjustment) <= -8) return "recent_losses";
  if (losses >= 3 && num(fighter.legacy_penalty) >= 20) return "legacy_and_losses";
  if (num(fighter.schedule_strength_adjustment) <= -15 && latestFight?.result === "L") return "weak_schedule_and_latest_loss";
  if (num(fighter.legacy_penalty) >= 35 && num(fighter.recent_form_adjustment) <= -8) return "legacy_decay";
  return "";
}

function hasMaterialDeclineContext(bestWin) {
  const formScore = num(bestWin?.opponent_form_score);
  const contextReasons = bestWin?.opponent_context_reasons ?? [];
  return formScore <= -8 || contextReasons.some((reason) => String(reason).startsWith("losing_streak"));
}

function isProspectOverboost(fighter, ranked) {
  if (fighter.current_status === "Champion") return false;
  if (num(fighter.ufc_division_fights) >= 4) return false;

  const rankedNames = new Set(ranked.map((entry) => normalizeName(entry.fighter_name)));
  const rankedWins = countRankedWins(fighter, rankedNames);
  const transferContext =
    Boolean(fighter.division_context_status || fighter.transfer_source_division) ||
    (fighter.source_division && fighter.display_division && fighter.source_division !== fighter.display_division);
  const titleLineageContext = num(fighter.title_win_adjustment) > 0 || Boolean(fighter.title_context_status);
  const strongBestWin = num(fighter.quality_win_adjustment) >= 18 || num(fighter.best_win?.adjusted_opponent_rating) >= 1600;
  const alreadyPenalized = Boolean(fighter.entry_gate_status) || num(fighter.entry_gate_penalty) > 0;
  const multipleQualityWins = countQualityWins(fighter) >= 2;

  if (alreadyPenalized) return false;
  return !(transferContext || titleLineageContext || strongBestWin || rankedWins > 0 || multipleQualityWins);
}

function countRankedWins(fighter, rankedNames) {
  return (fighter.last_five ?? []).filter(
    (fight) => fight.result === "W" && rankedNames.has(normalizeName(fight.opponent_name)),
  ).length;
}

function countQualityWins(fighter) {
  return (fighter.last_five ?? []).filter((fight) => fight.result === "W" && num(fight.rating_change) >= 16).length;
}

function hasDamagingLossAfter(fighter, date) {
  return (fighter.last_five ?? []).some(
    (fight) =>
      fight.result === "L" &&
      fight.date > date &&
      (isFinish(fight.method) || num(fight.rating_change) <= -18),
  );
}

function isFinish(methodName) {
  return /ko\/tko|submission|doctor|could not continue|dq/i.test(methodName ?? "");
}

function buildSnapshotDataQualityChecks(currentSnapshot) {
  const checks = [];
  const seen = new Map();

  for (const division of currentSnapshot?.divisions ?? []) {
    const entries = [
      { fighter: division.champion, slot: "Champion" },
      ...(division.rankings ?? []).map((fighter, index) => ({
        fighter,
        slot: `Contender #${index + 1}`,
      })),
    ].filter((entry) => entry.fighter);

    for (const entry of entries) {
      const normalizedName = normalizeName(entry.fighter);
      const previous = seen.get(normalizedName);
      if (previous) {
        checks.push({
          type: "duplicate_snapshot_entry",
          division: division.division,
          fighter: entry.fighter,
          detail: `Also appears in ${previous.division} as ${previous.slot}.`,
        });
      } else {
        seen.set(normalizedName, {
          division: division.division,
          slot: entry.slot,
        });
      }
    }
  }

  return checks;
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
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
    } else if (arg.startsWith("--fight-impacts=")) {
      args.fightImpactsPath = arg.slice("--fight-impacts=".length);
    } else if (arg.startsWith("--title-context=")) {
      args.titleContextPath = arg.slice("--title-context=".length);
    } else if (arg.startsWith("--current-snapshot=")) {
      args.currentSnapshotPath = arg.slice("--current-snapshot=".length);
    } else if (arg.startsWith("--division-context=")) {
      args.divisionContextPath = arg.slice("--division-context=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Audit generated OctagonRank rankings for known ranking failure modes.

Usage:
  npm run model:audit
  node scripts/audit-rankings.mjs --rankings=data/model/rankings.json --out=data/model/audit.json

Options:
  --rankings=PATH       Generated rankings JSON path.
  --fight-impacts=PATH  Generated fight impacts JSON path.
  --title-context=PATH  Manual title context JSON path.
  --current-snapshot=PATH  Current snapshot JSON path.
  --division-context=PATH  Manual division context JSON path.
  --out=PATH            Audit output JSON path.
`);
}

function printAuditSummary(audit, outPath) {
  console.log(`Wrote audit report to ${outPath}`);
  for (const [check, count] of Object.entries(audit.summary)) {
    console.log(`${check}: ${count}`);
  }
}

function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function monthsBetween(startDate, endDate) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return Infinity;
  const days = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, days / 30.4375);
}

function num(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(num(value) * factor) / factor;
}
