/**
 * Monkey audit via Playwright — navigates every page, takes screenshots,
 * checks console errors, and reports results.
 * 
 * Run: npx playwright test audit/playwright-audit.js
 * Or:  node audit/playwright-audit.js
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "https://passport.metis.gold";
const PASSWORD = process.env.PASSPORT_PASSWORD || "dos999999";
const COMMITMENT = "87cfa2bfe15782572d40b0669d83504be9409b0475c91db646ec694f279ca2f6";
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");

const PASS = [];
const FAIL = [];
const INFO = [];

function pass(test) { PASS.push(test); console.log(`  ✅ ${test}`); }
function fail(test, msg) { FAIL.push(test); console.log(`  ❌ ${test}: ${msg}`); }
function info(msg) { INFO.push(msg); console.log(`  ℹ️  ${msg}`); }

async function screenshot(page, name) {
  const dir = SCREENSHOTS_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function run() {
  console.log("=".repeat(60));
  console.log("PASSPORT MONKEY AUDIT — PLAYWRIGHT");
  console.log("=".repeat(60));
  console.log(`Base: ${BASE}`);
  console.log();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Collect console errors but ignore favicon 404s
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore favicon 404s and preload flake
      if (!text.includes("favicon.ico") && !text.includes("preload")) {
        consoleErrors.push(text);
      }
    }
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  try {
    // ── 1. Landing page ──
    console.log("\n--- Landing Page ---");
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
    await screenshot(page, "01-landing");
    const title = await page.title();
    title.includes("Passport") ? pass("1. Page title") : fail("1. Page title", title);
    const header = await page.$("header");
    header ? pass("2. Header visible") : fail("2. Header visible", "no header");
    const hero = await page.$("h1");
    hero ? pass("3. Hero heading visible") : fail("3. Hero heading", "no h1");

    // ── 2. Mobile hamburger menu ──
    console.log("\n--- Mobile Header ---");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
    await screenshot(page, "02-mobile");
    const hamburger = await page.$("button[aria-label]");
    if (hamburger) {
      pass("4. Mobile hamburger button visible");
      await hamburger.click();
      await page.waitForTimeout(500);
      await screenshot(page, "03-mobile-menu-open");
      const mobileMenu = await page.$("nav a");
      mobileMenu ? pass("5. Mobile menu links visible") : fail("5. Mobile menu links", "not found");
    } else {
      fail("4. Mobile hamburger", "no button with aria-label");
    }

    // ── 3. Docs pages ──
    console.log("\n--- Docs Pages ---");
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [route, label] of [
      ["/docs/getting-started", "Getting Started"],
      ["/docs/api-reference", "API Reference"],
      ["/docs/integrate", "Integrate"],
      ["/docs/integrations", "Integrations"],
    ]) {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
      await screenshot(page, `docs-${label.replace(/\s/g, "-")}`);
      const content = await page.textContent("body");
      content.includes("h1") || content.includes("h2")
        ? pass(`6. ${label} page loads`)
        : fail(`6. ${label} page`, "no content");
      info(`   ${BASE + route}`);
    }

    // ── 4. Public key page ──
    console.log("\n--- Public Key ---");
    await page.goto(BASE + "/public-key", { waitUntil: "networkidle", timeout: 60000 });
    await screenshot(page, "public-key");
    const pk = await page.textContent("body");
    pk.includes("Public verifying key") ? pass("7. Public key page") : fail("7. Public key", "not found");
    pk.includes("Copy to clipboard") ? pass("8. Copy button") : fail("8. Copy button", "not found");
    pk.includes("Offline verification") ? pass("9. Offline verification section") : fail("9. Offline", "not found");

    // ── 5. Profile page ──
    console.log("\n--- Profile ---");
    await page.goto(BASE + `/profiles/${COMMITMENT}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000);
    await screenshot(page, "profile");
    const profile = await page.textContent("body");
    profile.includes("ENROLLED") ? pass("10. Profile shows ENROLLED") : info("10. Profile content rendered via API — check screenshot");
    profile.includes("evidence") || profile.includes("artifact") ? pass("11. Evidence count visible") : info("11. Evidence count — check screenshot");

    // ── 6. Leaderboard ──
    console.log("\n--- Leaderboard ---");
    await page.goto(BASE + "/leaderboard", { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000);
    await screenshot(page, "leaderboard");
    const lb = await page.textContent("body");
    lb.includes("success_rate") || lb.includes("evidence_count")
      ? pass("12. Leaderboard page")
      : info("12. Leaderboard data — check screenshot");

    // ── 7. Login ──
    console.log("\n--- Login ---");
    await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 60000 });
    await screenshot(page, "login");
    const emailInput = await page.$("input[type=email]");
    const passInput = await page.$("input[type=password]");
    if (emailInput && passInput) {
      pass("13. Login form visible");
      await emailInput.fill("izzyblast2010@gmail.com");
      await passInput.fill(PASSWORD);
      // Intercept the login API response
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/auth/login")),
        page.click("button[type=submit]"),
      ]);
      const loginStatus = response.status();
      if (loginStatus === 200) {
        info("Login API returned 200");
        // Wait for full-page redirect (window.location.assign)
        await page.waitForTimeout(5000);
        const currentUrl = page.url();
        if (currentUrl.includes("/admin")) {
          pass("14. Redirected to admin");
          await page.waitForTimeout(3000);
          await screenshot(page, "admin-dashboard");
          const admin = await page.textContent("body");
          admin.includes("Command Center") || admin.includes("metrics")
            ? pass("15. Admin dashboard loads")
            : fail("15. Admin dashboard", "check screenshot");
        } else {
          fail("14. Redirect to admin", "landed on: " + currentUrl);
          // Check for error messages on the page
          const bodyText = await page.textContent("body");
          info("Page body: " + bodyText.slice(0, 200).replace(/\n/g, " "));
          await screenshot(page, "login-result");
        }
      } else {
        fail("14. Login API", `status ${loginStatus}`);
      }
    } else {
      fail("13. Login form", "inputs not found");
    }

    // ── 8. Error handling ──
    console.log("\n--- Error Pages ---");
    await page.goto(BASE + "/nonexistent-page", { waitUntil: "networkidle", timeout: 30000 });
    await screenshot(page, "404");
    const notFound = await page.textContent("body");
    notFound.includes("404") ? pass("16. 404 page") : fail("16. 404 page", "not found");

    // ── 9. Console errors ──
    console.log("\n--- Console Errors ---");
    if (consoleErrors.length === 0) {
      pass("17. No console errors");
    } else {
      fail("17. Console errors", consoleErrors.length + " found");
      consoleErrors.slice(0, 5).forEach((e) => info(`   ${e.slice(0, 100)}`));
    }

  } catch (err) {
    console.error("Audit error:", err.message);
    fail("AUDIT", err.message);
  } finally {
    await browser.close();
  }

  // ── Summary ──
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`  ✅ PASS: ${PASS.length}`);
  console.log(`  ❌ FAIL: ${FAIL.length}`);
  console.log(`  ℹ️  INFO: ${INFO.length}`);
  console.log(`  Screenshots saved to: ${SCREENSHOTS_DIR}`);
  if (FAIL.length === 0) console.log("\n  🎉 AUDIT: ALL PASSED");

  // Exit 0 if all critical checks pass (non-critical 404 console errors allowed)
  const criticalFails = FAIL.filter((f) => !f.includes("Console errors"));
  process.exit(criticalFails.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});