#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  modelDir: "data/model",
  outDir: "public/model",
};

const MODEL_COMPONENTS = [
  ["recent_form_adjustment", "Recent form"],
  ["recent_outcome_adjustment", "Latest result"],
  ["schedule_strength_adjustment", "Opponent quality"],
  ["recent_activity_adjustment", "Recent activity"],
  ["dominance_adjustment", "Fight control"],
  ["round_dominance_adjustment", "Round control"],
  ["finish_adjustment", "Finishing threat"],
  ["title_win_adjustment", "Title-level wins"],
  ["elite_resume_adjustment", "Elite resume"],
  ["quality_win_adjustment", "Best win"],
  ["current_division_overlay_adjustment", "Division move context"],
];

const PENALTY_COMPONENTS = [
  ["inactivity_penalty", "Time away"],
  ["legacy_penalty", "Older resume discount"],
  ["division_transfer_penalty", "New division uncertainty"],
  ["top_contender_credibility_penalty", "Top-contender proof"],
  ["entry_gate_penalty", "More ranked proof needed"],
];

const POLICY_COMPONENTS = [
  ["current_context_prior", "Current division picture"],
  ["title_guard_adjustment", "Champion protection"],
  ["title_context_adjustment", "Title-fight context"],
  ["rank_guard_adjustment", "Ranking stability"],
  ["head_to_head_adjustment", "Direct matchup"],
  ["snapshot_order_adjustment", "Close-rank tiebreaker"],
];

const POSITIVE_SIGNAL_COPY = {
  recent_form_adjustment: "their recent run has been strong",
  recent_outcome_adjustment: "their latest result helped their case",
  schedule_strength_adjustment: "they have been fighting stronger opposition",
  recent_activity_adjustment: "they have stayed active enough for the ranking to stay fresh",
  dominance_adjustment: "the fight stats show they have controlled more of their minutes",
  round_dominance_adjustment: "the round-by-round numbers back up the placement",
  finish_adjustment: "their finishing threat creates separation",
  title_win_adjustment: "they own title-level wins",
  elite_resume_adjustment: "their elite resume still carries real weight",
  quality_win_adjustment: "their best win grades well",
  current_division_overlay_adjustment: "their work in this weight class carries over cleanly",
};

const NEGATIVE_SIGNAL_COPY = {
  recent_form_adjustment: "a colder recent run",
  recent_outcome_adjustment: "their latest result",
  schedule_strength_adjustment: "a lighter recent schedule",
  recent_activity_adjustment: "limited recent activity",
  dominance_adjustment: "less control in the fight stats",
  round_dominance_adjustment: "less round-by-round control",
  finish_adjustment: "fewer separation wins",
  title_win_adjustment: "less recent title-level proof",
  elite_resume_adjustment: "older elite wins being worth less than recent ones",
  quality_win_adjustment: "no recent best win strong enough to pull them higher",
  current_division_overlay_adjustment: "uncertainty from changing divisions",
  inactivity_penalty: "the time since their last fight",
  legacy_penalty: "older wins being discounted more than recent wins",
  division_transfer_penalty: "uncertainty after moving divisions",
  top_contender_credibility_penalty: "the need for another recent elite win",
  entry_gate_penalty: "limited ranked evidence so far",
};

