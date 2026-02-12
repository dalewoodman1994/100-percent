// Vercel Serverless Function: /api/questionset
// Returns a fresh question set every request (NO CACHING)

let flagsCache = {
  loaded: false,
  countries: [],
};

const RESTCOUNTRIES_ALL =
  "https://restcountries.com/v3.1/all?fields=name,cca2,unMember";

const OBSERVER_STATES = new Set(["Vatican City", "Palestine"]);

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

function pickRandomDistinct(arr, n, excludeSet = new Set()) {
  const pool = arr.filter((x) => !excludeSet.has(x));
  shuffleInPlace(pool);
  return pool.slice(0, n);
}

function buildMultipleChoiceQuestion(country, allCountries) {
  const correctName = country.name.common;

  const exclude = new Set([correctName]);
  const wrong = pickRandomDistinct(
    allCountries.map((c) => c.name.common),
    3,
    exclude
  );

  const choices = [correctName, ...wrong];
  shuffleInPlace(choices);

  return {
    prompt_id: country.cca2,
    image_url: flagUrlFromCca2(country.cca2),
    choices,
    correct_index: choices.indexOf(correctName),
  };
}

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

    const countries = [...flagsCache.countries];
    shuffleInPlace(countries);

    const runCountries =
      mode === "hardmode"
        ? countries.slice(0, 195)
        : countries.slice(0, 30);

    const questions = runCountries.map((c) =>
      buildMultipleChoiceQuestion(c, flagsCache.countries)
    );

    // 🚫 Disable ALL caching (important fix)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    return res.json({
      mode,
      category,
      totalPlanned,
      totalAvailable: flagsCache.countries.length,
      totalUsed: questions.length,
      questions,
      generatedAt: Date.now(), // forces uniqueness
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
