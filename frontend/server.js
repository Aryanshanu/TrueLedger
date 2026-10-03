// Minimal static server for Cloud Run. The backend's URL is injected at
// container start (not baked into the JS bundle at build time), so the
// same image works locally and once deployed without a rebuild.
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8081";

app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  res.send(`window.__CONFIG__ = ${JSON.stringify({ BACKEND_URL })};`);
});

// The Desk moved from "/" to "/desk" (the landing page now owns "/").
// Query strings (e.g. /desk?case=b_seasonal) pass through untouched -
// Express only matches the path, app.js reads location.search itself.
app.get("/desk", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "desk.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`TrueLedger frontend listening on :${PORT}, BACKEND_URL=${BACKEND_URL}`);
});
