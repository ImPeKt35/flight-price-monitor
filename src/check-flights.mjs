import { chromium } from "playwright";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG = {
  maxPriceEur: Number(process.env.MAX_PRICE_EUR || 650),
  maxAverageMinutes: Number(process.env.MAX_AVERAGE_MINUTES || 20 * 60),
  notifyAgainAfterHours: Number(process.env.NOTIFY_AGAIN_AFTER_HOURS || 24),
  dryRun: process.env.DRY_RUN === "1",
  startupNotice: process.env.STARTUP_NOTICE === "1",
  hourlyStatusNow: process.env.HOURLY_STATUS_NOW === "1",
  suppressFailureNotifications: process.env.SUPPRESS_FAILURE_NOTIFICATIONS === "1",
  discordWebhook: process.env.DISCORD_WEBHOOK_URL || "",
};

// Multi-destination : PAR → HKG le 28/12/2026, puis BKK → PAR le 14/01/2027.
const GOOGLE_URL =
  "https://www.google.com/travel/flights/search?tfs=GhoSCjIwMjYtMTItMjhqBRIDUEFScgUSA0hLRxoaEgoyMDI3LTAxLTE0agUSA0JLS3IFEgNQQVJCAQFIAZgBAw%3D%3D&hl=fr&curr=EUR";
const SKYSCANNER_URL =
  "https://www.skyscanner.fr/transport/d/pari/2026-12-28/hkg/bkkt/2027-01-14/pari?adultsv2=1&cabinclass=economy&childrenv2=&fare-attributes=checked-bag&duration=2400";
const KAYAK_URL =
  "https://www.kayak.fr/flights/PAR-HKG/2026-12-28/BKK-PAR/2027-01-14?sort=bestflight_a";

const statePath = path.resolve(".monitor-state.json");
const now = new Date();

function normalize(text = "") {
  return text.replace(/\u00a0|\u202f/g, " ").replace(/\s+/g, " ").trim();
}

function parseDuration(label) {
  const match = normalize(label).match(/Durée totale\s*:\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?/i);
  if (!match) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

function parseCard(label) {
  const text = normalize(label);
  const priceMatch = text.match(/À partir de\s+([\d ]+)\s+euros\s*\(prix total\)/i);
  const airlineMatch = text.match(/Vol (?:direct )?avec\s+(.+?)(?:,\s*\d+\s*escale|\.\s*Départ)/i);
  const duration = parseDuration(text);
  if (!priceMatch || !duration) return null;
  return {
    label,
    price: Number(priceMatch[1].replace(/\s/g, "")),
    airline: airlineMatch?.[1] || "Compagnie à vérifier",
    duration,
  };
}

function signatureFor(result) {
  return crypto
    .createHash("sha256")
    .update([result.price, result.outbound.airline, result.outbound.duration, result.inbound.airline, result.inbound.duration].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function formatDuration(minutes) {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    return { notified: {}, consecutiveFailures: 0, lastHealthAlertAt: null, lastRunAt: null };
  }
}

async function saveState(state) {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function postDiscord(payload) {
  if (CONFIG.dryRun) {
    console.log("DRY_RUN Discord:", JSON.stringify(payload));
    return;
  }
  if (!CONFIG.discordWebhook) throw new Error("DISCORD_WEBHOOK_URL manquant");
  const response = await fetch(CONFIG.discordWebhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
}

async function startUnmarkedChrome() {
  const port = 9300 + crypto.randomInt(500);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "flight-monitor-"));
  const child = spawn(
    chromium.executablePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--lang=fr-FR",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let browser;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!browser) {
    child.kill();
    throw new Error("Chrome n'a pas démarré");
  }
  return { browser, child, profile };
}

async function dismissConsent(page) {
  for (const label of ["Tout refuser", "Reject all"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      break;
    }
  }
}

async function waitForCards(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="link"][aria-label*="prix total"]').length > 0 ||
      document.body?.innerText.includes("Petit problème"),
    null,
    { timeout: 75_000 },
  );
  const body = await page.locator("body").innerText();
  if (body.includes("Petit problème")) throw new Error("Google Flights a refusé la recherche");
}

