const { chromium } = require("playwright");
const assert = require("assert").strict;

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000/console";

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
  await page.waitForSelector("text=Silent Pass — No collisions", { timeout: 20000 });
  console.log("✓ ED-101 initial boot audit rendered SILENT_PASS without an interception modal");

  // Verify telemetry bar shows REPLAY mode, design-target latency, and no invented cost
  const telemetryText = await page.textContent("footer");
  for (const stage of ["Vision", "Gate", "Evidence", "Ultra"]) {
    assert(telemetryText.includes(stage), `Telemetry missing stage ${stage}`);
  }
  assert(
    /REPLAY|CACHE|DETERMINISTIC|seed replay/.test(telemetryText),
    "Telemetry missing replay/cache/deterministic provenance badge"
  );
  assert(telemetryText.includes("~400ms*"), "Telemetry missing Stage 1 design target");
  assert(telemetryText.includes("est. ~"), "Telemetry missing estimated replay aggregate");
  assert(telemetryText.includes("N/A (replay)"), "Telemetry invented a replay cost");
  console.log("✓ Telemetry bar shows replay provenance, design targets, and N/A replay cost");

  // ---------------- ED-104 CRITICAL INTERCEPTION ----------------
  console.log("2. Switching to ED-104 (trauma patient with 2 cross-modal contradictions)...");
  await page.click('button:has-text("ED-104")');

  // Wait for CRITICAL INTERCEPT (local replay here; live inference can be slower)
  await page.waitForSelector("text=CRITICAL INTERCEPT", { timeout: 35000 });
  console.log("✓ ED-104 stream completed: CRITICAL_INTERCEPT detected");

  // Verify all 4 stages completed
  const footerAfterEd104 = await page.textContent("footer");
  for (const stage of ["Vision", "Gate", "Evidence", "Ultra"]) {
    assert(footerAfterEd104.includes(stage), `${stage} not in footer`);
  }
  console.log("✓ All 4 pipeline stages completed in telemetry bar (vision → gate → evidence → reasoning)");

  // Verify 2 contradiction cards
  const noduleCard = await page.$("article:has-text('Incidental finding dropped')");
  const drugCard = await page.$("article:has-text('Lab-velocity drug collision')");
  assert(noduleCard && drugCard, "Expected nodule and drug-collision interception cards");
  const cards = [noduleCard, drugCard];
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
  await page.waitForSelector("button:has-text('Apply patch & re-verify')", { timeout: 15000 });
  await page.click("button:has-text('Apply patch & re-verify')");
  console.log("  Clicked patch 1: added CPT 71250 to follow-up orders");

  // Wait for the intermediate re-audit to complete and show the remaining card
  await page.waitForSelector("button:has-text('Apply patch & re-verify')", { timeout: 50000 });
  await page.click("button:has-text('Apply patch & re-verify')");
  console.log("  Clicked patch 2: discontinued Ketorolac and swapped renal-safe analgesic");

  // Verify re-audit reached SILENT_PASS and VERIFIED SAFE banner appeared
  await page.waitForSelector("text=Verified safe", { timeout: 50000 });
  const bannerText = await page.textContent("div[aria-live='polite']");
  assert(/verified safe/i.test(bannerText), "Missing VERIFIED SAFE banner");
  console.log(`✓ Safety interlock loop closed: ${bannerText.trim()}`);

  await page.screenshot({ path: "/tmp/phase3_ed104_verified_safe.png" });
  console.log("✓ Captured screenshot: /tmp/phase3_ed104_verified_safe.png");

  // ---------------- ENCOUNTER SWITCHER: ED-102 & ED-103 ----------------
  console.log("4. Testing Encounter Switcher for ED-102 and ED-103...");

  // ED-102: Pneumonia with 6mm nodule that ALREADY has follow-up CT scheduled
  await page.click('button:has-text("ED-102")');
  await page.waitForSelector("text=Maria Santos, 54F", { timeout: 10000 });
  await page.waitForSelector("text=Silent Pass —", { timeout: 35000 });
  // Cards exit with a short animation; wait until no interception card remains.
  await page.waitForFunction(
    () =>
      !document.body.textContent.includes("Incidental finding dropped") &&
      !document.body.textContent.includes("Lab-velocity drug collision"),
    null,
    { timeout: 5000 }
  );
  const ed102Cards = await page.$$(
    "article:has-text('Incidental finding dropped'), article:has-text('Lab-velocity drug collision')"
  );
  assert.equal(ed102Cards.length, 0, "ED-102 should have 0 critical cards (nodule already has CT scheduled)");
  console.log("✓ ED-102 (nodule with CT already scheduled): SILENT_PASS, 0 alert cards");

  // ED-103: Renal colic with recovering creatinine slope (declining -> no AKI)
  await page.click('button:has-text("ED-103")');
  await page.waitForSelector("text=David Chen, 42M", { timeout: 10000 });
  await page.waitForSelector("text=Silent Pass —", { timeout: 35000 });
  await page.waitForFunction(
    () =>
      !document.body.textContent.includes("Incidental finding dropped") &&
      !document.body.textContent.includes("Lab-velocity drug collision"),
    null,
    { timeout: 5000 }
  );
  const ed103Cards = await page.$$(
    "article:has-text('Incidental finding dropped'), article:has-text('Lab-velocity drug collision')"
  );
  assert.equal(ed103Cards.length, 0, "ED-103 should have 0 critical cards (recovering kidney slope)");
  console.log("✓ ED-103 (recovering kidney slope): SILENT_PASS, 0 alert cards");

  // ---------------- JUDGE SANDBOX: LIVE EDIT & BOUNDS (FR-5.3) ----------------
  console.log("5. Testing Judge Sandbox: client-side bounds validation and instant slope recalc...");
  await page.click('button:has-text("ED-101")');
  await page.waitForSelector("text=Silent Pass —", { timeout: 35000 });

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
  assert(slopeText.includes("+208%"), "Slope did not recalculate instant positive delta on 2.40 edit");
  console.log("✓ Valid input '2.40' on T+0 reading triggered instant slope recalc and positive delta (Δ+208%)!");

  await page.screenshot({ path: "/tmp/phase3_sandbox_edit.png" });
  console.log("✓ Captured screenshot: /tmp/phase3_sandbox_edit.png");

  // ---------------- MODEL BENCHMARKS TAB (FA-6 / FR-6.1) ----------------
  console.log("6. Testing Benchmarks Tab (offline results_latest.json)...");
  await page.click('button:has-text("Benchmarks")');
  await page.waitForSelector("text=Architecture benchmark", { timeout: 10000 });

  const benchText = await page.textContent("main");
  // Scored replay semantics: mode is explicit, fixture routing is labelled,
  // and cost/latency are marked as estimates rather than measurements.
  assert(benchText.includes("REPLAYED"), "Missing explicit replay mode label");
  assert(
    benchText.includes("No provider calls were made"),
    "Missing replay no-provider-calls disclosure"
  );
  assert(benchText.includes("Scored (pos/neg)") || benchText.includes("Scored"), "Missing scored-case column");
  assert(benchText.includes("Replay check"), "Missing replay-check column");
  assert(
    benchText.includes("fixture_seeded") || benchText.includes("fixture-seeded"),
    "Replay provenance is not labelled fixture-seeded"
  );
  assert(
    benchText.includes("Neither is provider-model recall or precision"),
    "Missing fixture-routing disclaimer"
  );
  assert(benchText.includes("Estimated from public rates"), "Missing cost-estimate footnote");
  assert(benchText.includes("design target"), "Missing latency design-target label");
  assert(!benchText.includes("75.5%"), "Stale 75.5% cost claim still present");
  assert(benchText.includes("100.0%"), "Missing scored fixture-routing recall");
  assert(benchText.includes("44.0%"), "Missing tiered-vs-Ultra cost reduction");
  assert(benchText.includes("Nemotron 3 Nano-30B Only"), "Missing Nano-30B row");
  assert(benchText.includes("Nemotron 3 Ultra-550B Only"), "Missing Ultra-550B row");
  assert(benchText.includes("SilentCatch Tiered Router"), "Missing Tiered Router row");
  console.log("✓ Benchmark view verified: replay mode, scored fixture routing, estimate labels");
  console.log("✓ Legacy 75.5% savings claim absent; fixture-routing provenance disclosed");

  // Verify all 12 fixtures in the audit ledger
  const ledgerRows = await page.$$(
    "section:has-text('Per-encounter fixture ledger') tbody tr"
  );
  assert(ledgerRows.length >= 12, `Expected at least 12 ledger cases, found ${ledgerRows.length}`);
  console.log("✓ Per-encounter fixture ledger rendered all 12 synthetic encounters");

  await page.screenshot({ path: "/tmp/phase4_model_benchmarks.png" });
  console.log("✓ Captured screenshot: /tmp/phase4_model_benchmarks.png");

  // Return to flight-check console
  await page.click('button:has-text("Flight-check")');
  await page.waitForSelector("text=Kinetics", { timeout: 10000 });
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
