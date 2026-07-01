#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const BASE_URL = "http://ufcstats.com";
const COMPLETED_EVENTS_URL = `${BASE_URL}/statistics/events/completed?page=all`;

const DEFAULTS = {
  startDate: "2000-01-01",
  endDate: "2026-06-30",
  outDir: "data/ufcstats",
  concurrency: 4,
  delayMs: 125,
  cache: true,
  refreshCache: false,
  skipFighters: false,
  continueOnError: false,
  limitEvents: null,
  limitFights: null,
};

const MONTHS = new Map(
  [
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12],
  ].map(([name, value]) => [name, value]),
);

const MAIN_STAT_KEYS = [
  "knockdowns",
  "sig_strikes",
  "sig_strike_pct",
  "total_strikes",
  "takedowns",
  "takedown_pct",
  "submission_attempts",
  "reversals",
  "control_time",
];

const SIG_STAT_KEYS = [
  "sig_strikes",
  "sig_strike_pct",
  "sig_head",
  "sig_body",
  "sig_leg",
  "sig_distance",
  "sig_clinch",
  "sig_ground",
];

const STAT_HEADERS = [
  "event_id",
  "event_name",
  "event_date",
  "event_location",
  "fight_id",
  "fight_url",
  "bout",
  "weight_class",
  "method",
  "method_details",
  "finish_round",
  "finish_time",
  "time_format",
  "referee",
  "details",
  "fighter_index",
  "fighter_id",
  "fighter_url",
  "fighter_name",
  "fighter_nickname",
  "fighter_status",
  "is_winner",
  "opponent_id",
  "opponent_url",
  "opponent_name",
  "opponent_status",
  "knockdowns",
  "sig_strikes_landed",
  "sig_strikes_attempted",
  "sig_strike_pct",
  "total_strikes_landed",
  "total_strikes_attempted",
  "takedowns_landed",
  "takedowns_attempted",
  "takedown_pct",
  "submission_attempts",
  "reversals",
  "control_time",
  "control_seconds",
  "sig_head_landed",
  "sig_head_attempted",
  "sig_body_landed",
  "sig_body_attempted",
  "sig_leg_landed",
  "sig_leg_attempted",
  "sig_distance_landed",
  "sig_distance_attempted",
  "sig_clinch_landed",
  "sig_clinch_attempted",
  "sig_ground_landed",
  "sig_ground_attempted",
];

const ROUND_STAT_HEADERS = [
  ...STAT_HEADERS.slice(0, 26),
  "round",
  ...STAT_HEADERS.slice(26),
];

const EVENT_HEADERS = ["event_id", "event_name", "event_date", "location", "event_url"];

const FIGHT_HEADERS = [
  "event_id",
  "event_name",
  "event_date",
  "event_location",
  "fight_order",
  "fight_id",
  "fight_url",
  "bout",
  "weight_class",
  "method",
  "method_details",
  "method_details_event",
  "finish_round",
  "finish_time",
  "time_format",
  "referee",
  "details",
  "awards",
  "winner_fighter_id",
  "winner_fighter_name",
  "fighter_1_id",
  "fighter_1_url",
  "fighter_1_name",
  "fighter_1_nickname",
  "fighter_1_status",
  "fighter_2_id",
  "fighter_2_url",
  "fighter_2_name",
  "fighter_2_nickname",
  "fighter_2_status",
];