async function loadOutboundOnce(page) {
  await page.goto(GOOGLE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissConsent(page);
  await waitForCards(page);
  const labels = await page
    .locator('[role="link"][aria-label*="prix total"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")).filter(Boolean));
  return labels.map(parseCard).filter(Boolean);
}

async function loadOutbound(page) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await loadOutboundOnce(page);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await page.goto("about:blank");
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
      }
    }
  }
  throw lastError;
}

async function findMatches(page) {
  const outbound = await loadOutbound(page);
  const possible = outbound
    .map((card, index) => ({ ...card, index }))
    .filter((card) => card.price <= CONFIG.maxPriceEur);
  const matches = [];

  for (const candidate of possible.slice(0, 12)) {
    if (candidate.index > 0 || matches.length > 0) await loadOutbound(page);
    const cards = page.locator('[role="link"][aria-label*="prix total"]');
    await cards.nth(candidate.index).click({ force: true });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="link"][aria-label*="prix total"]')].some((element) =>
          /Bangkok|BKK/i.test(element.getAttribute("aria-label") || ""),
        ),
      null,
      { timeout: 60_000 },
    );
    const inboundLabels = await page
      .locator('[role="link"][aria-label*="prix total"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")).filter(Boolean));

    for (const inbound of inboundLabels.map(parseCard).filter(Boolean)) {
      const averageMinutes = Math.round((candidate.duration + inbound.duration) / 2);
      if (inbound.price <= CONFIG.maxPriceEur && averageMinutes <= CONFIG.maxAverageMinutes) {
        const result = {
          price: inbound.price,
          outbound: candidate,
          inbound,
          averageMinutes,
          googleUrl: page.url(),
        };
        result.signature = signatureFor(result);
        matches.push(result);
      }
    }
  }

  return { matches, outboundCount: outbound.length, cheapest: Math.min(...outbound.map((card) => card.price)) };
}

async function notifyMatch(result) {
  await postDiscord({
    username: "Vols Asie",
    embeds: [
      {
        title: `✈️ Offre sous ${CONFIG.maxPriceEur} € détectée : ${result.price} €`,
        url: result.googleUrl,
        color: 0xf59e0b,
        description:
          "Paris → Hong Kong le 28 décembre 2026\nBangkok → Paris le 14 janvier 2027",
        fields: [
          { name: "Aller", value: `${result.outbound.airline}\n${formatDuration(result.outbound.duration)}`, inline: true },
          { name: "Retour", value: `${result.inbound.airline}\n${formatDuration(result.inbound.duration)}`, inline: true },
          { name: "Durée moyenne", value: formatDuration(result.averageMinutes), inline: true },
          { name: "Bagage en soute", value: "⚠️ À confirmer avant achat", inline: false },
          { name: "Vérifier", value: `[Skyscanner avec bagage](${SKYSCANNER_URL}) · [KAYAK](${KAYAK_URL})`, inline: false },
        ],
        footer: { text: "Alerte marché complète. Prix et bagage à revérifier avant paiement." },
        timestamp: now.toISOString(),
      },
    ],
  });
}

function recentObservations(state) {
  const cutoff = now.getTime() - 60 * 60 * 1000;
  return (state.hourlyObservations || []).filter(
    (observation) => new Date(observation.checkedAt).getTime() >= cutoff,
  );
}