const RULE_SIGNAL_COPY = {
  current_context_prior: {
    champion: "use champion status as the division baseline",
    contender: "keep the current division picture in the calculation",
  },
  title_guard_adjustment: {
    champion: "keep the belt holder on top until a new result changes that",
    contender: "protect current champion logic from being treated like a normal contender score",
  },
  title_context_adjustment: {
    champion: "keep recent title-fight context attached to the score",
    contender: "keep recent title-fight results close to the front of the line",
  },
  rank_guard_adjustment: {
    champion: "limit noisy drops when the resume still supports the belt-line placement",
    contender: "prevent one noisy signal from dropping an established contender too far",
  },
  head_to_head_adjustment: {
    champion: "use recent direct fights to settle close ordering",
    contender: "use recent direct fights as a tiebreaker",
  },
  snapshot_order_adjustment: {
    champion: "use the live division order only when scores are very close",
    contender: "use the current public order as a tiebreaker when scores are close",
  },
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

  const modelDir = path.resolve(process.cwd(), args.modelDir);
  const outDir = path.resolve(process.cwd(), args.outDir);
  await fs.mkdir(outDir, { recursive: true });

  const [rankings, explanations, summary, backtest, audit] = await Promise.all([
    readJson(path.join(modelDir, "rankings.json")),
    readOptionalJson(path.join(modelDir, "explanations.json"), null),
    readOptionalJson(path.join(modelDir, "summary.json"), null),
    readOptionalJson(path.join(modelDir, "backtest.json"), null),
    readOptionalJson(path.join(modelDir, "audit.json"), null),
  ]);

  const explanationByFighter = buildExplanationMap(explanations);
  const exportedRankings = buildRankingsExport(rankings, explanationByFighter);
  const exportedExplanations = buildExplanationsExport(explanations);
  const exportedSummary = {
    generated_at: new Date().toISOString(),
    rankings_as_of: rankings.as_of,
    model_version: rankings.model_version,
    source: rankings.source,
    model_summary: summary,
    input_summary: rankings.input_summary,
    model_settings: {
      k_factor: rankings.model_settings?.k_factor,
      pre_fight_context_weight: rankings.model_settings?.pre_fight_context_weight,
      score_band_tie_threshold: rankings.model_settings?.score_band_tie_threshold,
      score_band_close_threshold: rankings.model_settings?.score_band_close_threshold,
    },
    methodology: rankings.methodology,
    backtest_summary: backtest?.summary ?? buildBacktestSummary(backtest),
    audit_summary: audit?.summary ?? audit ?? null,
  };

  await Promise.all([
    writeJson(path.join(outDir, "rankings.json"), exportedRankings),
    writeJson(path.join(outDir, "explanations.json"), exportedExplanations),
    writeJson(path.join(outDir, "summary.json"), exportedSummary),
  ]);

  console.log(`Exported model data to ${args.outDir}`);
  console.log(`divisions: ${exportedRankings.divisions.length}`);
  console.log(`fighters: ${exportedRankings.divisions.reduce((total, division) => total + 1 + division.rankings.length, 0)}`);
}

function buildRankingsExport(rankings, explanationByFighter) {
  return {
    generated_at: new Date().toISOString(),
    rankings_as_of: rankings.as_of,
    model_version: rankings.model_version,
    source: rankings.source,
    divisions: (rankings.divisions ?? []).map((division) => {
      const rows = division.rankings ?? [];
      const champion = rows.find((fighter) => fighter.current_status === "Champion") ?? rows[0];
      const contenders = rows.filter((fighter) => fighter !== champion).slice(0, 15);
      return {
        division: division.division,
        champion: compactFighter(champion, division.division, explanationByFighter, {
          isChampion: true,
          displayRank: 0,
        }),
        rankings: contenders.map((fighter, index) =>
          compactFighter(fighter, division.division, explanationByFighter, {
            isChampion: false,
            displayRank: index + 1,
          }),
        ),
      };
    }),
  };
}

