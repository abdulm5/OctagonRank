#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  rankingsPath: "data/model/rankings.json",
  assertionsPath: "data/ranking_inputs/model_assertions.json",
  outPath: "",
  failOnRegression: true,
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

  const [rankings, assertionFile] = await Promise.all([
    readJson(path.resolve(process.cwd(), args.rankingsPath)),
    readJson(path.resolve(process.cwd(), args.assertionsPath)),
  ]);
  const result = evaluateAssertions({ rankings, assertionFile });
  if (args.outPath) {
    const outputPath = path.resolve(process.cwd(), args.outPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  printResult(result, args);

  if (args.failOnRegression && result.failures.length > 0) {
    process.exitCode = 1;
  }
}

function evaluateAssertions({ rankings, assertionFile }) {
  const divisions = new Map((rankings.divisions ?? []).map((division) => [division.division, division]));
  const checks = [];

  for (const [index, assertion] of (assertionFile.assertions ?? []).entries()) {
    checks.push(evaluateAssertion({ assertion, divisions, index }));
  }

  return {
    version: assertionFile.version ?? "",
    total: checks.length,
    passed: checks.filter((check) => check.pass).length,
    failed: checks.filter((check) => !check.pass).length,
    checks,
    failures: checks.filter((check) => !check.pass),
  };
}

function evaluateAssertion({ assertion, divisions, index }) {
  const division = divisions.get(assertion.division);
  if (!division) {
    return fail(assertion, index, `Division not found: ${assertion.division}`);
  }

  const byName = new Map((division.rankings ?? []).map((fighter) => [normalizeName(fighter.fighter_name), fighter]));
  const fighter = byName.get(normalizeName(assertion.fighter));
  if (!fighter) {
    return fail(assertion, index, `Fighter not found in ${assertion.division}: ${assertion.fighter}`);
  }

  if (assertion.type === "above") {
    const other = byName.get(normalizeName(assertion.other));
    if (!other) {
      return fail(assertion, index, `Comparison fighter not found in ${assertion.division}: ${assertion.other}`);
    }
    const pass = fighter.rank < other.rank;
    return buildCheck({
      assertion,
      index,
      pass,
      detail: pass
        ? `${fighter.fighter_name} #${fighter.rank} is above ${other.fighter_name} #${other.rank}.`
        : `${fighter.fighter_name} #${fighter.rank} is not above ${other.fighter_name} #${other.rank}.`,
    });
  }

  if (assertion.type === "below") {
    const other = byName.get(normalizeName(assertion.other));
    if (!other) {
      return fail(assertion, index, `Comparison fighter not found in ${assertion.division}: ${assertion.other}`);
    }
    const pass = fighter.rank > other.rank;
    return buildCheck({
      assertion,
      index,
      pass,
      detail: pass
        ? `${fighter.fighter_name} #${fighter.rank} is below ${other.fighter_name} #${other.rank}.`
        : `${fighter.fighter_name} #${fighter.rank} is not below ${other.fighter_name} #${other.rank}.`,
    });
  }

  if (assertion.type === "exact_rank") {
    const expectedRank = Number(assertion.rank);
    const pass = fighter.rank === expectedRank;
    return buildCheck({
      assertion,
      index,
      pass,
      detail: pass
        ? `${fighter.fighter_name} is exactly #${expectedRank}.`
        : `${fighter.fighter_name} is #${fighter.rank}, expected #${expectedRank}.`,
    });
  }

  if (assertion.type === "rank_at_most") {
    const maxRank = Number(assertion.rank);
    const pass = fighter.rank <= maxRank;
    return buildCheck({
      assertion,
      index,
      pass,
      detail: pass
        ? `${fighter.fighter_name} #${fighter.rank} is within max rank #${maxRank}.`
        : `${fighter.fighter_name} is #${fighter.rank}, expected #${maxRank} or better.`,
    });
  }

  if (assertion.type === "rank_at_least") {
    const minRank = Number(assertion.rank);
    const pass = fighter.rank >= minRank;
    return buildCheck({
      assertion,
      index,
      pass,
      detail: pass
        ? `${fighter.fighter_name} #${fighter.rank} is at or below rank #${minRank}.`
        : `${fighter.fighter_name} is #${fighter.rank}, expected #${minRank} or worse.`,
    });
  }

  if (assertion.type === "rank_between") {
    const minRank = Number(assertion.min_rank);
    const maxRank = Number(assertion.max_rank);
    const pass = fighter.rank >= minRank && fighter.rank <= maxRank;
    return buildCheck({
      assertion,
      index,
      pass,
      detail: pass
        ? `${fighter.fighter_name} #${fighter.rank} is between #${minRank} and #${maxRank}.`
        : `${fighter.fighter_name} is #${fighter.rank}, expected between #${minRank} and #${maxRank}.`,
    });
  }

  return fail(assertion, index, `Unknown assertion type: ${assertion.type}`);
}

function buildCheck({ assertion, index, pass, detail }) {
  return {
    id: index + 1,
    pass,
    division: assertion.division,
    type: assertion.type,
    fighter: assertion.fighter,
    other: assertion.other ?? "",
    rank: assertion.rank ?? "",
    min_rank: assertion.min_rank ?? "",
    max_rank: assertion.max_rank ?? "",
    detail,
    rationale: assertion.rationale ?? "",
  };
}

function fail(assertion, index, detail) {
  return buildCheck({
    assertion,
    index,
    pass: false,
    detail,
  });
}

function printResult(result, args) {
  console.log(`Checked ${result.total} ranking assertion(s) from ${args.assertionsPath}.`);
  console.log(`passed: ${result.passed}`);
  console.log(`failed: ${result.failed}`);

  if (result.failures.length === 0) return;

  console.log("");
  console.log("Failures:");
  for (const failure of result.failures) {
    console.log(`- [${failure.division}] ${failure.detail}`);
    if (failure.rationale) console.log(`  rationale: ${failure.rationale}`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--rankings=")) {
      args.rankingsPath = arg.slice("--rankings=".length);
    } else if (arg.startsWith("--assertions=")) {
      args.assertionsPath = arg.slice("--assertions=".length);
    } else if (arg.startsWith("--out=")) {
      args.outPath = arg.slice("--out=".length);
    } else if (arg === "--no-fail") {
      args.failOnRegression = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Assert important ranking relationships against generated model output.

Usage:
  npm run model:assertions
  node scripts/assert-rankings.mjs --rankings=data/model/rankings.json

Options:
  --rankings=PATH     Rankings JSON path.
  --assertions=PATH   Assertion JSON path.
  --out=PATH          Optional JSON output path.
  --no-fail           Write/print failures but exit successfully.
`);
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