async function maybeNotifyHourlyStatus(state) {
  const lastStatusAt = state.lastHourlyStatusAt
    ? new Date(state.lastHourlyStatusAt).getTime()
    : 0;
  const due = CONFIG.hourlyStatusNow || now.getTime() - lastStatusAt >= 60 * 60 * 1000;
  if (!due) return;

  const observations = recentObservations(state);
  if (observations.length > 0) {
    const best = Math.min(...observations.map((observation) => observation.cheapestTotalSeen));
    const matches = Math.max(...observations.map((observation) => observation.matches));
    await postDiscord({
      username: "Vols Asie",
      content:
        `✅ **Surveillance des vols en cours**\n\n` +
        `Meilleur prix observé durant la dernière heure : **${best} €**\n` +
        `Vérifications réussies : **${observations.length}**\n` +
        `Offres respectant prix + durée : **${matches}**\n\n` +
        "Le bagage en soute reste à confirmer avant l’achat.",
    });
  } else {
    await postDiscord({
      username: "Vols Asie",
      content:
        "⚠️ **Surveillance des vols en cours, mais aucune lecture n’a réussi durant la dernière heure.**\n\n" +
        `Dernière erreur : ${state.lastError || "inconnue"}`,
    });
  }
  state.lastHourlyStatusAt = now.toISOString();
}

async function main() {
  const state = await readState();
  state.notified ||= {};
  state.hourlyObservations ||= [];
  let runtime;
  try {
    runtime = await startUnmarkedChrome();
    const context = runtime.browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());
    const result = await findMatches(page);
    state.consecutiveFailures = 0;
    state.lastError = null;
    state.lastRead = {
      checkedAt: now.toISOString(),
      outboundOffers: result.outboundCount,
      cheapestTotalSeen: result.cheapest,
      matches: result.matches.length,
    };
    state.hourlyObservations.push(state.lastRead);

    const repeatDelay = CONFIG.notifyAgainAfterHours * 60 * 60 * 1000;
    for (const match of result.matches) {
      const lastSent = state.notified[match.signature];
      if (!lastSent || now.getTime() - new Date(lastSent).getTime() >= repeatDelay) {
        await notifyMatch(match);
        state.notified[match.signature] = now.toISOString();
      }
    }

    if (CONFIG.startupNotice) {
      await postDiscord({
        username: "Vols Asie",
        content:
          "✅ Surveillance globale active toutes les 15 minutes : toutes les compagnies et nouvelles combinaisons Paris → Hong Kong / Bangkok → Paris sont recherchées. Seuil 650 €, durée moyenne 20 h. Le bagage en soute sera indiqué comme point à confirmer.",
      });
    }
    await maybeNotifyHourlyStatus(state);
    console.log(`Offres lues: ${result.outboundCount}; moins chère: ${result.cheapest} €; correspondances: ${result.matches.length}`);
  } catch (error) {
    state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
    state.lastError = error.message;
    const lastHealth = state.lastHealthAlertAt ? new Date(state.lastHealthAlertAt).getTime() : 0;
    if (
      !CONFIG.suppressFailureNotifications &&
      state.consecutiveFailures >= 3 &&
      now.getTime() - lastHealth > 12 * 60 * 60 * 1000
    ) {
      await postDiscord({
        username: "Vols Asie",
        content: `⚠️ La surveillance des vols n'arrive plus à lire Google Flights depuis ${state.consecutiveFailures} passages. Une intervention est nécessaire.`,
      });
      state.lastHealthAlertAt = now.toISOString();
    }
    if (!CONFIG.suppressFailureNotifications) {
      try {
        await maybeNotifyHourlyStatus(state);
      } catch (statusError) {
        console.error(`Bilan horaire impossible: ${statusError.message}`);
      }
    }
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (runtime) {
      await runtime.browser.close().catch(() => {});
      runtime.child.kill();
      await fs.rm(runtime.profile, { recursive: true, force: true }).catch(() => {});
    }
    const expiration = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    state.notified = Object.fromEntries(
      Object.entries(state.notified).filter(([, sentAt]) => new Date(sentAt).getTime() >= expiration),
    );
    const observationExpiration = now.getTime() - 75 * 60 * 1000;
    state.hourlyObservations = (state.hourlyObservations || []).filter(
      (observation) => new Date(observation.checkedAt).getTime() >= observationExpiration,
    );
    state.lastRunAt = now.toISOString();
    await saveState(state);
  }
}

await main();