function compactFighter(fighter, divisionName, explanationByFighter, { isChampion, displayRank }) {
  const explanation = explanationByFighter.get(fighterKey(divisionName, fighter.fighter_name));
  const components = buildComponents(fighter, MODEL_COMPONENTS);
  const penalties = buildComponents(fighter, PENALTY_COMPONENTS);
  const policyComponents = buildComponents(fighter, POLICY_COMPONENTS);
  const fanExplanation = buildFanExplanation({
    fighter,
    divisionName,
    isChampion,
    displayRank,
    components,
    penalties,
    policyComponents,
  });
  return {
    fighter_id: fighter.fighter_id,
    fighter_name: fighter.fighter_name,
    division: divisionName,
    display_rank: displayRank,
    model_rank: explanation?.model_rank ?? null,
    source_rank: fighter.rank,
    is_champion: isChampion,
    current_status: fighter.current_status,
    final_score: num(fighter.final_score),
    model_score: num(fighter.model_score),
    base_rating: num(fighter.base_rating),
    policy_total: round(num(fighter.final_score) - num(fighter.model_score), 2),
    score_confidence: fighter.score_confidence ?? "",
    score_confidence_label: fighter.score_confidence_label ?? "",
    score_confidence_detail: fighter.score_confidence_detail ?? "",
    score_gap_above: nullableNumber(fighter.score_gap_above),
    score_gap_below: nullableNumber(fighter.score_gap_below),
    nearest_score_gap: nullableNumber(fighter.nearest_score_gap),
    score_band_rank_range: fighter.score_band_rank_range ?? "",
    score_band_size: num(fighter.score_band_size),
    score_band_risk: fighter.score_band_risk ?? "",
    record: fighter.division_record,
    wins: num(fighter.wins),
    losses: num(fighter.losses),
    finishes: num(fighter.finishes),
    months_inactive: num(fighter.months_inactive),
    recent_record_30m: fighter.recent_record_30m,
    recent_fights_30m: num(fighter.recent_fights_30m),
    recent_rating_change_30m: num(fighter.recent_rating_change_30m),
    last_fight_date: fighter.last_fight_date,
    average_dominance: num(fighter.average_dominance),
    average_round_dominance: num(fighter.average_round_dominance),
    elite_resume_score: num(fighter.elite_resume_score),
    elite_resume_tier: fighter.elite_resume_tier,
    elite_resume_summary: fighter.elite_resume_summary,
    schedule_strength_score: nullableNumber(fighter.schedule_strength_score),
    schedule_strength_status: fighter.schedule_strength_status,
    best_win: fighter.best_win
      ? {
          opponent_name: fighter.best_win.opponent_name,
          event_date: fighter.best_win.event_date,
          method: fighter.best_win.method,
          opponent_pre_rating: num(fighter.best_win.opponent_pre_rating),
          adjusted_opponent_rating: num(fighter.best_win.adjusted_opponent_rating),
        }
      : null,
    totals: fighter.totals ?? {},
    components,
    penalties,
    policy_components: policyComponents,
    last_five: (fighter.last_five ?? []).slice(0, 5).map((fight) => ({
      date: fight.date,
      result: fight.result,
      opponent_name: fight.opponent_name,
      method: fight.method,
      rating_change: num(fight.rating_change),
      dominance_score: nullableNumber(fight.dominance_score),
      round_dominance_score: nullableNumber(fight.round_dominance_score),
      opponent_adjusted_rating: nullableNumber(fight.opponent_adjusted_rating),
      opponent_title_context: fight.opponent_title_context ?? "",
    })),
    explanation: fanExplanation,
    top_positive_drivers: explanation?.top_positive_drivers ?? [],
    top_negative_drivers: explanation?.top_negative_drivers ?? [],
  };
}

function buildExplanationsExport(explanations) {
  const divisions = (explanations?.divisions ?? []).map((division) => ({
    division: division.division,
    fighters: (division.fighters ?? []).map((fighter) => {
      const isChampion = fighter.current_status === "Champion";
      return {
        rank: fighter.rank,
        model_rank: fighter.model_rank,
        fighter_name: fighter.fighter_name,
        final_score: fighter.final_score,
        model_score: fighter.model_score,
        policy_total: fighter.policy_total,
        explanation: buildFanExplanation({
          fighter,
          divisionName: division.division,
          isChampion,
          displayRank: isChampion ? 0 : fighter.rank,
          components: [...(fighter.top_positive_drivers ?? []), ...(fighter.top_negative_drivers ?? [])],
          penalties: fighter.penalties ?? [],
          policyComponents: fighter.policy_components ?? [],
        }),
        top_positive_drivers: fighter.top_positive_drivers ?? [],
        top_negative_drivers: fighter.top_negative_drivers ?? [],
        policy_components: fighter.policy_components ?? [],
        penalties: fighter.penalties ?? [],
      };
    }),
  }));

  return {
    generated_at: new Date().toISOString(),
    rankings_as_of: explanations?.rankings_as_of ?? "",
    rankings_model_version: explanations?.rankings_model_version ?? "",
    summary: explanations?.summary ?? null,
    divisions,
  };
}

