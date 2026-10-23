/* Run against the local preview server; uses the repository's existing Playwright. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("@playwright/test");

(async () => {
  const engine = process.argv[2] || "chromium";
  assert(
    ["chromium", "webkit", "firefox"].includes(engine),
    "Choose a supported browser",
  );
  const browser = await playwright[engine].launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  context.setDefaultTimeout(15000);
  const errors = [],
    externalRequests = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      externalRequests.push(request.url());
  });
  const check = (value, label) => {
    assert(value, label);
    checks.push(label);
    if (checks.length % 10 === 0)
      console.log(`${engine}: ${checks.length} checks — ${label}`);
  };
  const waitText = (selector, text, timeout = 5000) =>
    page.waitForFunction(
      ([s, t]) => document.querySelector(s)?.textContent.includes(t),
      [selector, text],
      { timeout },
    );
  const run = async (outcome) => {
    await page.locator("#operation-outcome").selectOption(outcome);
    await page.locator("#operation-run").click();
  };
  try {
    await page.goto("http://127.0.0.1:4178", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    check(
      (await page.locator(".mechanic-card").count()) === 14,
      "All fourteen motion studies",
    );
    check(
      (await page.locator(".mascot-card").count()) === 3,
      "All three mascot directions",
    );
    check(
      (await page.locator("[data-scenario]").count()) === 11,
      "All eleven application scenarios",
    );

    await page.locator("#intro-replay").click();
    await page.waitForTimeout(130);
    await page.locator("#pause-all").click();
    const paused = Number(await page.locator("#intro-scrub").inputValue());
    await page.waitForTimeout(150);
    check(
      Math.abs(
        Number(await page.locator("#intro-scrub").inputValue()) - paused,
      ) < 2,
      "Introduction pauses without resetting",
    );
    await page.locator("#pause-all").click();
    await page.waitForFunction(
      () => Number(document.querySelector("#intro-scrub").value) === 100,
    );
    checks.push("Introduction resumes to completion");
    await page.locator("#intro-scrub").evaluate((el) => {
      el.value = 50;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    check(
      await page.evaluate(() => {
        const values = [
          ...document.querySelectorAll("#hero-wordmark .intro-name span"),
        ].map((el) => +getComputedStyle(el).opacity);
        return values.some((x) => x === 0) && values.some((x) => x === 1);
      }),
      "Stepped reveal can be examined mid-frame",
    );
    await page.locator("[data-reveal=continuous]").click();
    await page.locator("#intro-scrub").evaluate((el) => {
      el.value = 50;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    check(
      await page
        .locator("#hero-wordmark .intro-name")
        .evaluate((el) => getComputedStyle(el).clipPath !== "none"),
      "Continuous reveal has a real intermediate mask",
    );
    await page.locator("[data-reveal=stepped]").click();
    await page.locator("#speed").selectOption("0.5");
    await page.locator("[data-scenario=welcome]").click();
    check(
      await page
        .locator(".context-intro")
        .evaluate((el) =>
          el
            .getAnimations({ subtree: true })
            .every(
              (a) =>
                a.effect.getTiming().duration === 900 && a.playbackRate === 0.5,
            ),
        ),
      "New context animation uses one consistent playback multiplier",
    );
    await page.locator("#speed").selectOption("1.5");
    await page.waitForFunction(() =>
      [
        ...document
          .querySelector(".context-intro")
          .getAnimations({ subtree: true }),
      ].every((a) => a.playbackRate === 1.5),
    );
    check(
      await page
        .locator(".context-intro")
        .evaluate((el) =>
          el
            .getAnimations({ subtree: true })
            .every(
              (a) =>
                a.effect.getTiming().duration === 900 && a.playbackRate === 1.5,
            ),
        ),
      "Changing playback speed preserves the base choreography duration",
    );
    await page.locator("#speed").selectOption("1");

    for (const id of await page
      .locator(".mechanic-card")
      .evaluateAll((els) => els.map((el) => el.dataset.study))) {
      await page.locator(`[data-inspect="${id}"]`).click();
      await page.locator("#study-settle").click();
      await waitText(".settled-caption", "Resolved");
      check(
        await page
          .locator(".dialog-stage .particle")
          .first()
          .evaluate((el) => {
            const box = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return (
              Math.abs(box.width - 40) < 0.5 &&
              Math.abs(box.height - 40) < 0.5 &&
              +cs.opacity === 1 &&
              cs.borderRadius === "28%"
            );
          }),
        `${id}: resolves to canonical square geometry`,
      );
      await page.keyboard.press("Escape");
    }
    await page.locator("[data-inspect=split]").click();
    await page.locator("#study-size").selectOption("12");
    await page.locator("#study-pause").click();
    check(
      await page
        .locator(".dialog-stage")
        .evaluate((el) =>
          el
            .getAnimations({ subtree: true })
            .every((a) => a.playState === "paused"),
        ),
      "Inspector can pause a study independently",
    );
    await page.locator("#study-pause").click();
    check(
      (await page
        .locator(".dialog-stage .loader")
        .getAttribute("data-variant")) === "breathe",
      "Multi-part motion simplifies below 16px",
    );
    await page.keyboard.press("Escape");

    for (const id of ["breathe", "shuttle", "trace"])
      await page.locator(`[data-compare="${id}"]`).check();
    await page.locator("[data-compare=orbit]").click();
    check(
      !(await page.locator("[data-compare=orbit]").isChecked()),
      "Comparison stays bounded to three studies",
    );
    await page.locator("#compare-open").click();
    check(
      (await page.locator(".compare-item").count()) === 3,
      "Side-by-side comparison renders all selections",
    );
    await page.locator("#compare-settle").click();
    await page.keyboard.press("Escape");
    check(
      !(await page.locator("#study-dialog").isVisible()),
      "Native modal dismisses with Escape",
    );
    await page.locator("[data-filter=everyday]").click();
    check(
      (await page.locator(".mechanic-card:visible").count()) === 2,
      "Motion filters show their advertised count",
    );
    await page.locator("[data-filter=all]").click();

    for (const direction of ["living", "companion", "builder"]) {
      await page.locator(`[data-choose="${direction}"]`).click();
      await page.locator("[data-scenario=network]").click();
      check(
        (await page
          .locator("#app-content .character-scene")
          .getAttribute("data-direction")) === direction,
        `${direction}: selected mascot propagates to product context`,
      );
    }
    for (const gesture of [
      "connect",
      "curious",
      "guide",
      "build",
      "acknowledge",
      "wait",
      "rest",
    ]) {
      await page.locator("#gesture").selectOption(gesture);
      check(
        (await page
          .locator(`#mascot-grid [data-gesture="${gesture}"]`)
          .count()) === 3,
        `${gesture}: demonstrated by all character directions`,
      );
    }
    for (const id of [
      "welcome",
      "project",
      "network",
      "search",
      "success",
      "slow",
      "error",
      "offline",
      "loading",
      "progress",
      "background",
    ]) {
      await page.locator(`[data-scenario="${id}"]`).click();
      check(
        (await page.locator("#app-content").innerText()).length > 25,
        `${id}: contextual specimen renders`,
      );
    }
    await page.locator("[data-scenario=project]").click();
    await page.locator("[data-context-action=created]").click();
    check(
      (await page.locator("#app-content").innerText()).includes(
        "New beginnings",
      ),
      "Create-project demo has a concrete result",
    );
    await page.locator("[data-scenario=error]").click();
    await page.locator("[data-context-action=retry]").click();
    await page.locator(".person-preview").first().waitFor();
    checks.push("Context retry recovers to ready content");
    await page.locator("[data-scenario=loading]").click();
    await page.locator("[data-context-action=discover]").click();
    check(
      (await page.locator(".skeleton-card").count()) === 0,
      "Ready content interrupts the loading specimen",
    );
    await page.locator("[data-scenario=progress]").click();
    await page.locator("[data-context-action=upload]").click();
    await waitText("#app-content", "20 of 20 demo files uploaded", 6000);
    check(
      (await page
        .locator("#app-content [role=progressbar]")
        .getAttribute("aria-valuenow")) === "20",
      "Measured contextual upload reaches its real demo total",
    );

    await run("fast");
    await waitText("#operation-result", "Already done.");
    check(
      (await page.locator("#operation-result .loader").count()) === 0,
      "120ms completion never displays a loader",
    );
    await run("normal");
    await page.locator("#operation-result .loader").waitFor();
    await waitText("#operation-result", "Everything is in place.");
    checks.push("Normal operation shows activity and resolves successfully");
    await run("failure");
    await page.locator("#operation-retry").waitFor();
    await page.locator("#operation-retry").click();
    await waitText("#operation-result", "Everything is in place.");
    checks.push("Confirmed failure exposes a working retry");
    await run("slow");
    await waitText("#operation-result", "Taking longer. Still working.", 12000);
    check(
      (await page.locator("#operation-result").innerText()).includes(
        "not a confirmed failure",
      ),
      "Ten-second delay is explained without inventing failure",
    );
    await page.locator("#operation-complete").click();
    await waitText("#operation-result", "Everything is in place.");
    checks.push("Delayed operation can complete successfully");
    await run("progress");
    await page.locator("#operation-result [role=progressbar]").waitFor();
    await waitText("#operation-result", "Everything is in place.", 7000);
    checks.push("Measured operation completes after twenty demo steps");
    await run("background");
    check(
      await page.locator("#background-content").isVisible(),
      "Background content stays present during refresh",
    );
    await waitText("#operation-result", "Everything is in place.");
    check(
      await page.locator("#background-content").isVisible(),
      "Background content remains present after refresh",
    );
    await run("offline");
    check(
      (await page.locator("#operation-clock").innerText()) === "OFFLINE",
      "Offline state explains that no request was sent",
    );
    await run("normal");
    await page
      .locator("#operation-result .loader[data-settled=true]")
      .waitFor();
    await page.locator("#operation-cancel").click();
    await page.waitForTimeout(450);
    check(
      (await page.locator("#operation-result").innerText()).includes(
        "Operation canceled.",
      ),
      "Cancel during resolution prevents obsolete success",
    );

    for (const theme of ["paper", "ink"])
      for (const accent of [
        "clay",
        "orchid",
        "forest",
        "ember",
        "rose",
        "lagoon",
      ]) {
        await page.locator("#theme").selectOption(theme);
        await page.locator("#accent").selectOption(accent);
        check(
          await page.evaluate(
            ([t, a]) =>
              document.documentElement.dataset.theme === t &&
              document.documentElement.dataset.accent === a,
            [theme, accent],
          ),
          `${theme}/${accent}: appearance applies`,
        );
      }
    await page.locator("#reduced").check();
    check(
      await page.evaluate(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      ),
      "Manual reduced motion stops decorative animation",
    );
    check(
      (await page.locator("#hero-wordmark .intro-name").innerText()) ===
        "NetworkBase",
      "Reduced motion exposes the complete readable name",
    );
    await page.locator("#reduced").uncheck();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => document.documentElement.dataset.reduced === "true",
    );
    check(
      await page.evaluate(
        () => document.documentElement.dataset.reduced === "true",
      ),
      "System reduced motion independently resolves the studio",
    );
    check(
      await page.locator("#pause-all").isDisabled(),
      "Reduced motion disables inapplicable playback control",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator("#theme").selectOption("paper");
    await page.locator("#accent").selectOption("clay");
    await page.locator("#viewport").selectOption("mobile");
    await page.locator("#zoom").check();
    check(
      (await page
        .locator("#zoom-specimen .wordmark")
        .evaluate((el) => getComputedStyle(el).fontSize)) === "40px",
      "200% specimen doubles its 20px type",
    );
    for (const width of [320, 375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${width}px: no horizontal page overflow`,
      );
    }
    await page.locator("#replay-all").click();
    await page.locator("#contexts").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    check(
      await page.evaluate(() =>
        [...document.querySelectorAll(".offscreen")]
          .flatMap((el) => el.getAnimations({ subtree: true }))
          .every((a) => a.playState !== "running"),
      ),
      "Offscreen studies remain paused after replay-all",
    );
    await page.locator("#pause-all").click();
    check(
      await page.evaluate(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      ),
      "Global pause stops all visible and offscreen motion",
    );
    await page.locator("#pause-all").click();
    check(externalRequests.length === 0, "No external runtime requests");
    check(errors.length === 0, `No browser exceptions: ${errors.join(", ")}`);

    await page.locator("#zoom").uncheck();
    await page.locator("#viewport").selectOption("desktop");
    await page.locator("[data-scenario=welcome]").click();
    await page.evaluate(() => {
      document.activeElement.blur();
      scrollTo(0, 0);
    });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(__dirname, `${engine}-desktop.png`),
      fullPage: true,
    });
    await page.screenshot({
      path: path.join(__dirname, `${engine}-cover.png`),
    });
    await page.locator("#theme").selectOption("ink");
    await page.locator("#mascots").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, `${engine}-ink.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#theme").selectOption("paper");
    await page.locator("#viewport").selectOption("mobile");
    await page.locator("[data-scenario=network]").click();
    await page.locator("#contexts").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(__dirname, `${engine}-phone.png`),
    });
    const report = {
      engine,
      passed: checks.length,
      checks,
      errors,
      externalRequests,
      checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(__dirname, `verification-${engine}.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        { engine, passed: checks.length, errors, externalRequests },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
