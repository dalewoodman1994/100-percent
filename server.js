// server.js
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname)));

// ---------- helpers ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickN(pool, n) {
  return shuffle(pool).slice(0, Math.min(n, pool.length));
}
function pickWrongChoices(correctName, pool, n = 3) {
  const others = pool.filter(x => x.name !== correctName);
  return shuffle(others).slice(0, n).map(x => x.name);
}

// ---------- UN195 filter (UN members + 2 observers) ----------
const UN_OBSERVERS = new Set(["PSE", "VAT"]); // Palestine, Holy See (Vatican)
function toUN195(items) {
  // UN members (193) that are independent + observers (2) => 195
  return items.filter(x =>
    (x.unMember === true && x.independent === true) || UN_OBSERVERS.has(x.code)
  );
}

// ---------- tiers (CCA3 codes) ----------
const TIER1 = new Set([
  // super recognisable / popular
  "USA","GBR","FRA","DEU","ESP","ITA","CAN","AUS","NZL","IRL","PRT","NLD",
  "BEL","CHE","AUT","SWE","NOR","DNK","FIN","POL","CZE","GRC","HUN","ROU",
  "BGR","UKR","RUS","TUR","JPN","CHN","IND","KOR","BRA","MEX","ARG","ZAF"
]);

const TIER2 = new Set([
  // recognisable but a bit more “medium”
  "COL","CHL","PER","URY","VEN","CUB","DOM","JAM","PAN","CRI",
  "IDN","THA","VNM","MYS","PHL","SGP",
  "SVK","SVN","HRV","SRB","BIH","ALB","MKD",
  "MAR","DZA","TUN","EGY","NGA","GHA","KEN","TZA","UGA",
  "ISR","SAU","ARE","QAT","IRN","PAK"
]);

function buildQuickfireBalanced(un195) {
  const tier1Pool = un195.filter(x => TIER1.has(x.code));
  const tier2Pool = un195.filter(x => TIER2.has(x.code) && !TIER1.has(x.code));
  const tier3Pool = un195.filter(x => !TIER1.has(x.code) && !TIER2.has(x.code));

  // Q1–15: Tier 1 + Tier 2 only (balanced)
  // tweak counts: 9 tier1 + 6 tier2 gives a nice “not too easy”
  const firstHalf = [
    ...pickN(tier1Pool, 9),
    ...pickN(tier2Pool, 6)
  ];

  const used1 = new Set(firstHalf.map(x => x.code));

  // Q16–30: mixture of tier1/2/3, with a little tier3 sprinkled
  // tweak counts: 6 tier1 + 6 tier2 + 3 tier3
  const tier1Remaining = tier1Pool.filter(x => !used1.has(x.code));
  const tier2Remaining = tier2Pool.filter(x => !used1.has(x.code));
  const tier3Remaining = tier3Pool.filter(x => !used1.has(x.code));

  let secondHalf = [
    ...pickN(tier1Remaining, 6),
    ...pickN(tier2Remaining, 6),
    ...pickN(tier3Remaining, 3)
  ];

  // If any pool is short, top up from remaining UN195 (excluding used)
  let runPool = [...firstHalf, ...secondHalf];
  if (runPool.length < 30) {
    const usedAll = new Set(runPool.map(x => x.code));
    const remaining = un195.filter(x => !usedAll.has(x.code));
    runPool = runPool.concat(pickN(remaining, 30 - runPool.length));
  }

  // Keep within halves but randomize inside each half so it feels fresh:
  const first15 = shuffle(runPool.slice(0, 15));
  const last15 = shuffle(runPool.slice(15, 30));

  return [...first15, ...last15].slice(0, 30);
}

// ---------- API route ----------
app.get("/api/questionset", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    const mode = (req.query.mode || "quickfire").toLowerCase();
    const category = (req.query.category || "flags").toLowerCase();

    if (category !== "flags") {
      return res.status(400).json({ error: "Only category=flags supported right now." });
    }

    // Include unMember + independent so we can filter to UN195
    const r = await fetch("https://restcountries.com/v3.1/all?fields=name,flags,cca3,unMember,independent");
    if (!r.ok) throw new Error("Failed to fetch countries");
    const countries = await r.json();

    const allItems = countries
      .map(c => ({
        name: c?.name?.common,
        code: c?.cca3,
        flag: c?.flags?.png || c?.flags?.svg,
        unMember: c?.unMember === true,
        independent: c?.independent === true
      }))
      .filter(x => x.name && x.code && x.flag);

    const un195 = toUN195(allItems);

    let runPool;
    let totalPlanned;

    if (mode === "hardmode") {
      totalPlanned = 195;
      // if un195 isn't exactly 195 due to upstream changes, still keep hardmode stable
      runPool = shuffle(un195).slice(0, Math.min(195, un195.length));
    } else {
      totalPlanned = 30;
      runPool = buildQuickfireBalanced(un195);
    }

    const questions = runPool.map((c, i) => {
      const wrongs = pickWrongChoices(c.name, un195, 3);
      const choices = shuffle([c.name, ...wrongs]);
      const correct_index = choices.indexOf(c.name);

      return {
        id: `${c.code}-${i}`,
        image_url: c.flag,
        choices,
        correct_index,
        correct: c.name,
        code: c.code
      };
    });

    return res.json({ category, mode, totalPlanned, questions });

  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Express v5 catch-all
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});
