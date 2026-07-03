#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  dataDir: "data/ufcstats",
  modelDir: "data/model",
  publicDir: "public/model",
  assertionsPath: "data/ranking_inputs/model_assertions.json",
  backtestSince: "2024-01-01",
  modelConfigPath: "",
  asOf: "",
  useCurrentSnapshot: true,
  runAudit: true,
  runBacktest: true,
  runDiagnostics: true,
  runScoreBands: true,
  runReview: true,
  runAssertions: true,
  buildSite: false,
};

const REQUIRED_INPUT_FILES = [
  "summary.json",
  "fights.json",
  "fight_fighter_stats.json",
  "fight_round_stats.json",
  "fighters.json",
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

  await validateInputs(args);

  const modelDir = args.modelDir;
  const rankingsPath = path.join(modelDir, "rankings.json");
  const fightImpactsPath = path.join(modelDir, "fight_impacts.json");
  const diagnosticsPath = path.join(modelDir, "diagnostics.json");
  const auditPath = path.join(modelDir, "audit.json");
  const scoreBandsPath = path.join(modelDir, "score-bands.json");

  const steps = [
    {
      label: "Build rankings",
      command: [
        process.execPath,
        "scripts/build-rankings-model.mjs",
        `--data-dir=${args.dataDir}`,
        `--out-dir=${modelDir}`,
        ...(args.modelConfigPath ? [`--model-config=${args.modelConfigPath}`] : []),
        ...(args.asOf ? [`--as-of=${args.asOf}`] : []),
        ...(args.useCurrentSnapshot ? [] : ["--no-current-snapshot"]),
      ],
    },
    {
      label: "Generate fighter explanations",
      command: [
        process.execPath,
        "scripts/explain-rankings.mjs",
        `--rankings=${rankingsPath}`,
        `--out=${path.join(modelDir, "explanations.json")}`,
        `--markdown-out=${path.join(modelDir, "explanations.md")}`,
        `--fighter-out-dir=${path.join(modelDir, "fighter_explanations")}`,
      ],
    },
    ...(args.runAudit
      ? [
          {
            label: "Audit rankings",
            command: [
              process.execPath,
              "scripts/audit-rankings.mjs",
              `--rankings=${rankingsPath}`,
              `--fight-impacts=${fightImpactsPath}`,
              `--out=${auditPath}`,
            ],
          },
        ]
      : []),
    ...(args.runDiagnostics
      ? [
          {
            label: "Run diagnostics",
            command: [
              process.execPath,
              "scripts/diagnose-model.mjs",
              `--rankings=${rankingsPath}`,
              `--fighters=${path.join(args.dataDir, "fighters.json")}`,
              `--out=${diagnosticsPath}`,
              `--markdown-out=${path.join(modelDir, "diagnostics.md")}`,
            ],
          },
        ]
      : []),
    ...(args.runScoreBands
      ? [
          {
            label: "Build score bands",
            command: [
              process.execPath,
              "scripts/score-bands.mjs",
              `--rankings=${rankingsPath}`,
              `--diagnostics=${diagnosticsPath}`,
              `--out=${scoreBandsPath}`,
              `--markdown-out=${path.join(modelDir, "score-bands.md")}`,
            ],
          },
        ]
      : []),
    ...(args.runReview && args.runAudit
      ? [
          {
            label: "Write audit review",
            command: [
              process.execPath,
              "scripts/review-audit.mjs",
              `--rankings=${rankingsPath}`,
              `--audit=${auditPath}`,
              `--diagnostics=${diagnosticsPath}`,
              `--score-bands=${scoreBandsPath}`,
              `--out=${path.join(modelDir, "audit-review.md")}`,
            ],
          },
        ]
      : []),
    ...(args.runBacktest
      ? [
          {
            label: "Backtest pre-fight ratings",
            command: [
              process.execPath,
              "scripts/backtest-model.mjs",
              `--rankings=${rankingsPath}`,
              `--fight-impacts=${fightImpactsPath}`,
              `--out=${path.join(modelDir, "backtest.json")}`,
              `--markdown-out=${path.join(modelDir, "backtest.md")}`,
              `--since=${args.backtestSince}`,
            ],
          },
        ]
      : []),
    ...(args.runAssertions
      ? [
          {
            label: "Check ranking assertions",
            command: [
              process.execPath,
              "scripts/assert-rankings.mjs",
              `--rankings=${rankingsPath}`,
              `--assertions=${args.assertionsPath}`,
              `--out=${path.join(modelDir, "assertions.json")}`,
            ],
          },
        ]
      : []),
    {
      label: "Export frontend JSON",
      command: [
        process.execPath,
        "scripts/export-model-public.mjs",
        `--model-dir=${modelDir}`,
        `--out-dir=${args.publicDir}`,
      ],
    },
    ...(args.buildSite
      ? [
          {
            label: "Build static site",
            command: ["npm", "run", "build"],
          },
        ]
      : []),
  ];

  console.log("OctagonRank model pipeline");
  console.log(`data: ${args.dataDir}`);
  console.log(`model output: ${modelDir}`);
  console.log(`frontend output: ${args.publicDir}`);
  console.log("");

  const startedAt = Date.now();
  for (const [index, step] of steps.entries()) {
    await runStep({ step, index, total: steps.length });
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log(`Pipeline complete in ${elapsedSeconds}s.`);
  console.log(`Frontend JSON is ready in ${args.publicDir}.`);
}

async function validateInputs(args) {
  for (const file of REQUIRED_INPUT_FILES) {
    await assertFile(path.join(args.dataDir, file), `Missing UFCStats input file: ${path.join(args.dataDir, file)}`);
  }

  if (args.modelConfigPath) {
    await assertFile(args.modelConfigPath, `Missing model config file: ${args.modelConfigPath}`);
  }

  if (args.runAssertions) {
    await assertFile(args.assertionsPath, `Missing assertion file: ${args.assertionsPath}`);
  }
}

async function assertFile(filePath, message) {
  try {
    const stat = await fs.stat(path.resolve(process.cwd(), filePath));
    if (!stat.isFile()) throw new Error(message);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(message);
    throw error;
  }
}

async function runStep({ step, index, total }) {
  console.log(`[${index + 1}/${total}] ${step.label}`);
  console.log(`$ ${step.command.map(shellQuote).join(" ")}`);

  const startedAt = Date.now();
  await spawnCommand(step.command);
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Done: ${step.label} (${elapsedSeconds}s)`);
  console.log("");
}

function spawnCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command[0]} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--data-dir=")) {
      args.dataDir = arg.slice("--data-dir=".length);
    } else if (arg.startsWith("--model-dir=")) {
      args.modelDir = arg.slice("--model-dir=".length);
    } else if (arg.startsWith("--public-dir=")) {
      args.publicDir = arg.slice("--public-dir=".length);
    } else if (arg.startsWith("--model-config=")) {
      args.modelConfigPath = arg.slice("--model-config=".length);
    } else if (arg.startsWith("--as-of=")) {
      args.asOf = arg.slice("--as-of=".length);
    } else if (arg.startsWith("--backtest-since=")) {
      args.backtestSince = arg.slice("--backtest-since=".length);
    } else if (arg.startsWith("--assertions=")) {
      args.assertionsPath = arg.slice("--assertions=".length);
    } else if (arg === "--no-current-snapshot") {
      args.useCurrentSnapshot = false;
    } else if (arg === "--skip-audit") {
      args.runAudit = false;
      args.runReview = false;
    } else if (arg === "--skip-backtest") {
      args.runBacktest = false;
    } else if (arg === "--skip-diagnostics") {
      args.runDiagnostics = false;
      args.runScoreBands = false;
    } else if (arg === "--skip-score-bands") {
      args.runScoreBands = false;
    } else if (arg === "--skip-review") {
      args.runReview = false;
    } else if (arg === "--skip-assertions") {
      args.runAssertions = false;
    } else if (arg === "--build-site") {
      args.buildSite = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Run the full OctagonRank model pipeline from local UFCStats data to static frontend JSON.

Usage:
  npm run model:export
  npm run model:export -- --build-site
  node scripts/run-model-pipeline.mjs --data-dir=data/ufcstats --model-dir=data/model --public-dir=public/model

Required input:
  data/ufcstats/*.json files created by npm run scrape:ufcstats.

Output:
  data/model/rankings.json and support reports
  public/model/rankings.json, explanations.json, and summary.json

Options:
  --data-dir=PATH          Scraped UFCStats input directory.
  --model-dir=PATH         Generated model output directory.
  --public-dir=PATH        Static JSON directory loaded by React.
  --model-config=PATH      Optional model weight override JSON.
  --as-of=YYYY-MM-DD       Build rankings using fights on or before this date.
  --backtest-since=DATE    First fight date included in the backtest.
  --assertions=PATH        Ranking assertion file.
  --no-current-snapshot    Disable current snapshot ranking policy.
  --skip-audit             Skip audit and audit review.
  --skip-backtest          Skip predictive backtest.
  --skip-diagnostics       Skip diagnostics and score bands.
  --skip-score-bands       Skip score bands only.
  --skip-review            Skip audit-review Markdown.
  --skip-assertions        Skip ranking assertion checks.
  --build-site             Run npm run build after exporting frontend JSON.
`);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