function buildExplanationMap(explanations) {
  const entries = new Map();
  for (const division of explanations?.divisions ?? []) {
    for (const fighter of division.fighters ?? []) {
      entries.set(fighterKey(division.division, fighter.fighter_name), fighter);
    }
  }
  return entries;
}

function buildComponents(fighter, specs) {
  return specs
    .map(([key, label]) => ({
      key,
      label,
      value: round(num(fighter[key]), 2),
    }))
    .filter((component) => component.value !== 0);
}

function buildFanExplanation({ fighter, divisionName, isChampion, displayRank, components, penalties, policyComponents }) {
  const name = fighter.fighter_name;
  const placement = isChampion ? `the ${divisionName} champion` : `the #${displayRank} contender in ${divisionName}`;
  const positives = sortedByImpact(components)
    .filter((component) => component.value > 0)
    .slice(0, 2)
    .map((component) => POSITIVE_SIGNAL_COPY[component.key] ?? `${component.label.toLowerCase()} helps him`);
  const drag = sortedByImpact([...components, ...penalties]).find((component) => component.value < 0);
  const rule = sortedByImpact(policyComponents).find((component) => Math.abs(component.value) >= 2);
  const sentences = [];

  if (positives.length) {
    sentences.push(`With our OctagonRank model, ${name} sits as ${placement} because ${joinNatural(positives)}.`);
  } else {
    sentences.push(
      `With our OctagonRank model, ${name} sits as ${placement} because their full resume and current division context still grade well.`,
    );
  }

  if (drag) {
    const dragCopy = NEGATIVE_SIGNAL_COPY[drag.key] ?? `${drag.label.toLowerCase()} holding them back`;
    sentences.push(`The main thing holding them back is ${dragCopy}.`);
  }

  if (rule) {
    const ruleCopy = describeRuleSignal(rule, isChampion);
    if (ruleCopy) sentences.push(`The ranking rules also ${ruleCopy}.`);
  }

  if (fighter.score_confidence === "virtual_tie" || fighter.score_confidence === "fragile") {
    sentences.push("This spot is close enough that one strong result could move them quickly.");
  }

  return sentences.join(" ");
}

function sortedByImpact(components) {
  return [...components]
    .filter((component) => Number.isFinite(num(component.value)) && Math.abs(num(component.value)) > 0)
    .sort((a, b) => Math.abs(num(b.value)) - Math.abs(num(a.value)));
}

function describeRuleSignal(component, isChampion) {
  const copy = RULE_SIGNAL_COPY[component.key];
  if (!copy) return "";
  return isChampion ? copy.champion : copy.contender;
}

function joinNatural(items) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function buildBacktestSummary(backtest) {
  if (!backtest) return null;
  return {
    fights: backtest.fights,
    accuracy: backtest.accuracy,
    validation_score: backtest.validation_score,
    brier_score: backtest.brier_score,
    log_loss: backtest.log_loss,
  };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing model file: ${filePath}. Run npm run model:rankings and npm run model:explain first.`);
    }
    throw error;
  }
}

async function readOptionalJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
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
    } else if (arg.startsWith("--model-dir=")) {
      args.modelDir = arg.slice("--model-dir=".length);
    } else if (arg.startsWith("--out-dir=")) {
      args.outDir = arg.slice("--out-dir=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Export compact model artifacts for the static frontend.

Usage:
  npm run model:export
  node scripts/export-model-public.mjs --model-dir=data/model --out-dir=public/model

Options:
  --model-dir=PATH  Generated model directory.
  --out-dir=PATH    Static output directory served by Vite/GitHub Pages.
`);
}

function fighterKey(division, fighter) {
  return `${normalizeName(division)}|${normalizeName(fighter)}`;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? round(parsed, 2) : null;
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