const FIGHTER_HEADERS = [
  "fighter_id",
  "fighter_url",
  "name",
  "nickname",
  "record",
  "wins",
  "losses",
  "draws",
  "no_contests",
  "height",
  "height_inches",
  "weight",
  "weight_lbs",
  "reach",
  "reach_inches",
  "stance",
  "dob",
  "dob_iso",
  "slpm",
  "str_acc_percent",
  "sapm",
  "str_def_percent",
  "td_avg",
  "td_acc_percent",
  "td_def_percent",
  "sub_avg",
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

  const outDir = path.resolve(process.cwd(), args.outDir);
  const cacheDir = path.join(outDir, "cache");
  await fs.mkdir(outDir, { recursive: true });
  if (args.cache) {
    await fs.mkdir(cacheDir, { recursive: true });
  }

  const client = new UfcStatsClient({
    cacheDir,
    cache: args.cache,
    refreshCache: args.refreshCache,
    delayMs: args.delayMs,
  });

  console.log(`Scraping UFCStats events from ${args.startDate} through ${args.endDate}`);
  console.log(`Output directory: ${outDir}`);

  const eventIndexHtml = await client.fetchText(COMPLETED_EVENTS_URL, "events-index");
  let events = parseEventIndex(eventIndexHtml).filter((event) =>
    isWithinDateRange(event.event_date, args.startDate, args.endDate),
  );

  events.sort((a, b) => a.event_date.localeCompare(b.event_date));
  if (args.limitEvents !== null) {
    events = events.slice(0, args.limitEvents);
  }

  console.log(`Found ${events.length} events in range.`);

  const errors = [];
  const eventPages = await mapLimit(events, args.concurrency, async (event, index) => {
    if (index % 25 === 0 || index === events.length - 1) {
      console.log(`Fetching event pages: ${index + 1}/${events.length}`);
    }

    return safeTask(
      () => client.fetchText(event.event_url, `event-${event.event_id}`),
      errors,
      args.continueOnError,
      { type: "event", event_id: event.event_id, url: event.event_url },
    );
  });

  let fightMetas = [];
  for (let index = 0; index < events.length; index += 1) {
    const html = eventPages[index];
    if (!html) continue;
    fightMetas.push(...parseEventPage(html, events[index]));
  }

  fightMetas.sort((a, b) => {
    const eventCompare = a.event_date.localeCompare(b.event_date);
    return eventCompare || a.fight_order - b.fight_order;
  });

  if (args.limitFights !== null) {
    fightMetas = fightMetas.slice(0, args.limitFights);
  }

  console.log(`Found ${fightMetas.length} fights in selected events.`);

  const fightDetails = await mapLimit(fightMetas, args.concurrency, async (fightMeta, index) => {
    if (index % 100 === 0 || index === fightMetas.length - 1) {
      console.log(`Fetching fight detail pages: ${index + 1}/${fightMetas.length}`);
    }

    const html = await safeTask(
      () => client.fetchText(fightMeta.fight_url, `fight-${fightMeta.fight_id}`),
      errors,
      args.continueOnError,
      { type: "fight", fight_id: fightMeta.fight_id, url: fightMeta.fight_url },
    );

    return html ? parseFightPage(html, fightMeta) : null;
  });

  const parsedFightDetails = fightDetails.filter(Boolean);
  const fights = parsedFightDetails.map((detail) => detail.fight);
  const fighterStats = parsedFightDetails.flatMap((detail) => detail.fighterStats);
  const roundStats = parsedFightDetails.flatMap((detail) => detail.roundStats);
  const fighterRefs = collectFighterRefs(parsedFightDetails);

  let fighters = [];
  if (!args.skipFighters) {
    const uniqueFighters = [...fighterRefs.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    console.log(`Found ${uniqueFighters.length} unique fighters. Fetching fighter profiles.`);

    const fighterProfiles = await mapLimit(uniqueFighters, args.concurrency, async (fighter, index) => {
      if (index % 100 === 0 || index === uniqueFighters.length - 1) {
        console.log(`Fetching fighter profiles: ${index + 1}/${uniqueFighters.length}`);
      }

      const html = await safeTask(
        () => client.fetchText(fighter.fighter_url, `fighter-${fighter.fighter_id}`),
        errors,
        args.continueOnError,
        { type: "fighter", fighter_id: fighter.fighter_id, url: fighter.fighter_url },
      );

      return html ? parseFighterProfile(html, fighter) : null;
    });

    fighters = fighterProfiles.filter(Boolean);
  }

  const summary = {
    source: "ufcstats.com",
    completed_events_url: COMPLETED_EVENTS_URL,
    start_date: args.startDate,
    end_date: args.endDate,
    scraped_at: new Date().toISOString(),
    event_count: events.length,
    fight_count: fights.length,
    fighter_stat_rows: fighterStats.length,
    round_stat_rows: roundStats.length,
    fighter_count: fighters.length,
    error_count: errors.length,
  };

  await writeDataset(outDir, "events", events, EVENT_HEADERS);
  await writeDataset(outDir, "fights", fights, FIGHT_HEADERS);
  await writeDataset(outDir, "fight_fighter_stats", fighterStats, STAT_HEADERS);
  await writeDataset(outDir, "fight_round_stats", roundStats, ROUND_STAT_HEADERS);
  if (!args.skipFighters) {
    await writeDataset(outDir, "fighters", fighters, FIGHTER_HEADERS);
  }
  await writeJson(path.join(outDir, "summary.json"), summary);
  await writeJson(path.join(outDir, "errors.json"), errors);

  console.log("Scrape complete.");
  console.log(JSON.stringify(summary, null, 2));

  if (errors.length > 0 && !args.continueOnError) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split("=", 2);
    const value = () => inlineValue ?? argv[++index];

    switch (flag) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--start-date":
        args.startDate = value();
        break;
      case "--end-date":
        args.endDate = value();
        break;
      case "--out-dir":
        args.outDir = value();
        break;
      case "--concurrency":
        args.concurrency = Number(value());
        break;
      case "--delay-ms":
        args.delayMs = Number(value());
        break;
      case "--limit-events":
        args.limitEvents = Number(value());
        break;
      case "--limit-fights":
        args.limitFights = Number(value());
        break;
      case "--no-cache":
        args.cache = false;
        break;
      case "--refresh-cache":
        args.refreshCache = true;
        break;
      case "--skip-fighters":
        args.skipFighters = true;
        break;
      case "--continue-on-error":
        args.continueOnError = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!isIsoDate(args.startDate) || !isIsoDate(args.endDate)) {
    throw new Error("Dates must be in YYYY-MM-DD format.");
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    throw new Error("--delay-ms must be a non-negative number.");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: npm run scrape:ufcstats -- [options]

Scrapes completed UFCStats events, fights, per-fighter fight totals, per-round stats,
and fighter profile stats.

Options:
  --start-date YYYY-MM-DD     Inclusive start date. Default: ${DEFAULTS.startDate}
  --end-date YYYY-MM-DD       Inclusive end date. Default: ${DEFAULTS.endDate}
  --out-dir PATH              Output directory. Default: ${DEFAULTS.outDir}
  --concurrency N             Concurrent requests. Default: ${DEFAULTS.concurrency}
  --delay-ms N                Delay after network requests. Default: ${DEFAULTS.delayMs}
  --limit-events N            Only scrape the first N events after date filtering
  --limit-fights N            Only scrape the first N fights after event parsing
  --skip-fighters             Skip unique fighter profile pages
  --no-cache                  Do not read or write cached HTML
  --refresh-cache             Refetch pages even when cached
  --continue-on-error         Write partial output instead of stopping on a failed page
`);
}

class UfcStatsClient {
  constructor({ cacheDir, cache, refreshCache, delayMs }) {
    this.cacheDir = cacheDir;
    this.cache = cache;
    this.refreshCache = refreshCache;
    this.delayMs = delayMs;
    this.cookies = new Map();
  }

  async fetchText(url, cacheLabel) {
    const cachePath = this.cache ? path.join(this.cacheDir, `${cacheLabel}.html`) : null;
    if (cachePath && !this.refreshCache) {
      const cached = await readFileIfExists(cachePath);
      if (cached !== null) return cached;
    }

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const text = await this.fetchTextNoCache(url);
        if (cachePath) {
          await fs.mkdir(path.dirname(cachePath), { recursive: true });
          await fs.writeFile(cachePath, text);
        }
        return text;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await sleep(750 * attempt);
        }
      }
    }

    throw lastError;
  }

  async fetchTextNoCache(url) {
    const response = await this.request(url);
    let text = await response.text();

    if (this.isChallengePage(text)) {
      await this.solveChallenge(url, text);
      const retry = await this.request(url);
      text = await retry.text();
    }

    if (this.isChallengePage(text)) {
      throw new Error(`Browser challenge did not clear for ${url}`);
    }

    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }

    return text;
  }

  async request(url, options = {}) {
    const headers = {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      ...(options.headers || {}),
    };

    const cookie = this.cookieHeader();
    if (cookie) {
      headers.cookie = cookie;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      redirect: "follow",
    });

    this.storeCookies(response.headers);
    if (!response.ok && response.status !== 204) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response;
  }

  async solveChallenge(url, text) {
    const nonce = text.match(/var nonce="([^"]+)"/)?.[1];
    const difficulty = Number(text.match(/new Array\((\d+)\+1\)/)?.[1] ?? 2);

    if (!nonce || !Number.isFinite(difficulty)) {
      throw new Error(`Could not parse UFCStats browser challenge for ${url}`);
    }

    const target = "0".repeat(difficulty);
    let n = 0;
    while (
      !crypto
        .createHash("sha256")
        .update(`${nonce}:${n}`)
        .digest("hex")
        .startsWith(target)
    ) {
      n += 1;
    }

    await this.request(`${new URL(url).origin}/__c`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "origin": new URL(url).origin,
        "referer": url,
      },
      body: new URLSearchParams({ nonce, n: String(n) }),
    });
  }

  isChallengePage(text) {
    return text.includes("Checking your browser") && text.includes("/__c");
  }

  storeCookies(headers) {
    const cookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie")]
          : [];

    for (const cookie of cookies) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

function parseEventIndex(html) {
  const $ = cheerio.load(html);
  const events = [];

  $("tr.b-statistics__table-row").each((_, row) => {
    const eventLink = $(row).find('a[href*="/event-details/"]').first();
    const eventUrl = normalizeUrl(eventLink.attr("href"));
    if (!eventUrl) return;

    const cells = $(row).find("td").toArray();
    const eventName = cleanText($, eventLink);
    const eventDate = parseUfcDate(cleanText($, $(row).find(".b-statistics__date").first()));
    const location = cleanText($, cells[1]);

    if (!eventDate) return;

    events.push({
      event_id: idFromUrl(eventUrl),
      event_name: eventName,
      event_date: eventDate,
      location,
      event_url: eventUrl,
    });
  });

  return events;
}

function parseEventPage(html, event) {
  const $ = cheerio.load(html);
  const details = parseEventDetails($);
  const eventLocation = details.Location || event.location;
  const eventDate = parseUfcDate(details.Date) || event.event_date;
  const fights = [];

  $("tbody tr.b-fight-details__table-row.js-fight-details-click").each((index, row) => {
    const fightUrl = normalizeUrl($(row).attr("data-link"));
    if (!fightUrl) return;

    const cells = $(row).find("td").toArray();
    const fighterLinks = $(cells[1]).find('a[href*="/fighter-details/"]').toArray();
    const fighterNames = fighterLinks.map((link) => cleanText($, link));
    const fighterUrls = fighterLinks.map((link) => normalizeUrl($(link).attr("href")));
    const methodParts = paragraphTexts($, cells[7]);
    const awards = $(row)
      .find("img")
      .toArray()
      .map((img) => path.basename($(img).attr("src") || ""))
      .filter(Boolean);

    fights.push({
      event_id: event.event_id,
      event_name: event.event_name,
      event_date: eventDate,
      event_location: eventLocation,
      event_url: event.event_url,
      fight_order: index + 1,
      fight_id: idFromUrl(fightUrl),
      fight_url: fightUrl,
      fighter_1_id: idFromUrl(fighterUrls[0]),
      fighter_1_url: fighterUrls[0] || null,
      fighter_1_name: fighterNames[0] || null,
      fighter_2_id: idFromUrl(fighterUrls[1]),
      fighter_2_url: fighterUrls[1] || null,
      fighter_2_name: fighterNames[1] || null,
      weight_class: cleanText($, cells[6]),
      method: methodParts[0] || null,
      method_details_event: methodParts.slice(1).join(" ") || null,
      finish_round: parseInteger(cleanText($, cells[8])),
      finish_time: cleanText($, cells[9]) || null,
      awards,
    });
  });

  return fights;
}

function parseFightPage(html, fightMeta) {
  const $ = cheerio.load(html);
  const bout = cleanText($, $(".b-fight-details__fight-title").first());
  const persons = parseFightPersons($);
  const detailText = cleanText($, $(".b-fight-details__text").first());
  const detailMap = parseKnownLabels(detailText, [
    "Method",
    "Round",
    "Time",
    "Time format",
    "Referee",
    "Details",
  ]);

  const method = detailMap.Method || fightMeta.method;
  const finishRound = parseInteger(detailMap.Round) ?? fightMeta.finish_round;
  const finishTime = detailMap.Time || fightMeta.finish_time;
  const methodDetails = detailMap.Details || null;
  const winner = persons.find((person) => person.status === "W") || null;
  const fighter1 = persons[0] || fallbackFighter(fightMeta, 1);
  const fighter2 = persons[1] || fallbackFighter(fightMeta, 2);

  const fight = {
    event_id: fightMeta.event_id,
    event_name: fightMeta.event_name,
    event_date: fightMeta.event_date,
    event_location: fightMeta.event_location,
    fight_order: fightMeta.fight_order,
    fight_id: fightMeta.fight_id,
    fight_url: fightMeta.fight_url,
    bout,
    weight_class: fightMeta.weight_class || weightClassFromBout(bout),
    method,
    method_details: methodDetails,
    method_details_event: fightMeta.method_details_event,
    finish_round: finishRound,
    finish_time: finishTime,
    time_format: detailMap["Time format"] || null,
    referee: detailMap.Referee || null,
    details: detailMap.Details || null,
    awards: fightMeta.awards,
    winner_fighter_id: winner?.fighter_id || null,
    winner_fighter_name: winner?.name || null,
    fighter_1_id: fighter1.fighter_id,
    fighter_1_url: fighter1.fighter_url,
    fighter_1_name: fighter1.name,
    fighter_1_nickname: fighter1.nickname,
    fighter_1_status: fighter1.status,
    fighter_2_id: fighter2.fighter_id,
    fighter_2_url: fighter2.fighter_url,
    fighter_2_name: fighter2.name,
    fighter_2_nickname: fighter2.nickname,
    fighter_2_status: fighter2.status,
  };

  const tables = $("table").toArray().map((table) => ({
    table,
    headers: $(table)
      .find("thead th")
      .toArray()
      .map((header) => cleanText($, header)),
  }));

  const mainTotals = tables.find(
    (candidate) =>
      candidate.headers.includes("Total str.") && !candidate.headers.some(isRoundHeader),
  );
  const mainRounds = tables.find(
    (candidate) =>
      candidate.headers.includes("Total str.") && candidate.headers.some(isRoundHeader),
  );
  const sigTotals = tables.find(
    (candidate) => candidate.headers.includes("Head") && !candidate.headers.some(isRoundHeader),
  );
  const sigRounds = tables.find(
    (candidate) => candidate.headers.includes("Head") && candidate.headers.some(isRoundHeader),
  );

  const fighterStats = mergeStatsRows(
    parseStatsTable($, mainTotals?.table, MAIN_STAT_KEYS, false, fight, persons),
    parseStatsTable($, sigTotals?.table, SIG_STAT_KEYS, false, fight, persons),
  );

  const roundStats = mergeStatsRows(
    parseStatsTable($, mainRounds?.table, MAIN_STAT_KEYS, true, fight, persons),
    parseStatsTable($, sigRounds?.table, SIG_STAT_KEYS, true, fight, persons),
  );

  return {
    fight,
    fighterStats,
    roundStats,
    fighters: persons,
  };
}

function parseStatsTable($, table, keys, isRoundTable, fight, persons) {
  if (!table) return [];

  const rows = [];
  $(table)
    .find("tbody tr.b-fight-details__table-row")
    .each((rowIndex, tableRow) => {
      const cells = $(tableRow).find("td").toArray();
      if (cells.length < keys.length + 1) return;

      for (let fighterIndex = 0; fighterIndex < 2; fighterIndex += 1) {
        const fighter = persons[fighterIndex] || fallbackFighterFromTable($, cells[0], fighterIndex);
        const opponent = persons[1 - fighterIndex] || fallbackFighterFromTable($, cells[0], 1 - fighterIndex);
        const row = buildBaseStatRow(fight, fighter, opponent, fighterIndex);

        if (isRoundTable) {
          row.round = rowIndex + 1;
        }

        keys.forEach((key, keyIndex) => {
          const raw = cellPairValues($, cells[keyIndex + 1])[fighterIndex] ?? null;
          assignStat(row, key, raw);
        });

        rows.push(row);
      }
    });

  return rows;
}

function buildBaseStatRow(fight, fighter, opponent, fighterIndex) {
  return {
    event_id: fight.event_id,
    event_name: fight.event_name,
    event_date: fight.event_date,
    event_location: fight.event_location,
    fight_id: fight.fight_id,
    fight_url: fight.fight_url,
    bout: fight.bout,
    weight_class: fight.weight_class,
    method: fight.method,
    method_details: fight.method_details,
    finish_round: fight.finish_round,
    finish_time: fight.finish_time,
    time_format: fight.time_format,
    referee: fight.referee,
    details: fight.details,
    fighter_index: fighterIndex + 1,
    fighter_id: fighter?.fighter_id || null,
    fighter_url: fighter?.fighter_url || null,
    fighter_name: fighter?.name || null,
    fighter_nickname: fighter?.nickname || null,
    fighter_status: fighter?.status || null,
    is_winner: fighter?.status === "W",
    opponent_id: opponent?.fighter_id || null,
    opponent_url: opponent?.fighter_url || null,
    opponent_name: opponent?.name || null,
    opponent_status: opponent?.status || null,
  };
}

function assignStat(row, key, raw) {
  const value = emptyToNull(raw);

  switch (key) {
    case "knockdowns":
      row.knockdowns = parseInteger(value);
      break;
    case "sig_strikes":
      assignMadeAttempted(row, "sig_strikes", value);
      break;
    case "sig_strike_pct":
      row.sig_strike_pct = parsePercent(value);
      break;
    case "total_strikes":
      assignMadeAttempted(row, "total_strikes", value);
      break;
    case "takedowns":
      assignMadeAttempted(row, "takedowns", value);
      break;
    case "takedown_pct":
      row.takedown_pct = parsePercent(value);
      break;
    case "submission_attempts":
      row.submission_attempts = parseInteger(value);
      break;
    case "reversals":
      row.reversals = parseInteger(value);
      break;
    case "control_time":
      row.control_time = value;
      row.control_seconds = parseClockSeconds(value);
      break;
    case "sig_head":
    case "sig_body":
    case "sig_leg":
    case "sig_distance":
    case "sig_clinch":
    case "sig_ground":
      assignMadeAttempted(row, key, value);
      break;
    default:
      row[key] = value;
  }
}

function assignMadeAttempted(row, prefix, raw) {
  const parsed = parseMadeAttempted(raw);
  row[`${prefix}_landed`] = parsed.landed;
  row[`${prefix}_attempted`] = parsed.attempted;
}

function mergeStatsRows(primaryRows, secondaryRows) {
  const byKey = new Map();

  for (const row of [...primaryRows, ...secondaryRows]) {
    const key = [row.fight_id, row.fighter_index, row.round ?? "total"].join(":");
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...row,
    });
  }

  return [...byKey.values()].sort((a, b) => {
    const fightCompare = a.fight_id.localeCompare(b.fight_id);
    const roundCompare = (a.round ?? 0) - (b.round ?? 0);
    return fightCompare || roundCompare || a.fighter_index - b.fighter_index;
  });
}

function parseFightPersons($) {
  return $(".b-fight-details__person")
    .toArray()
    .map((person) => {
      const link = $(person).find('a[href*="/fighter-details/"]').first();
      const fighterUrl = normalizeUrl(link.attr("href"));

      return {
        fighter_id: idFromUrl(fighterUrl),
        fighter_url: fighterUrl,
        name: cleanText($, $(person).find(".b-fight-details__person-name").first()),
        nickname: stripOuterQuotes(cleanText($, $(person).find(".b-fight-details__person-title").first())),
        status: cleanText($, $(person).find(".b-fight-details__person-status").first()) || null,
      };
    });
}

function parseFighterProfile(html, fighterRef) {
  const $ = cheerio.load(html);
  const name = cleanText($, $(".b-content__title-highlight").first()) || fighterRef.name;
  const recordText = cleanText($, $(".b-content__title-record").first()).replace(/^Record:\s*/i, "");
  const record = parseRecord(recordText);
  const labels = {};

  $(".b-list__box-list li").each((_, item) => {
    const text = cleanText($, item);
    const separator = text.indexOf(":");
    if (separator === -1) return;

    const key = normalizeProfileKey(text.slice(0, separator));
    const value = emptyToNull(text.slice(separator + 1).trim());
    if (key) labels[key] = value;
  });

  return {
    fighter_id: fighterRef.fighter_id,
    fighter_url: fighterRef.fighter_url,
    name,
    nickname: stripOuterQuotes(cleanText($, $(".b-content__Nickname").first())) || fighterRef.nickname,
    record: recordText || null,
    wins: record.wins,
    losses: record.losses,
    draws: record.draws,
    no_contests: record.no_contests,
    height: labels.height || null,
    height_inches: parseHeightInches(labels.height),
    weight: labels.weight || null,
    weight_lbs: parseNumberFromText(labels.weight),
    reach: labels.reach || null,
    reach_inches: parseNumberFromText(labels.reach),
    stance: labels.stance || null,
    dob: labels.dob || null,
    dob_iso: parseUfcDate(labels.dob),
    slpm: parseFloatOrNull(labels.slpm),
    str_acc_percent: parsePercent(labels.str_acc),
    sapm: parseFloatOrNull(labels.sapm),
    str_def_percent: parsePercent(labels.str_def),
    td_avg: parseFloatOrNull(labels.td_avg),
    td_acc_percent: parsePercent(labels.td_acc),
    td_def_percent: parsePercent(labels.td_def),
    sub_avg: parseFloatOrNull(labels.sub_avg),
  };
}

function parseEventDetails($) {
  const details = {};
  $(".b-list__box-list li").each((_, item) => {
    const text = cleanText($, item);
    const separator = text.indexOf(":");
    if (separator === -1) return;
    details[text.slice(0, separator).trim()] = text.slice(separator + 1).trim();
  });
  return details;
}

function collectFighterRefs(details) {
  const refs = new Map();

  for (const detail of details) {
    for (const fighter of detail.fighters) {
      if (fighter?.fighter_id && !refs.has(fighter.fighter_id)) {
        refs.set(fighter.fighter_id, {
          fighter_id: fighter.fighter_id,
          fighter_url: fighter.fighter_url,
          name: fighter.name,
          nickname: fighter.nickname,
        });
      }
    }
  }

  return refs;
}

function fallbackFighter(fightMeta, fighterNumber) {
  return {
    fighter_id: fightMeta[`fighter_${fighterNumber}_id`] || null,
    fighter_url: fightMeta[`fighter_${fighterNumber}_url`] || null,
    name: fightMeta[`fighter_${fighterNumber}_name`] || null,
    nickname: null,
    status: null,
  };
}

function fallbackFighterFromTable($, fighterCell, fighterIndex) {
  const link = $(fighterCell).find('a[href*="/fighter-details/"]').eq(fighterIndex);
  const fighterUrl = normalizeUrl(link.attr("href"));

  return {
    fighter_id: idFromUrl(fighterUrl),
    fighter_url: fighterUrl,
    name: cleanText($, link),
    nickname: null,
    status: null,
  };
}

function parseKnownLabels(text, labels) {
  const positions = labels
    .map((label) => ({
      label,
      needle: `${label}:`,
      index: text.indexOf(`${label}:`),
    }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  const values = {};
  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index];
    const next = positions[index + 1];
    values[current.label] = text
      .slice(current.index + current.needle.length, next?.index ?? text.length)
      .trim();
  }

  return values;
}

function cellPairValues($, cell) {
  const values = paragraphTexts($, cell);
  if (values.length >= 2) return values.slice(0, 2);

  const links = $(cell)
    .find("a")
    .toArray()
    .map((link) => cleanText($, link))
    .filter(Boolean);
  if (links.length >= 2) return links.slice(0, 2);

  return values;
}

function paragraphTexts($, element) {
  const paragraphs = $(element).find("p").toArray();
  if (paragraphs.length > 0) {
    return paragraphs.map((paragraph) => cleanText($, paragraph)).filter(Boolean);
  }

  const text = cleanText($, element);
  return text ? [text] : [];
}

function cleanText($, element) {
  return $(element).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeProfileKey(key) {
  return key
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "_")
    .replace("str_acc", "str_acc")
    .replace("str_def", "str_def")
    .replace("td_avg", "td_avg")
    .replace("td_acc", "td_acc")
    .replace("td_def", "td_def")
    .replace("sub_avg", "sub_avg");
}

function parseUfcDate(value) {
  if (!value) return null;

  const normalized = value.replace(/\./g, "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;

  const month = MONTHS.get(match[1].toLowerCase());
  if (!month) return null;

  const day = Number(match[2]);
  const year = Number(match[3]);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseRecord(value) {
  const record = {
    wins: null,
    losses: null,
    draws: null,
    no_contests: null,
  };
  const match = value?.match(/(\d+)-(\d+)-(\d+)(?:\s*\((\d+)\s*NC\))?/i);
  if (!match) return record;

  record.wins = Number(match[1]);
  record.losses = Number(match[2]);
  record.draws = Number(match[3]);
  record.no_contests = match[4] ? Number(match[4]) : 0;
  return record;
}

function parseMadeAttempted(value) {
  if (!value || value === "---") {
    return { landed: null, attempted: null };
  }

  const match = String(value).match(/^(\d+)\s+of\s+(\d+)$/i);
  if (!match) {
    return { landed: parseInteger(value), attempted: null };
  }

  return {
    landed: Number(match[1]),
    attempted: Number(match[2]),
  };
}

function parseClockSeconds(value) {
  if (!value || value === "---") return null;
  const parts = String(value).split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parsePercent(value) {
  if (!value || value === "---") return null;
  const parsed = Number(String(value).replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value) {
  if (value === null || value === undefined || value === "" || value === "---") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFloatOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "---") return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberFromText(value) {
  if (!value || value === "---") return null;
  const match = String(value).match(/[\d.]+/);
  return match ? Number(match[0]) : null;
}

function parseHeightInches(value) {
  if (!value || value === "---") return null;
  const match = String(value).match(/(\d+)'\s*(\d+)/);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]);
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === "--" ? null : trimmed;
}

function stripOuterQuotes(value) {
  return value ? value.replace(/^"+|"+$/g, "") : null;
}

function normalizeUrl(value) {
  if (!value) return null;
  return new URL(value, BASE_URL).toString();
}

function idFromUrl(url) {
  if (!url) return null;
  return new URL(url).pathname.split("/").filter(Boolean).pop() || null;
}

function weightClassFromBout(value) {
  return value ? value.replace(/\s+Bout$/i, "") : null;
}

function isRoundHeader(header) {
  return /^Round \d+$/i.test(header);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isWithinDateRange(value, startDate, endDate) {
  return value >= startDate && value <= endDate;
}

async function safeTask(task, errors, continueOnError, context) {
  try {
    return await task();
  } catch (error) {
    const entry = {
      ...context,
      message: error.message,
    };
    errors.push(entry);

    if (!continueOnError) {
      throw error;
    }

    console.error(`Skipping ${context.type} ${context.url}: ${error.message}`);
    return null;
  }
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function writeDataset(outDir, name, rows, preferredHeaders) {
  await writeJson(path.join(outDir, `${name}.json`), rows);
  await fs.writeFile(
    path.join(outDir, `${name}.csv`),
    toCsv(rows, collectHeaders(rows, preferredHeaders)),
  );
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function collectHeaders(rows, preferredHeaders) {
  const headers = [...preferredHeaders];
  const seen = new Set(headers);

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  return headers;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";

  const stringValue = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }

  return stringValue;
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
