// Vercel Serverless Function: /api/questionset
// Flags:
// - Quickfire: 30 questions ramping difficulty: 10 Tier1 + 10 Tier2 + 10 Tier3
// - Hardmode: all 195 shuffled
// No caching so each run is unique.

let flagsCache = {
  loaded: false,
  countries: [],
};

const RESTCOUNTRIES_ALL =
  "https://restcountries.com/v3.1/all?fields=name,cca2,unMember";

const OBSERVER_STATES = new Set(["Vatican City", "Palestine"]);

// ----------------------------
// Difficulty tiers (by ISO A2 code)
// Tiering is about recognisability, not population.
// You can tweak these lists anytime based on player feedback.
// ----------------------------
const TIER_1 = [
  "US","GB","FR","DE","IT","ES","PT","NL","BE","CH","AT","IE",
  "CA","AU","NZ","JP","CN","IN","BR","AR","MX",
  "ZA","EG","TR","RU","KR","SE","NO","DK","FI","PL","GR"
];

const TIER_2 = [
  "CZ","HU","RO","BG","UA","HR","RS","SI","SK","LT","LV","EE",
  "IL","SA","AE","QA","KW","OM","IR","IQ","JO","LB","SY",
  "MA","DZ","TN","GH","NG","KE","TZ","UG","CM",
  "TH","VN","MY","SG","ID","PH",
  "CL","PE","CO","VE","EC","BO","PY","UY","CU","DO"
];

const TIER_3 = [
  "AD","SM","MC","LI","MT","CY","IS","LU",
  "BS","BB","AG","DM","GD","KN","LC","VC",
  "BZ","GT","HN","SV","NI","CR","PA",
  "BN","LA","KH","MM","NP","LK","BD","PK","AF","MN",
  "SN","ML","NE","TD","BJ","TG","BF","SL","LR","GW","GM","MR",
  "SD","SS","ET","ER","DJ","SO","RW","BI","GA","GQ","ST","KM","SC","MU","MG","MZ","MW","ZM","ZW","LS","SZ","NA","BW",
  "AO","CG","CD",
  "FJ","PG","SB","VU","WS","TO","TV","NR","KI","FM","PW","MH"
];

// ----------------------------
// Helpers
// ----------------------------
function isIn195(country) {
  const name = country?.name?.common;
  return country?.unMember === true || (name && OBSERVER_STATES.has(name));
}

function flagUrlFromCca2(cca2) {
  return `https://flagcdn.com/w320/${String(cca2).toLowerCase()}.png`;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function pickRandomFrom(arr, n) {
  const copy = [...arr];
  shuffleInPlace(copy);
  return copy.slice(0, n);
}

function buildMultipleChoiceQuestion(country, allCountries) {
  const correctName = country.name.common;

  // pick 3 wrong answers
  const allNames = allCountries.map((c) => c.name.common);
  const wrongPool = allNames.filter((n) => n !== correctName);
  shuffleInPlace(wrongPool);

  const wrong = wrongPool.slice(0, 3);
  const choices = [correctName, ...wrong];
  shuffleInPlace(choices);

  return {
    prompt_id: country.cca2,
    image_url: flagUrlFromCca2(country.cca2),
    choices,
    correct_index: choices.indexOf(correctName),
  };
}

// Load and cache the 195 country list once (per warm serverless instance)
async function loadFlagsIntoCache() {
  const res = await fetch(RESTCOUNTRIES_ALL);
  if (!res.ok) {
    throw new Error(
      `REST Countries fetch failed: ${res.status} ${res.statusText}`
    );
  }

  const all = await res.json();

  const filtered = all
    .filter((c) => c && c.cca2 && c.name?.common)
    .filter(isIn195);

  // Deduplicate by cca2
  const seen = new Set();
  const deduped = [];
  for (const c of filtered) {
    const code = String(c.cca2).toUpperCase();
    if (!seen.has(code)) {
      seen.add(code);
      deduped.push({ ...c, cca2: code });
    }
  }

  flagsCache = {
    loaded: true,
    countries: deduped,
  };
}

// Build a quickfire run with tier ramping
function buildTieredQuickfire(allCountries) {
  const byCode = new Map(allCountries.map((c) => [c.cca2, c]));

  // Filter tiers down to only codes that exist in our 195 list
  const tier1 = unique(TIER_1).filter((code) => byCode.has(code));
  const tier2 = unique(TIER_2).filter((code) => byCode.has(code));
  const tier3 = unique(TIER_3).filter((code) => byCode.has(code));

  // Safety: if tier lists are missing some codes, we top up from remaining pool
  const used = new Set();

  function takeFromTier(tierCodes, count) {
    const picks = pickRandomFrom(tierCodes, count);
    picks.forEach((c) => used.add(c));
    return picks;
  }

  let q1 = takeFromTier(tier1, 10);
  let q2 = takeFromTier(tier2, 10);
  let q3 = takeFromTier(tier3, 10);

  // Top-up logic (if any tier had <10 available due to list mismatch)
  const need = 30 - (q1.length + q2.length + q3.length);
  if (need > 0) {
    const remaining = allCountries
      .map((c) => c.cca2)
      .filter((code) => !used.has(code));
    const extra = pickRandomFrom(remaining, need);
    // Put extras into the hardest section so early game stays easy
    q3 = q3.concat(extra);
  }

  // Keep ramp: shuffle within each tier only (so order still feels fresh)
  shuffleInPlace(q1);
  shuffleInPlace(q2);
  shuffleInPlace(q3);

  const runCodes = [...q1, ...q2, ...q3];
  const runCountries = runCodes.map((code) => byCode.get(code)).filter(Boolean);

  return runCountries;
}

// ----------------------------
// Handler
// ----------------------------
module.exports = async (req, res) => {
  try {
    const mode = String(req.query.mode || "quickfire").toLowerCase();
    const category = String(req.query.category || "flags").toLowerCase();

    if (category !== "flags") {
      return res.status(400).json({
        error: "Unknown category. Only 'flags' supported right now.",
      });
    }

    if (!flagsCache.loaded) {
      await loadFlagsIntoCache();
    }

    const totalPlanned = mode === "hardmode" ? 195 : 30;

    let runCountries;

    if (mode === "hardmode") {
      // Hardmode: full 195, shuffled
      runCountries = [...flagsCache.countries];
      shuffleInPlace(runCountries);
      runCountries = runCountries.slice(0, 195);
    } else {
      // Quickfire: tier ramp 10/10/10
      runCountries = buildTieredQuickfire(flagsCache.countries);
      runCountries = runCountries.slice(0, 30);
    }

    const questions = runCountries.map((c) =>
      buildMultipleChoiceQuestion(c, flagsCache.countries)
    );

    // No caching: each request should be unique
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    return res.json({
      mode,
      category,
      totalPlanned,
      totalAvailable: flagsCache.countries.length,
      totalUsed: questions.length,
      questions,
      generatedAt: Date.now(),
      quickfireRamp: mode !== "hardmode" ? { tier1: 10, tier2: 10, tier3: 10 } : null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
