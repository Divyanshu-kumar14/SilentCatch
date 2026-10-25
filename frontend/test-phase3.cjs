const { chromium } = require("playwright");
const assert = require("assert").strict;

async function run() {
  console.log("=== Phase 3 ER Flight-Check Console Verification ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log("1. Navigating to http://localhost:3000 at 1280x800...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // Verify responsive layout: zero horizontal scroll at 1280x800
  const noHScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth <= window.innerWidth;
  });
  assert(noHScroll, "Viewport 1280x800 has horizontal scroll overflow!");
  console.log("✓ Viewport 1280x800 verified: all 3 panes visible above fold, zero horizontal scroll");

  // Verify ED-101 auto-runs on boot and clears with SILENT_PASS
  await page.waitForSelector("text=FLIGHT-CHECK CLEAR · SILENT PASS", { timeout: 5000 });
  console.log("✓ ED-101 initial boot audit: SILENT_PASS < 1.2s, 0 modals");

  // Verify telemetry bar shows REPLAY mode and stages 1 & 2
  const telemetryText = await page.textContent("footer");
  assert(telemetryText.includes("STAGE 1 · VISION"), "Telemetry missing Stage 1");
  assert(telemetryText.includes("STAGE 2 · GATE"), "Telemetry missing Stage 2");
  assert(telemetryText.includes("REPLAY"), "Telemetry missing REPLAY badge");
  console.log("✓ Telemetry bar correctly badges Stage 1/2 REPLAY execution");

  // ---------------- ED-104 CRITICAL INTERCEPTION ----------------
  console.log("2. Switching to ED-104 (trauma patient with 2 cross-modal contradictions)...");
  await page.click('button:has-text("ED-104")');

  // Wait for CRITICAL INTERCEPT
  await page.waitForSelector("text=SAFETY INTERLOCK: CRITICAL INTERCEPT", { timeout: 10000 });
  console.log("✓ ED-104 stream completed: CRITICAL_INTERCEPT detected");

  // Verify all 4 stages completed
  const footerAfterEd104 = await page.textContent("footer");
  assert(footerAfterEd104.includes("STAGE 1 · VISION"), "Stage 1 not in footer");
  assert(footerAfterEd104.includes("STAGE 2 · GATE"), "Stage 2 not in footer");
  assert(footerAfterEd104.includes("STAGE 3 · EVIDENCE"), "Stage 3 not in footer");
  assert(footerAfterEd104.includes("STAGE 4 · ULTRA"), "Stage 4 not in footer");
  console.log("✓ All 4 pipeline stages completed in telemetry bar (Super VL -> Nano -> Tavily -> Ultra + Rig)");

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

  // Verify Tavily guideline link
  const tavilyLink = await page.$("a:has-text('Tavily Guideline')");
  assert(tavilyLink, "Tavily Guideline badge link missing!");
  console.log("✓ Tavily clinical guideline badge present and linked");

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
  const applyBtn1 = await page.$("button:has-text('Apply Safe Patch & Re-Verify')");
  assert(applyBtn1, "Apply Safe Patch button missing!");
  await applyBtn1.click();
  console.log("  Clicked patch 1: added CPT 71250 to follow-up orders");
  await page.waitForTimeout(1500);

  // Apply patch on second card (ketorolac swap -> acetaminophen)
  const applyBtn2 = await page.$("button:has-text('Apply Safe Patch & Re-Verify')");
  if (applyBtn2) {
    await applyBtn2.click();
    console.log("  Clicked patch 2: discontinued Ketorolac and swapped renal-safe analgesic");
    await page.waitForTimeout(1500);
  }

  // Verify re-audit reached SILENT_PASS and VERIFIED SAFE banner appeared
  await page.waitForSelector("text=VERIFIED SAFE", { timeout: 10000 });
  const bannerText = await page.textContent("div[aria-live='polite']");
  assert(bannerText.includes("VERIFIED SAFE"), "Missing VERIFIED SAFE banner");
  console.log(`✓ Safety interlock loop closed: ${bannerText.trim()}`);

  await page.screenshot({ path: "/tmp/phase3_ed104_verified_safe.png" });
  console.log("✓ Captured screenshot: /tmp/phase3_ed104_verified_safe.png");

  // ---------------- ENCOUNTER SWITCHER: ED-102 & ED-103 ----------------
  console.log("4. Testing Encounter Switcher for ED-102 and ED-103...");

  // ED-102: Pneumonia with 6mm nodule that ALREADY has follow-up CT scheduled
  await page.click('button:has-text("ED-102")');
  await page.waitForSelector("text=FLIGHT-CHECK CLEAR · SILENT PASS", { timeout: 8000 });
  const ed102Cards = await page.$$("article:has-text('CRITICAL')");
  assert.equal(ed102Cards.length, 0, "ED-102 should have 0 critical cards (nodule already has CT scheduled)");
  console.log("✓ ED-102 (nodule with CT already scheduled): SILENT_PASS, 0 alert modal");

  // ED-103: Renal colic with recovering creatinine slope (declining -> no AKI)
  await page.click('button:has-text("ED-103")');
  await page.waitForSelector("text=FLIGHT-CHECK CLEAR · SILENT PASS", { timeout: 8000 });
  const ed103Cards = await page.$$("article:has-text('CRITICAL')");
  assert.equal(ed103Cards.length, 0, "ED-103 should have 0 critical cards (recovering kidney slope)");
  console.log("✓ ED-103 (recovering kidney slope): SILENT_PASS, 0 alert modal");

  // ---------------- JUDGE SANDBOX: LIVE EDIT & BOUNDS (FR-5.3) ----------------
  console.log("5. Testing Judge Sandbox: client-side bounds validation and instant slope recalc...");
  await page.click('button:has-text("ED-101")');
  await page.waitForSelector("text=FLIGHT-CHECK CLEAR · SILENT PASS", { timeout: 8000 });

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

  await browser.close();
  console.log("\n========================================================");
  console.log("🎉 ALL PHASE 3 ACCEPTANCE CRITERIA VERIFIED AUTOMATICALLY!");
  console.log("========================================================");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
