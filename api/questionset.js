// api/questionset.js
// Supports:
//  - category=flags | capitals
//  - mode=quickfire | hardmode
//
// Quickfire is tiered: 10 easy + 10 medium + 10 hard
// Hardmode is random: 30 from full pool
//
// Data source: REST Countries v3.1 (cached in-memory)

const DEFAULT_TOTAL = 30;

// Curated "easy" country set (ISO2 codes, uppercase)
const TIER1 = new Set([
  "US","GB","FR","DE","IT","ES","PT","NL","BE","CH","AT","SE","NO","DK","FI","IE",
  "CA","AU","NZ","JP","CN","IN","BR","AR","MX","ZA","EG","TR","GR","PL","CZ","HU",
  "RO","UA","RU","KR","ID","TH","VN","PH","MY","SG","IL","SA","AE","IR","IQ",
]);

// Curated "medium" country set (ISO2 codes, uppercase)
const TIER2 = new Set([
  "CL","CO","PE","VE","EC","UY","BO","PY","CR","PA","GT","HN","SV","NI","DO","CU","JM",
  "IS","EE","LV","LT","SK","SI","HR","RS","BG","BY","MD","GE","AM","AZ","KZ","UZ",
  "PK","BD","LK","NP","MM","KH","LA","MN","TW","HK",
  "MA","DZ","TN","LY","SD","ET","KE","TZ","UG","GH","CI","SN","CM","AO","MZ","ZW","ZM","NA","BW",
]);

// Explicit exclusions for Capitals per your request + missing capital handling
const EXCLUDE_CAPITALS = new Set(["MC", "VA"]); // Monaco, Vatican City
const EXCLUDE_ALWAYS = new Set([]); // Add more ISO2s here if needed

