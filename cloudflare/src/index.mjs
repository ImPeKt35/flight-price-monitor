const API_URL = "https://skyscanner-scraper.omkar.cloud/flights/search-multi-city";
const SKYSCANNER_URL =
  "https://www.skyscanner.fr/transport/d/pari/2026-12-28/hkg/bkkt/2027-01-14/pari?adultsv2=1&cabinclass=economy&childrenv2=&fare-attributes=checked-bag&duration=2400";

const LEGS = [
  { origin: "PAR", destination: "HKG", date: "2026-12-28" },
  { origin: "BKK", destination: "PAR", date: "2027-01-14" },
];

function formatDuration(minutes) {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

function carrierNames(leg) {
  return [...new Set((leg.carriers || []).map((carrier) => carrier.name).filter(Boolean))].join(" + ") ||
    "Compagnie à vérifier";
}

function normalizeOffer(itinerary) {
  if (!Array.isArray(itinerary.legs) || itinerary.legs.length !== 2) return null;
  const [outbound, inbound] = itinerary.legs;
  const price = Number(itinerary.price?.amount);
  const outboundMinutes = Number(outbound.duration_minutes);
  const inboundMinutes = Number(inbound.duration_minutes);
  if (![price, outboundMinutes, inboundMinutes].every(Number.isFinite)) return null;
  return {
    price,
    averageMinutes: Math.round((outboundMinutes + inboundMinutes) / 2),
    outboundMinutes,
    inboundMinutes,
    outboundCarrier: carrierNames(outbound),
    inboundCarrier: carrierNames(inbound),
  };
}

async function fetchOffers(env) {
  const params = new URLSearchParams({
    legs: JSON.stringify(LEGS),
    sort: "cheapest",
    max_poll_seconds: "60",
    max_results: "100",
    market: "FR",
    locale: "fr-FR",
    currency: "EUR",
  });
  const response = await fetch(`${API_URL}?${params}`, {
    headers: { "API-Key": env.OMKAR_API_KEY },
  });
  if (!response.ok) throw new Error(`Skyscanner API HTTP ${response.status}`);
  const payload = await response.json();
  const offers = (payload.results || []).map(normalizeOffer).filter(Boolean);
  if (offers.length === 0) throw new Error("aucune offre exploitable reçue");
  return offers.sort((a, b) => a.price - b.price);
}

async function postDiscord(env, payload) {
  const response = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
}

async function runMonitor(env) {
  const maxPrice = Number(env.MAX_PRICE_EUR || 650);
  const maxAverageMinutes = Number(env.MAX_AVERAGE_MINUTES || 1200);
  try {
    const offers = await fetchOffers(env);
    const cheapest = offers[0];
    const durationEligible = offers.filter((offer) => offer.averageMinutes <= maxAverageMinutes);
    const bestDurationEligible = durationEligible[0];
    const matches = durationEligible.filter((offer) => offer.price <= maxPrice);
    const matchLine = matches.length
      ? `🚨 **${matches.length} offre(s) respectent le prix et la durée.**`
      : `Aucune offre ne respecte encore le seuil de ${maxPrice} € et 20 h de moyenne.`;
    const durationLine = bestDurationEligible
      ? `Meilleur prix avec une durée moyenne de 20 h maximum : **${bestDurationEligible.price} €**\n`
      : "Aucune offre avec une durée moyenne de 20 h maximum.\n";

    await postDiscord(env, {
      username: "Vols Asie",
      content:
        `✅ **Contrôle Skyscanner horaire terminé**\n\n` +
        `Meilleur prix trouvé : **${cheapest.price} €**\n` +
        durationLine +
        `Compagnies : **${cheapest.outboundCarrier} / ${cheapest.inboundCarrier}**\n` +
        `Durées : ${formatDuration(cheapest.outboundMinutes)} / ${formatDuration(cheapest.inboundMinutes)} ` +
        `(moyenne ${formatDuration(cheapest.averageMinutes)})\n` +
        `${matchLine}\n\n` +
        `🧳 Le bagage en soute n'est pas fourni par l'API : vérifie-le avant paiement.\n` +
        `[Ouvrir la recherche Skyscanner avec le filtre bagage](${SKYSCANNER_URL})`,
    });
  } catch (error) {
    await postDiscord(env, {
      username: "Vols Asie",
      content:
        "⚠️ **Le contrôle Skyscanner horaire a échoué.**\n\n" +
        `Erreur : ${error.message}\nLe prochain contrôle sera relancé automatiquement dans une heure.`,
    });
    throw error;
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  async fetch() {
    return Response.json({
      service: "flight-price-monitor",
      status: "ready",
      schedule: "hourly",
      source: "Skyscanner",
    });
  },
};

export { normalizeOffer, runMonitor };
