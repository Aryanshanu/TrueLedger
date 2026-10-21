// Minimal static server for Cloud Run. The backend's URL is injected at
// container start (not baked into the JS bundle at build time), so the
// same image works locally and once deployed without a rebuild.
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8081";
// Optional shared key for the backend's auth gate (see backend/main.py's
// API_KEY env var). Server-side injection, same mechanism as BACKEND_URL -
// never baked into app.js at build time. This is NOT real secrecy (it
// ships to the browser via /config.js, visible in dev tools like
// BACKEND_URL already is); it's friction against anonymous bot/scanner
// traffic hitting the Gemini-calling endpoints, which is the threat this
// is meant to raise the cost of, not a real access-control boundary.
// undefined when unset, which the backend treats as "auth disabled".
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";

app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  res.send(`window.__CONFIG__ = ${JSON.stringify({ BACKEND_URL, BACKEND_API_KEY })};`);
});

// The Desk moved from "/" to "/desk" (the landing page now owns "/").
// Query strings (e.g. /desk?case=b_seasonal) pass through untouched -
// Express only matches the path, app.js reads location.search itself.
app.get("/desk", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "desk.html"));
});

// Invisible Dev Login gateway route
app.get("/app/dev-login", (_req, res) => {
  res.redirect("/desk#view=dev_auth");
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`TrueLedger frontend listening on :${PORT}, BACKEND_URL=${BACKEND_URL}`);
});