let cache = {
  loadedAt: 0,
  countries: [],
  byIso2: new Map(),
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function titleCase(s) {
  if (!s) return s;
  // Keep internal capitalization reasonable; "São Tomé" etc. from dataset already OK.
  // We mainly want to avoid ALL CAPS UI; dataset typically provides correct casing.
  return String(s).trim();
}

async function loadCountriesIfNeeded() {
  const now = Date.now();
  // Cache for 24h
  if (cache.countries.length && now - cache.loadedAt < 24 * 60 * 60 * 1000) return;

  const url =
    "https://restcountries.com/v3.1/all?fields=name,cca2,capital,population,region,subregion";

  const res = await fetch(url, { headers: { "accept": "application/json" } });
  if (!res.ok) {
    throw new Error(`Failed to fetch REST Countries: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  const cleaned = [];
  const byIso2 = new Map();

  for (const c of data) {
    const iso2 = (c.cca2 || "").toUpperCase().trim();
    if (!iso2 || iso2.length !== 2) continue;
    if (EXCLUDE_ALWAYS.has(iso2)) continue;

    const name = c?.name?.common ? String(c.name.common).trim() : "";
    if (!name) continue;

    const capitalArr = Array.isArray(c.capital) ? c.capital : [];
    const capital = capitalArr.length ? String(capitalArr[0]).trim() : "";

    cleaned.push({
      iso2,
      name,
      capital,
      population: Number(c.population || 0),
      region: c.region || "",
      subregion: c.subregion || "",
    });
    byIso2.set(iso2, cleaned[cleaned.length - 1]);
  }

  cache = {
    loadedAt: now,
    countries: cleaned,
    byIso2,
  };
}

function pickTier(iso2) {
  if (TIER1.has(iso2)) return 1;
  if (TIER2.has(iso2)) return 2;
  return 3;
}

function buildTieredQuickfire(pool, total = DEFAULT_TOTAL) {
  // Pool is array of country objects
  const tier1 = [];
  const tier2 = [];
  const tier3 = [];

  for (const c of pool) {
    const t = pickTier(c.iso2);
    if (t === 1) tier1.push(c);
    else if (t === 2) tier2.push(c);
    else tier3.push(c);
  }

  shuffle(tier1);
  shuffle(tier2);
  shuffle(tier3);

  const n1 = Math.min(10, tier1.length);
  const n2 = Math.min(10, tier2.length);
  const n3 = Math.min(total - n1 - n2, tier3.length);

  const picked = [
    ...tier1.slice(0, n1),
    ...tier2.slice(0, n2),
    ...tier3.slice(0, n3),
  ];

  // If any tier is short, top up from remaining tiers
  if (picked.length < total) {
    const remaining = [
      ...tier1.slice(n1),
      ...tier2.slice(n2),
      ...tier3.slice(n3),
    ];
    shuffle(remaining);
    picked.push(...remaining.slice(0, total - picked.length));
  }

  return picked.slice(0, total);
}

function uniqueSample(arr, n, excludeSet) {
  const out = [];
  const used = new Set(excludeSet || []);
  const idxs = [];
  for (let i = 0; i < arr.length; i++) idxs.push(i);
  shuffle(idxs);
  for (const i of idxs) {
    const v = arr[i];
    if (used.has(v)) continue;
    used.add(v);
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

function buildFlagQuestion(country, allCountries) {
  const correct = country.name;
  // Distractors: other country names
  const allNames = allCountries.map((c) => c.name);
  const wrong = uniqueSample(allNames, 3, new Set([correct]));
  const choices = shuffle([correct, ...wrong]).map(titleCase);

  // FlagCDN uses lowercase iso2
  const image_url = `https://flagcdn.com/w320/${country.iso2.toLowerCase()}.png`;

  return {
    prompt_id: country.iso2,
    question: "Which country does this flag belong to?",
    image_url,
    choices,
    answer: titleCase(correct),
  };
}

function buildCapitalQuestion(country, capitalsPool) {
  const correct = country.capital;
  const allCaps = capitalsPool; // array of capital strings
  const wrong = uniqueSample(allCaps, 3, new Set([correct]));
  const choices = shuffle([correct, ...wrong]).map(titleCase);

  return {
    prompt_id: country.iso2,
    question: `What is the capital of ${titleCase(country.name)}?`,
    // no image_url for capitals
    choices,
    answer: titleCase(correct),
    meta: { country: titleCase(country.name) },
  };
}

function getEligibleFlagsCountries(allCountries) {
  // Flags: any country with valid iso2 + name is OK
  return allCountries.filter((c) => c.iso2 && c.name);
}

function getEligibleCapitalsCountries(allCountries) {
  return allCountries.filter((c) => {
    if (!c.iso2 || !c.name) return false;
    if (EXCLUDE_CAPITALS.has(c.iso2)) return false;
    const cap = (c.capital || "").trim();
    if (!cap) return false;
    return true;
  });
}

module.exports = async function questionset(req, res) {
  try {
    await loadCountriesIfNeeded();

    const mode = String(req.query.mode || "quickfire").toLowerCase();
    const category = String(req.query.category || "flags").toLowerCase();
    const total = DEFAULT_TOTAL;

    if (!["quickfire", "hardmode"].includes(mode)) {
      return res.status(400).json({ error: "Unknown mode. Use 'quickfire' or 'hardmode'." });
    }
    if (!["flags", "capitals"].includes(category)) {
      return res.status(400).json({ error: "Unknown category. Use 'flags' or 'capitals'." });
    }

    const all = cache.countries;

    if (category === "flags") {
      const pool = getEligibleFlagsCountries(all);
      const runCountries =
        mode === "quickfire"
          ? buildTieredQuickfire(pool, total)
          : shuffle([...pool]).slice(0, total);

      const questions = runCountries.map((c) => buildFlagQuestion(c, pool));

      return res.json({
        mode,
        category,
        totalPlanned: total,
        totalAvailable: pool.length,
        totalUsed: questions.length,
        questions,
      });
    }

    // category === "capitals"
    const pool = getEligibleCapitalsCountries(all);

    // capitalsPool for distractors
    const capitalsPool = pool.map((c) => c.capital).filter(Boolean).map((s) => String(s).trim());
    // remove duplicates
    const uniqueCaps = Array.from(new Set(capitalsPool));

    const runCountries =
      mode === "quickfire"
        ? buildTieredQuickfire(pool, total)
        : shuffle([...pool]).slice(0, total);

    const questions = runCountries.map((c) => buildCapitalQuestion(c, uniqueCaps));

    return res.json({
      mode,
      category,
      totalPlanned: total,
      totalAvailable: pool.length,
      totalUsed: questions.length,
      questions,
    });
  } catch (err) {
    console.error("questionset error:", err);
    return res.status(500).json({ error: String(err.message || err) });
  }
};