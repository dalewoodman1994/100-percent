// server.js
// Local dev server for your game.
// IMPORTANT: This server REUSES the Vercel API function at ./api/questionset.js
// so localhost behaves exactly like your Vercel deployment.

"use strict";

const express = require("express");
const path = require("path");

// Load .env if present (safe even if you don't use it)
try {
  require("dotenv").config();
} catch (_) {
  // ignore if dotenv not installed
}

const app = express();

// Use 3001 by default so it doesn't clash with other projects on 3000
const PORT = Number(process.env.PORT || 3001);

// ---------- Static Files ----------
const ROOT_DIR = __dirname;

// Serve your static site files (index.html, about.html, privacy.html, css/images if any)
app.use(express.static(ROOT_DIR, { extensions: ["html"] }));

// ---------- API Handlers ----------
// Reuse Vercel serverless function locally
let questionsetHandler = null;

try {
  // This requires you to have: /api/questionset.js (folder MUST be lowercase "api")
  questionsetHandler = require("./api/questionset");
} catch (err) {
  console.error("❌ Could not load ./api/questionset.js");
  console.error("   Make sure the file exists at: C:\\Users\\Clare\\100game\\api\\questionset.js");
  console.error("   NOTE: folder name must be lowercase 'api'");
  console.error("   Error:", err.message);
}

// Health check (useful for debugging)
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    server: "local-express",
    port: PORT,
    time: new Date().toISOString(),
    questionsetLoaded: !!questionsetHandler,
  });
});

// Questionset API (flags + capitals)
app.get("/api/questionset", async (req, res) => {
  if (!questionsetHandler) {
    return res.status(500).json({
      error:
        "Missing ./api/questionset.js. Create api/questionset.js (lowercase folder) and restart the server.",
    });
  }

  // Forward to the same handler Vercel uses
  try {
    return await questionsetHandler(req, res);
  } catch (err) {
    console.error("❌ questionsetHandler crashed:", err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

// ---------- Page Routes ----------
// Root loads index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

// Optional direct routes if you want them explicit
app.get("/about", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "about.html"));
});

app.get("/privacy", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "privacy.html"));
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).send("Not Found");
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
  console.log(`✅ Status:   http://localhost:${PORT}/api/status`);
  console.log(`✅ Flags:    http://localhost:${PORT}/api/questionset?mode=quickfire&category=flags`);
  console.log(`✅ Capitals: http://localhost:${PORT}/api/questionset?mode=quickfire&category=capitals`);
});