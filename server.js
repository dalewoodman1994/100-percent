const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static(".")); // serves index.html from project folder

// ============================
// CONFIG
// ============================
const PORT = process.env.PORT || 3001;

// REST Countries requires specifying fields for /all endpoint
// We'll fetch ONLY what we need: name, cca2, unMember
// Source: REST Countries docs / bandwidth change notes
// https://restcountries.com/  (fields required)  :contentReference[oaicite:2]{index=2}
const RESTCOUNTRIES_ALL =
  "https://restcountries.com/v3.1/all?fields=name,cca2,unMember";

// FlagCDN URL patterns: https://flagcdn.com/w320/{code}.png (lowercase)
// Source: FlagCDN usage docs :contentReference[oaicite:3]{index=3}
function flagUrlFromCca2(cca2) {
  return `https://flagcdn.com/w320/${String(cca2).toLowerCase()}.png`;
}

// Define “195 countries” as:
// UN members (193) + UN observer states (Vatican City, Palestine) = 195
const OBSERVER_STATES = new Set(["Vatican City", "Palestine"]);

function isIn195(country) {
  const name = country?.name?.common;
  return country?.unMember === true || (name && OBSERVER_STATES.has(name));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandomDistinct(arr, n, excludeSet = new Set()) {
  const pool = arr.filter((x) => !excludeSet.has(x));
  shuffleInPlace(pool);
  return pool.slice(0, n);
}

function buildMultipleChoiceQuestion(country, allCountries) {
  // correct answer
  const correctName = country.name.common;

  // pick 3 wrong answers (distinct)
  const exclude = new Set([correctName]);
  const wrong = pickRandomDistinct(
    allCountries.map((c) => c.name.common),
    3,
    exclude
  );

  const choices = [correctName, ...wrong];
  shuffleInPlace(choices);

  return {
    prompt_id: country.cca2, // e.g. "FR"
    image_url: flagUrlFromCca2(country.cca2),
    choices,
    correct_index: choices.indexOf(correctName),
  };
}

// ============================
// IN-MEMORY DATA (FLAGS)
// ============================
let flagsCache = {
  loaded: false,
  updatedAt: null,
  countries: [], // array of { name: {common}, cca2, unMember }
};

async function loadFlagsIntoCache() {
  const res = await fetch(RESTCOUNTRIES_ALL);
  if (!res.ok) {
    throw new Error(`REST Countries fetch failed: ${res.status} ${res.statusText}`);
  }

  const all = await res.json();

  // Filter + normalize
  const filtered = all
    .filter((c) => c && c.cca2 && c.name?.common)
    .filter(isIn195);

  // Deduplicate by cca2 just in case
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
    updatedAt: new Date().toISOString(),
    countries: deduped,
  };

  console.log(
    `✅ Flags cache loaded: ${flagsCache.countries.length} countries (target 195)`
  );
}

// Load cache at startup
loadFlagsIntoCache().catch((e) => {
  console.error("❌ Failed to load flags on startup:", e.message);
});

// ============================
// ROUTES
// ============================

app.get("/health", (req, res) => {
  res.json({ ok: true, port: PORT });
});

// Shows cache status
app.get("/api/status", (req, res) => {
  res.json({
    flags: {
      loaded: flagsCache.loaded,
      updatedAt: flagsCache.updatedAt,
      count: flagsCache.countries.length,
    },
  });
});

// Dev helper: reload flags cache (so you don't restart server)
app.post("/api/reload/flags", async (req, res) => {
  try {
    await loadFlagsIntoCache();
    res.json({ ok: true, count: flagsCache.countries.length, updatedAt: flagsCache.updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get a full run question set:
// - quickfire: 30 unique flags
// - hardmode: all 195 flags (shuffled)
// category=flags is implemented now.
// category=football_flags is scaffolded for later.
app.get("/api/questionset", async (req, res) => {
  const mode = String(req.query.mode || "quickfire").toLowerCase();
  const category = String(req.query.category || "flags").toLowerCase();

  if (category !== "flags" && category !== "football_flags") {
    return res.status(400).json({ error: "Unknown category. Use flags (for now)." });
  }

  if (!flagsCache.loaded) {
    return res.status(503).json({ error: "Flags data is still loading. Try again in a moment." });
  }

  // ---- CATEGORY PROVIDERS ----
  if (category === "flags") {
    const totalPlanned = mode === "hardmode" ? 195 : 30;

    // Build an ordered list of countries for this run
    const countries = [...flagsCache.countries];
    shuffleInPlace(countries);

    // Take all for hardmode, or 30 for quickfire
    const runCountries =
      mode === "hardmode" ? countries.slice(0, 195) : countries.slice(0, 30);

    // Build questions with runtime-generated choices
    const questions = runCountries.map((c) =>
      buildMultipleChoiceQuestion(c, flagsCache.countries)
    );

    return res.json({
      mode,
      category,
      totalPlanned,
      totalAvailable: flagsCache.countries.length,
      totalUsed: questions.length,
      questions,
    });
  }

  // Football flags category (placeholder for next step)
  // We will implement this once you choose the dataset (national teams vs club crests)
  // because logos/crests often have licensing restrictions.
  if (category === "football_flags") {
    return res.status(501).json({
      error:
        "football_flags not implemented yet. Next step: choose 'national teams' or 'clubs' dataset.",
    });
  }
});

// Optional single-question endpoint (handy for debugging)
app.get("/api/question", async (req, res) => {
  if (!flagsCache.loaded) {
    return res.status(503).json({ error: "Flags data is still loading. Try again in a moment." });
  }

  const countries = flagsCache.countries;
  const c = countries[Math.floor(Math.random() * countries.length)];
  const q = buildMultipleChoiceQuestion(c, countries);
  res.json(q);
});

// ============================
// START SERVER
// ============================
app.listen(PORT, () => {
  console.log(`✅ 100 Percent Game running at http://localhost:${PORT}`);
});
