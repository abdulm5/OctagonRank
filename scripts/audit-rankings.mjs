#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  fightImpactsPath: "data/model/fight_impacts.json",
  titleContextPath: "data/ranking_inputs/title_context.json",
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

  const [rankings, fightImpacts, titleContext] = await Promise.all([
    readJson(path.resolve(process.cwd(), args.rankingsPath)),
    readJson(path.resolve(process.cwd(), args.fightImpactsPath)),
    readOptionalJson(path.resolve(process.cwd(), args.titleContextPath)),
  ]);

  const audit = buildAudit({ rankings, fightImpacts, titleContext });
  await fs.mkdir(path.dirname(path.resolve(process.cwd(), args.outPath)), { recursive: true });
  await writeJson(path.resolve(process.cwd(), args.outPath), audit);
  printAuditSummary(audit, args.outPath);
}

function buildAudit({ rankings, fightImpacts, titleContext }) {
  const titleContextByDivision = new Map((titleContext?.divisions ?? []).map((division) => [division.division, division]));
  const checks = {
    champion: [],
    title_context: [],
    recent_head_to_head: [],
    inactive_top_ranked: [],
    prospect_overboost: [],
    old_opponent_overcredit: [],
    large_policy_adjustments: [],
  };

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

      if (num(fighter.ufc_division_fights) < 4 && fighter.current_status !== "Champion") {
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
      if (
        num(fighter.quality_win_adjustment) >= 20 &&
        num(fighter.best_win?.opponent_age_at_fight) >= 36 &&
        num(fighter.best_win?.opponent_form_score) < 0
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
        current_context_adjustment: num(fighter.current_context_adjustment),
        title_context_adjustment: num(fighter.title_context_adjustment),
        rank_guard_adjustment: num(fighter.rank_guard_adjustment),
        head_to_head_adjustment: num(fighter.head_to_head_adjustment),
        title_guard_adjustment: num(fighter.title_guard_adjustment),
      };
      if (Object.values(policyAdjustments).some((value) => Math.abs(value) >= 50)) {
        checks.large_policy_adjustments.push({
          division: division.division,
          rank: fighter.rank,
          fighter: fighter.fighter_name,
          ...policyAdjustments,
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

  return {
    generated_at: new Date().toISOString(),
    model_version: rankings.model_version,
    as_of: rankings.as_of,
    summary: {
      champion_failures: checks.champion.filter((check) => !check.pass).length,
      title_context_failures: checks.title_context.filter((check) => !check.pass).length,
      recent_head_to_head_violations: checks.recent_head_to_head.length,
      inactive_top_ranked: checks.inactive_top_ranked.length,
      prospect_overboost: checks.prospect_overboost.length,
      old_opponent_overcredit: checks.old_opponent_overcredit.length,
      large_policy_adjustments: checks.large_policy_adjustments.length,
    },
    checks,
  };
}

function getDefaultTitleContextRank(tag) {
  if (tag === "recent_title_loser") return 2;
  if (tag === "recent_champion") return 4;
  if (tag === "interim_champion") return 4;
  if (tag === "former_champion") return 6;
  return null;
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
