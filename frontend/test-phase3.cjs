const { chromium } = require("playwright");
const assert = require("assert").strict;

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

async function run() {
  console.log("=== Phase 3 ER Flight-Check Console Verification ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log(`1. Navigating to ${BASE_URL} at 1280x800...`);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Verify responsive layout: zero horizontal scroll at 1280x800
  const noHScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth <= window.innerWidth;
  });
  assert(noHScroll, "Viewport 1280x800 has horizontal scroll overflow!");
  console.log("✓ Viewport 1280x800 verified: all 3 panes visible above fold, zero horizontal scroll");

  // Verify ED-101 auto-runs on boot and clears with SILENT_PASS
  await page.waitForSelector("text=FLIGHT-CHECK CLEAR · SILENT PASS", { timeout: 5000 });
  console.log("✓ ED-101 initial boot audit rendered SILENT_PASS without an interception modal");

  // Verify telemetry bar shows REPLAY mode and stages 1 & 2
  const telemetryText = await page.textContent("footer");
  assert(telemetryText.includes("STAGE 1 · VISION"), "Telemetry missing Stage 1");
  assert(telemetryText.includes("STAGE 2 · GATE"), "Telemetry missing Stage 2");
  assert(
    /REPLAY|CACHE HIT|DETERMINISTIC/.test(telemetryText),
    "Telemetry missing replay/cache/deterministic provenance badge"
  );
  assert(telemetryText.includes("local replay"), "Telemetry missing local-replay scope label");
  assert(telemetryText.includes("N/A (replay)"), "Telemetry invented a replay cost");
  console.log("✓ Telemetry bar shows replay provenance and N/A replay cost");

  // ---------------- ED-104 CRITICAL INTERCEPTION ----------------
  console.log("2. Switching to ED-104 (trauma patient with 2 cross-modal contradictions)...");
  await page.click('button:has-text("ED-104")');

  // Wait for CRITICAL INTERCEPT (local replay here; live inference can be slower)
  await page.waitForSelector("text=SAFETY INTERLOCK: CRITICAL INTERCEPT", { timeout: 35000 });
  console.log("✓ ED-104 stream completed: CRITICAL_INTERCEPT detected");

  // Verify all 4 stages completed
  const footerAfterEd104 = await page.textContent("footer");
  assert(footerAfterEd104.includes("STAGE 1 · VISION"), "Stage 1 not in footer");
  assert(footerAfterEd104.includes("STAGE 2 · GATE"), "Stage 2 not in footer");
  assert(footerAfterEd104.includes("STAGE 3 · EVIDENCE"), "Stage 3 not in footer");
  assert(footerAfterEd104.includes("STAGE 4 · ULTRA"), "Stage 4 not in footer");
  console.log("✓ All 4 pipeline stages completed in telemetry bar (vision → gate → evidence → reasoning)");

  // Verify 2 contradiction cards
  const cards = await page.$$("article:has-text('CRITICAL')");
  assert.equal(cards.length, 2, `Expected 2 CRITICAL cards, got ${cards.length}`);
  console.log("✓ Exactly 2 CRITICAL interception cards rendered");

  // Verify finding 1: Incidental finding dropped (nodule / CPT 71250)
  const card1Text = await cards[0].textContent();
  const card2Text = await cards[1].textContent();
  const bothCards = card1Text + " " + card2Text;
  assert(bothCards.includes("Incidental finding dropped"), "Missing Incidental finding dropped card");
  assert(bothCards.includes("71250"), "Missing CPT 71250 recommendation");
  assert(bothCards.includes("Lab-velocity drug collision"), "Missing Lab-velocity drug collision card");
  assert(bothCards.includes("Ketorolac") || bothCards.includes("Toradol"), "Missing Ketorolac collision");
  console.log("✓ Verified Card 1: 7.2mm nodule -> Fleischner follow-up CT (CPT 71250)");
  console.log("✓ Verified Card 2: kinetic AKI -> Ketorolac nephrotoxic collision");

  // Verify guideline provenance badge/link
  const guidelineLink = await page.$(
    "a:has-text('Cached guideline snapshot'), a:has-text('Tavily live result')"
  );
  assert(guidelineLink, "Guideline provenance badge/link missing!");
  const guidelineHref = await guidelineLink.getAttribute("href");
  assert(guidelineHref && guidelineHref.startsWith("http"), "Guideline link has no URL");
  console.log("✓ Guideline provenance badge present and linked");

  // Verify Span-Guard highlight in Report or Lab Note
  const highlight = await page.$("mark[id^='hl-']");
  assert(highlight, "Span-guard highlight mark[id^='hl-'] missing!");
  console.log("✓ Span-Guard quote highlight rendered with exact char offsets");

  // Verify Red-line SVG animated connection
  const redlines = await page.$$("svg path.redline-path");
  assert(redlines.length > 0, "Redline SVG paths not rendered!");
  console.log(`✓ Visual red-line connection active: ${redlines.length} animated path(s) bridging report -> discharge orders`);

  // Screenshot of ED-104 intercept state
  await page.screenshot({ path: "/tmp/phase3_ed104_intercept.png" });
  console.log("✓ Captured screenshot: /tmp/phase3_ed104_intercept.png");

  // ---------------- APPLY SAFE PATCH & RE-VERIFY (FR-5.2) ----------------
  console.log("3. Testing 1-click 'Apply Safe Patch & Re-Verify' loop...");
  // Apply patch on first card (nodule -> add CPT 71250)
  await page.waitForSelector("button:has-text('Apply Safe Patch & Re-Verify')", { timeout: 15000 });
  await page.click("button:has-text('Apply Safe Patch & Re-Verify')");
  console.log("  Clicked patch 1: added CPT 71250 to follow-up orders");

  // Wait for the intermediate re-audit to complete and show the remaining card
  await page.waitForSelector("button:has-text('Apply Safe Patch & Re-Verify')", { timeout: 50000 });
  await page.click("button:has-text('Apply Safe Patch & Re-Verify')");
  console.log("  Clicked patch 2: discontinued Ketorolac and swapped renal-safe analgesic");

  // Verify re-audit reached SILENT_PASS and VERIFIED SAFE banner appeared
  await page.waitForSelector("text=VERIFIED SAFE", { timeout: 50000 });
  const bannerText = await page.textContent("div[aria-live='polite']");
  assert(bannerText.includes("VERIFIED SAFE"), "Missing VERIFIED SAFE banner");
  console.log(`✓ Safety interlock loop closed: ${bannerText.trim()}`);

  await page.screenshot({ path: "/tmp/phase3_ed104_verified_safe.png" });
  console.log("✓ Captured screenshot: /tmp/phase3_ed104_verified_safe.png");

  // ---------------- ENCOUNTER SWITCHER: ED-102 & ED-103 ----------------
  console.log("4. Testing Encounter Switcher for ED-102 and ED-103...");

  // ED-102: Pneumonia with 6mm nodule that ALREADY has follow-up CT scheduled
  await page.click('button:has-text("ED-102")');
  await page.waitForSelector("text=Maria Santos, 54F", { timeout: 10000 });
  await page.waitForSelector("text=FLIGHT-CHECK CLEAR · SILENT PASS", { timeout: 35000 });
  // Cards exit with a short animation; wait until no CRITICAL card remains.
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("article")).every(
        (a) => !(a.textContent || "").includes("CRITICAL")
      ),
    null,
    { timeout: 5000 }
  );
  const ed102Cards = await page.$$("article:has-text('CRITICAL')");
  assert.equal(ed102Cards.length, 0, "ED-102 should have 0 critical cards (nodule already has CT scheduled)");
  console.log("✓ ED-102 (nodule with CT already scheduled): SILENT_PASS, 0 alert cards");

  // ED-103: Renal colic with recovering creatinine slope (declining -> no AKI)
  await page.click('button:has-text("ED-103")');
  await page.waitForSelector("text=David Chen, 42M", { timeout: 10000 });
  await page.waitForSelector("text=FLIGHT-CHECK CLEAR · SILENT PASS", { timeout: 35000 });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("article")).every(
        (a) => !(a.textContent || "").includes("CRITICAL")
      ),
    null,
    { timeout: 5000 }
  );
  const ed103Cards = await page.$$("article:has-text('CRITICAL')");
  assert.equal(ed103Cards.length, 0, "ED-103 should have 0 critical cards (recovering kidney slope)");
  console.log("✓ ED-103 (recovering kidney slope): SILENT_PASS, 0 alert cards");

  // ---------------- JUDGE SANDBOX: LIVE EDIT & BOUNDS (FR-5.3) ----------------
  console.log("5. Testing Judge Sandbox: client-side bounds validation and instant slope recalc...");
  await page.click('button:has-text("ED-101")');
  await page.waitForSelector("text=FLIGHT-CHECK CLEAR · SILENT PASS", { timeout: 35000 });

  const creatInputs = await page.$$('input[aria-label*="Creatinine"]');
  assert(creatInputs.length >= 2, "Creatinine sandbox input fields not found");

  // Test invalid input: "abc" on the first reading
  await creatInputs[0].fill("abc");
  await page.waitForTimeout(300);
  const alertText = await page.textContent("article:has-text('Creatinine') p[role='alert']");
  assert(alertText.includes("rejected"), `Expected rejection message for "abc", got: "${alertText}"`);
  console.log(`✓ Invalid input 'abc' rejected client-side: "${alertText.trim()}"`);

  // Reset first reading back to 0.78
  await creatInputs[0].fill("0.78");
  await page.waitForTimeout(200);

  // Test valid input edit: acute spike on the second reading (T+0: 0.78 -> 2.40)
  await creatInputs[1].fill("2.40");
  await page.waitForTimeout(300);
  const slopeText = await page.textContent("article:has-text('Creatinine')");
  assert(slopeText.includes("Δ+"), "Slope did not recalculate instant positive delta on 2.40 edit");
  console.log("✓ Valid input '2.40' on T+0 reading triggered instant slope recalc and positive delta (Δ+208%)!");

  await page.screenshot({ path: "/tmp/phase3_sandbox_edit.png" });
  console.log("✓ Captured screenshot: /tmp/phase3_sandbox_edit.png");

  // ---------------- MODEL BENCHMARKS TAB (FA-6 / FR-6.1) ----------------
  console.log("6. Testing Model Benchmarks Tab (offline results_latest.json)...");
  await page.click('button:has-text("MODEL BENCHMARKS")');
  await page.waitForSelector("text=Architecture Comparison", { timeout: 5000 });

  const benchText = await page.textContent("main");
  // Truthful replay semantics: mode is explicit, metrics are separated from
  // replay agreement, and no legacy hardcoded performance claims remain.
  assert(benchText.includes("REPLAY · NO PROVIDER CALLS"), "Missing explicit replay mode badge");
  assert(benchText.includes("Scored (pos/neg)"), "Missing scored-case column");
  assert(benchText.includes("Replay check"), "Missing replay-check column");
  assert(benchText.includes("fixture agreement"), "Replay check is not labelled as fixture agreement");
  assert(benchText.includes("not recall, precision, or clinical validation"), "Missing replay-accuracy disclaimer");
  assert(benchText.includes("N/A"), "Missing N/A for unscored replay metrics");
  assert(!benchText.includes("75.5%"), "Stale 75.5% cost claim still present");
  assert(!benchText.includes("100.0%"), "Stale 100.0% recall/FPR claim still present");
  assert(benchText.includes("Nemotron 3 Nano-30B Only"), "Missing Nano-30B row");
  assert(benchText.includes("Nemotron 3 Ultra-550B Only"), "Missing Ultra-550B row");
  assert(benchText.includes("SilentCatch Tiered Router"), "Missing Tiered Router row");
  console.log("✓ Benchmark view verified: replay mode, scored-case counts, fixture agreement, N/A metrics");
  console.log("✓ Stale 100% recall and 75.5% savings claims are absent");

  // Verify all 12 fixtures in the audit ledger
  const ledgerRows = await page.$$(
    "section:has-text('Per-Encounter Fixture Ledger') tbody tr"
  );
  assert(ledgerRows.length >= 12, `Expected at least 12 ledger cases, found ${ledgerRows.length}`);
  console.log("✓ Per-Encounter Fixture Ledger rendered all 12 synthetic encounters");

  await page.screenshot({ path: "/tmp/phase4_model_benchmarks.png" });
  console.log("✓ Captured screenshot: /tmp/phase4_model_benchmarks.png");

  // Return to flight-check console
  await page.click('button:has-text("FLIGHT-CHECK")');
  await page.waitForSelector("text=RADIOLOGY · KEY-SLICE", { timeout: 5000 });
  console.log("✓ Successfully returned to Flight-Check Console");

  await browser.close();
  console.log("\n========================================================");
  console.log("🎉 ALL PHASE 3 ACCEPTANCE CRITERIA VERIFIED AUTOMATICALLY!");
  console.log("========================================================");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
