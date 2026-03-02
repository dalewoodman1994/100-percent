// server.js
// Local dev server for your static index.html + API route /api/questionset
// On Vercel, the /api/questionset route uses api/questionset.js directly.

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

const ROOT_DIR = __dirname;

let questionsetHandler = null;
try {
  questionsetHandler = require(path.join(ROOT_DIR, "api", "questionset.js"));
} catch (err) {
  console.error("❌ Could not load api/questionset.js");
  console.error("   Make sure the file exists at: C:\\Users\\Clare\\100game\\api\\questionset.js");
  console.error("   NOTE: folder name must be lowercase 'api'");
  console.error("   Error:", err.message);
}

// Health check
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    server: "local-express",
    port: PORT,
    time: new Date().toISOString(),
    questionsetLoaded: !!questionsetHandler,
  });
});

// API route
app.get("/api/questionset", async (req, res) => {
  if (!questionsetHandler) {
    return res.status(500).json({
      error:
        "Missing ./api/questionset.js. Create api/questionset.js (lowercase folder) and restart the server.",
    });
  }

  // Validate categories and modes here too (nice error messages)
  const category = String(req.query.category || "flags").toLowerCase();
  const mode = String(req.query.mode || "quickfire").toLowerCase();

  if (!["flags", "capitals"].includes(category)) {
    return res.status(400).json({
      error: "Unknown category. Use 'flags' or 'capitals'.",
    });
  }
  if (!["quickfire", "hardmode"].includes(mode)) {
    return res.status(400).json({
      error: "Unknown mode. Use 'quickfire' or 'hardmode'.",
    });
  }

  try {
    return await questionsetHandler(req, res);
  } catch (err) {
    console.error("❌ questionsetHandler crashed:", err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

// Serve static files (optional)
app.use(express.static(ROOT_DIR));

// Root loads index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

// 404
app.use((req, res) => {
  res.status(404).send("Not Found");
});

app.listen(PORT, () => {
  console.log(`✅ Server running: http://127.0.0.1:${PORT}`);
  console.log(`✅ Status:   http://127.0.0.1:${PORT}/api/status`);
  console.log(`✅ Flags:    http://127.0.0.1:${PORT}/api/questionset?mode=quickfire&category=flags`);
  console.log(`✅ Capitals: http://127.0.0.1:${PORT}/api/questionset?mode=quickfire&category=capitals`);
});