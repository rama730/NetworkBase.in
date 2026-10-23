/* NetworkBase motion studies. Native browser APIs; no application state or services. */
"use strict";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const root = document.documentElement;
const systemMotion = matchMedia("(prefers-reduced-motion: reduce)");
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const state = {
  reveal: "stepped",
  duration: 900,
  speed: 1,
  paused: false,
  reduced: systemMotion.matches,
  mascot: "living",
  scenario: "welcome",
  selected: new Set(),
};
let introAnimations = [],
  introFrame = 0,
  operationTimers = [],
  operationInterval = 0,
  operationStarted = 0,
  scenarioTimers = [],
  visibilityObserver;

const studies = [
  {
    id: "reveal",
    name: "Reverse reveal",
    group: "opening",
    tag: "Signature entrance",
    short: "The square introduces the name, right to left.",
    detail:
      "Your original direction in miniature. The full signature above lets you compare stepped letter reveals with a continuous wipe. Reserve this entrance for the opening moment, then leave navigation still.",
  },
  {
    id: "breathe",
    name: "Breathe",
    group: "everyday",
    tag: "Recommended · default",
    short: "A gentle change in opacity. Quietly present.",
    detail:
      "The square keeps its exact geometry while its opacity changes. This is the proposed default for compact, indeterminate waits. It also provides the small-size fallback for multi-part studies.",
  },
  {
    id: "shuttle",
    name: "Shuttle",
    group: "everyday",
    tag: "Recommended · longer waits",
    short: "A short journey out. A precise return.",
    detail:
      "The square moves along a small, bounded path. Use when a wait needs more visible activity, with enough surrounding space for the full travel. Movement never represents a percentage.",
  },
  {
    id: "trace",
    name: "Trace",
    group: "alternative",
    tag: "Alternative · larger placements",
    short: "An outline quietly finds its way around.",
    detail:
      "A fine stroke traces the rounded-square silhouette. The underlying square remains visible. Compare at larger sizes; fine outlines can disappear at small scales.",
  },
  {
    id: "turn",
    name: "Turn",
    group: "alternative",
    tag: "Alternative · compact",
    short: "A considered quarter-turn, then a pause.",
    detail:
      "A controlled quarter-turn adds activity without a new shape. The motion is a loading proposal, not a change to the resting logo. Compare its rotation against the quieter Breathe.",
  },
  {
    id: "wipe",
    name: "Wipe",
    group: "alternative",
    tag: "Alternative · compact",
    short: "A clean sweep across a familiar silhouette.",
    detail:
      "A fill passes across a faint base square. Its shape and reserved area remain constant. The wipe is indeterminate and must not be read as measured progress.",
  },
  {
    id: "split",
    name: "Split",
    group: "expressive",
    tag: "Expressive · coordination",
    short: "Four pieces move apart, then come together.",
    detail:
      "The square briefly becomes four coordinated pieces, then reunites. This explores the idea of collaboration. Below 16px, the preview falls back to Breathe for legibility.",
  },
  {
    id: "squash",
    name: "Squash",
    group: "expressive",
    tag: "Experimental · geometry exception",
    short: "A more playful study in weight and elasticity.",
    detail:
      "This deliberately deforms the mark to test a more playful personality. It sits outside the current stable-geometry brand rules and is an exploration, not a proposed default.",
  },
  {
    id: "queue",
    name: "Queue",
    group: "expressive",
    tag: "Expressive · coordinated activity",
    short: "Small squares take their turns in a shared path.",
    detail:
      "A short queue suggests several pieces of work moving through a process. These are decorative elements; the count does not imply a real task count. Resolves to one square.",
  },
  {
    id: "orbit",
    name: "Orbit",
    group: "expressive",
    tag: "Expressive · network moment",
    short: "A steady center. Connections in motion.",
    detail:
      "Two supporting squares orbit a central square. This is the most literal network metaphor. Reserve the additional movement and space for an occasional, larger brand moment.",
  },
  {
    id: "relay",
    name: "Relay",
    group: "expressive",
    tag: "Expressive · handoff",
    short: "Activity passes from one point to another.",
    detail:
      "Two squares exchange emphasis as though handing work across a connection. This is a visual metaphor, not confirmation that a server or another user has received anything.",
  },
  {
    id: "cast",
    name: "Cast",
    group: "expressive",
    tag: "Expressive · opening accent",
    short: "A small silhouette follows the square’s lead.",
    detail:
      "An offset silhouette follows a restrained diagonal motion. This tests depth within the flat identity. It needs more space than a compact control and should remain occasional.",
  },
  {
    id: "tally",
    name: "Tally",
    group: "opening",
    tag: "Opening study · assembly",
    short: "Small strokes assemble into a single whole.",
    detail:
      "Five narrow strokes build the square through a coordinated sequence. This is an opening study. It never represents a real total, percentage, or number of completed tasks.",
  },
  {
    id: "shatter",
    name: "Shatter",
    group: "opening",
    tag: "Opening study · fragmentation",
    short: "The square disperses, then finds itself again.",
    detail:
      "Nine fragments spread outward and reassemble. This is the boldest identity experiment and needs an explicit motion-rule exception before any product adoption. A still square remains the reduced-motion outcome.",
  },
];
const directions = [
  {
    id: "living",
    name: "Living square",
    label: "01 / THE CONNECTOR",
    badge: "Recommended",
    description:
      "Character through movement alone. Observant, precise, and unmistakably the NetworkBase square.",
  },
  {
    id: "companion",
    name: "Square companion",
    label: "02 / THE COMPANION",
    badge: "More expressive",
    description:
      "A minimal face at larger sizes. Warmth and attention, with the clean square retained in the official logo.",
  },
  {
    id: "builder",
    name: "Builder character",
    label: "03 / THE BUILDER",
    badge: "Storytelling",
    description:
      "Small hands, sturdy feet, and a constructive spirit. A larger character for projects and onboarding.",
  },
];
const scenarios = [
  {
    id: "welcome",
    name: "Welcome",
    title: "Welcome to your next connection.",
    body: "Find people, share what you know, and give your next idea a place to grow.",
    action: "Explore your network",
    target: "discover",
    section: "Your space",
    gesture: "connect",
    caption: "Welcome · signature entrance, then a clear next step.",
  },
  {
    id: "project",
    name: "First project",
    title: "Every good project starts somewhere.",
    body: "Bring your idea, your people, and your work into one place.",
    action: "Create a project",
    target: "created",
    section: "Projects",
    gesture: "build",
    caption:
      "First project · a constructive gesture gives purpose to an empty workspace.",
  },
  {
    id: "network",
    name: "Empty network",
    title: "Your next collaborator is out there.",
    body: "A conversation can be the beginning of something good. Find your first connection.",
    action: "Discover people",
    target: "discover",
    section: "Network",
    gesture: "connect",
    caption:
      "Empty network · connecting points support an actionable invitation.",
  },
  {
    id: "search",
    name: "No results",
    title: "No connections here. Yet.",
    body: "Try a broader skill, a different name, or clear your filters to explore again.",
    action: "Clear filters",
    target: "discover",
    section: "Search results",
    gesture: "curious",
    caption:
      "No results · curiosity without blame, followed by a useful recovery action.",
  },
  {
    id: "success",
    name: "Completed action",
    title: "You’re connected.",
    body: "Your invitation was accepted. Say hello and see what you can build together.",
    action: "View connection",
    target: "connection",
    section: "Network",
    gesture: "acknowledge",
    caption:
      "Completed action · one brief acknowledgment, then a still character.",
  },
  {
    id: "slow",
    name: "Taking longer",
    title: "Still bringing things together.",
    body: "This is taking longer than usual. Your request is still running; you can keep this view open.",
    action: "Check activity",
    target: "activity",
    section: "Project import",
    gesture: "wait",
    caption:
      "Delayed operation · a calm waiting pose and accurate copy; elapsed time is not failure.",
  },
  {
    id: "error",
    name: "Error & retry",
    title: "We couldn’t load your network.",
    body: "Your existing connections are safe. Try loading this view again.",
    action: "Try again",
    target: "retry",
    section: "Network",
    gesture: "rest",
    caption:
      "Confirmed error · the character becomes still and the retry stays available.",
  },
  {
    id: "offline",
    name: "Offline",
    title: "A little pause in the connection.",
    body: "You’re offline. Your current view is still here. Reconnect to load new updates.",
    action: "Check connection",
    target: "reconnect",
    section: "Your space",
    gesture: "rest",
    caption:
      "Offline · an interrupted connection is explained in text, without alarm.",
  },
  {
    id: "loading",
    name: "Route loading",
    section: "Network",
    caption:
      "Route loading · structure stays visible; the mascot gives way to local loading and skeletons.",
  },
  {
    id: "progress",
    name: "Real progress",
    title: "Bringing your files together.",
    body: "A simulated upload with a measurable total. The percentage below reflects the demo’s completed steps.",
    section: "Project files",
    gesture: "build",
    caption:
      "Measurable progress · a genuine demo total accompanies the brand; no invented spinner percentage.",
  },
  {
    id: "background",
    name: "Background refresh",
    section: "Network",
    caption:
      "Background refresh · existing content remains available and the header logo stays still.",
  },
];

function loader(id, size = 22) {
  const multi = [
    "split",
    "queue",
    "orbit",
    "relay",
    "tally",
    "shatter",
  ].includes(id);
  const actual = size < 16 && multi ? "breathe" : id;
  const count =
    {
      split: 4,
      queue: 3,
      orbit: 3,
      relay: 2,
      cast: 2,
      tally: 5,
      shatter: 9,
      wipe: 2,
    }[actual] || 1;
  return `<span class="loader" data-variant="${actual}" data-requested="${id}" style="--dot:${size}px" aria-hidden="true">${Array.from({ length: count }, (_, i) => `<i class="particle" style="--i:${i};--col:${i % 3};--row:${Math.floor(i / 3)}"></i>`).join("")}${actual === "trace" ? '<svg viewBox="0 0 24 24"><rect class="trace-outline" x="1" y="1" width="22" height="22" rx="6"/></svg>' : ""}${actual === "reveal" ? '<span class="mini-name">NetworkBase</span>' : ""}</span>`;
}
function character(direction, gesture = "connect") {
  return `<div class="character-scene ${direction === "builder" ? "builder" : ""}" data-direction="${direction}" data-gesture="${gesture}" aria-hidden="true"><i class="scene-line"></i><i class="scene-node"></i><i class="scene-node right"></i><i class="scene-arrow">→</i><i class="scene-block" style="--i:0"></i><i class="scene-block b2" style="--i:1"></i><i class="scene-block b3" style="--i:2"></i><div class="character"><span class="eyes"><i></i><i></i></span><i class="mouth"></i><i class="arm"></i><i class="arm right"></i><i class="feet"></i><i class="feet right"></i></div><i class="character-ground"></i></div>`;
}
function mountWordmark(el) {
  el.innerHTML =
    '<i class="intro-square"></i><span class="intro-name" aria-hidden="true">' +
    [..."NetworkBase"].map((c) => `<span>${c}</span>`).join("") +
    "</span>";
}
function cancelIntro() {
  cancelAnimationFrame(introFrame);
  introAnimations.forEach((a) => a.cancel());
  introAnimations = [];
}
function updateIntroTimeline() {
  cancelAnimationFrame(introFrame);
  const a = introAnimations[0];
  if (!a) return;
  const time = Number(a.currentTime) || 0;
  $("#intro-scrub").value = Math.min(100, (time / state.duration) * 100);
  $("#intro-time").textContent =
    `${Math.min(state.duration, Math.round(time))} ms`;
  if (a.playState === "running")
    introFrame = requestAnimationFrame(updateIntroTimeline);
}
function playIntro(scrub = null) {
  cancelIntro();
  const mark = $("#hero-wordmark"),
    square = $(".intro-square", mark),
    name = $(".intro-name", mark);
  if (state.reduced) {
    $("#intro-scrub").value = 100;
    $("#intro-time").textContent = "Still";
    return;
  }
  const duration = state.duration,
    hold = 0.12,
    end = 0.9;
  const total =
    name.getBoundingClientRect().width + parseFloat(getComputedStyle(mark).gap);
  const options = { duration, fill: "both", easing: "linear" };
  introAnimations.push(
    square.animate(
      [
        { transform: `translateX(${total}px)`, offset: 0 },
        { transform: `translateX(${total}px)`, offset: hold },
        { transform: "translateX(0)", offset: end },
        { transform: "translateX(0)", offset: 1 },
      ],
      options,
    ),
  );
  if (state.reveal === "continuous") {
    introAnimations.push(
      name.animate(
        [
          { clipPath: "inset(0 0 0 100%)", offset: 0 },
          { clipPath: "inset(0 0 0 100%)", offset: hold },
          { clipPath: "inset(0 0 0 0%)", offset: end },
          { clipPath: "inset(0 0 0 0%)", offset: 1 },
        ],
        options,
      ),
    );
  } else {
    const bounds = name.getBoundingClientRect();
    $$(".intro-name span", mark).forEach((letter) => {
      const pos = letter.getBoundingClientRect();
      const offset =
        hold +
        (end - hold) * (1 - (pos.left - bounds.left + pos.width * 0.5) / total);
      introAnimations.push(
        letter.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: Math.max(0, offset - 0.001) },
            { opacity: 1, offset },
            { opacity: 1, offset: 1 },
          ],
          options,
        ),
      );
    });
  }
  introAnimations.forEach((a) => {
    a.playbackRate = state.speed;
    if (scrub !== null) {
      a.pause();
      a.currentTime = (duration * scrub) / 100;
    } else if (state.paused || document.hidden) {
      a.pause();
    }
  });
  updateIntroTimeline();
}
function announce(text) {
  $("#announcement").textContent = text;
}
function renderStudies() {
  $("#mechanics-grid").innerHTML = studies
    .map(
      (s, i) =>
        `<article class="mechanic-card" data-study="${s.id}" data-group="${s.group}"><div class="card-top"><span>${String(i + 1).padStart(2, "0")} / MOTION</span><label><input type="checkbox" data-compare="${s.id}" aria-label="Compare ${s.name}"><span>Compare</span></label></div><div class="mechanic-stage">${loader(s.id)}</div><footer><div class="mechanic-title"><h3>${s.name}</h3><button class="card-inspect" data-inspect="${s.id}" aria-label="Inspect ${s.name}">↗</button></div><p class="card-description">${s.short}</p><span class="mechanic-tag">${s.tag}</span></footer></article>`,
    )
    .join("");
}
function renderMascots() {
  $$("#mascot-grid .mascot-card").forEach((el) =>
    visibilityObserver?.unobserve(el),
  );
  $("#mascot-grid").innerHTML = directions
    .map(
      (d) =>
        `<article class="mascot-card ${d.id === state.mascot ? "active" : ""}" data-mascot="${d.id}"><div class="mascot-card-header"><span>${d.label}</span><span>${d.badge}</span></div><div class="mascot-stage">${character(d.id, $("#gesture").value)}</div><div class="mascot-card-text"><h3>${d.name}</h3><p>${d.description}</p><button class="choose-mascot" data-choose="${d.id}" aria-pressed="${d.id === state.mascot}"><span>${d.id === state.mascot ? "Selected for product previews" : "Use in product previews"}</span><span>${d.id === state.mascot ? "✓" : "→"}</span></button></div></article>`,
    )
    .join("");
  $$("#mascot-grid .mascot-card").forEach((el) =>
    visibilityObserver?.observe(el),
  );
}
function restartCSS(el) {
  const animations = el.getAnimations({ subtree: true });
  animations.forEach((a) => {
    if (a instanceof CSSAnimation) {
      a.currentTime = 0;
    } else if (!state.paused && !state.reduced && !document.hidden) {
      a.currentTime = 0;
      a.play();
    }
  });
}
function setGesture(value) {
  $("#gesture").value = value;
  $$("#mascot-grid .character-scene").forEach(
    (el) => (el.dataset.gesture = value),
  );
  $$(".territory-buttons button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.territory === value)),
  );
  restartCSS($("#mascot-grid"));
}
function clearScenarioTimers() {
  scenarioTimers.forEach(clearTimeout);
  scenarioTimers = [];
}
function freezeAcknowledgment(scope) {
  if (state.reduced) return;
  const body = $(".character", scope);
  if (!body) return;
  body.style.animationIterationCount = "1";
  const ms = parseFloat(getComputedStyle(body).animationDuration) * 1000;
  scenarioTimers.push(
    setTimeout(() => {
      const scene = $(".character-scene", scope);
      if (scene) scene.dataset.gesture = "rest";
    }, ms),
  );
}
function showScenario(id) {
  clearScenarioTimers();
  state.scenario = id;
  const s = scenarios.find((x) => x.id === id) || scenarios[0];
  $$("#scenario-tabs button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.scenario === id)),
  );
  $("#scenario-caption").textContent = s.caption;
  $("#nav-network").classList.toggle(
    "selected",
    ["network", "search", "success", "error", "loading", "background"].includes(
      id,
    ),
  );
  $("#nav-projects").classList.toggle(
    "selected",
    ["project", "progress", "slow"].includes(id),
  );
  const content = $("#app-content");
  const heading = `<div class="app-page-heading"><h3>${s.section}</h3><span>YOUR NETWORK. YOUR NEXT IDEA.</span></div>`;
  if (id === "loading") {
    content.innerHTML =
      heading +
      `<div class="context-loading" role="status">${loader("breathe", 14)}<span>Finding your connections…</span></div><div class="skeleton-row" aria-hidden="true">${Array.from({ length: 3 }, () => '<div class="skeleton-card"><div class="skeleton-avatar"></div><div class="skeleton-line"></div><div class="skeleton-line" style="width:65%"></div></div>').join("")}</div><button class="text-button" data-context-action="discover">Simulate ready content →</button>`;
  } else if (id === "background") {
    content.innerHTML =
      heading +
      peopleHTML() +
      `<div class="context-loading" role="status">${loader("breathe", 12)}<span>Checking for new connections… your current view stays available.</span></div><button class="text-button" data-context-action="refreshed">Finish refresh →</button>`;
  } else {
    const scene =
      id === "welcome"
        ? '<div class="intro-mark context-intro" role="img" aria-label="NetworkBase"></div>'
        : character(state.mascot, s.gesture);
    content.innerHTML =
      heading +
      `<div class="empty-state">${scene}<h4>${s.title}</h4><p>${s.body}</p>${id === "progress" ? '<div class="progress-shell" aria-live="off"><div class="progress-label"><span>Project assets · 0 of 20 files</span><span>0%</span></div><div class="progress-track" role="progressbar" aria-label="Simulated file upload" aria-valuemin="0" aria-valuemax="20" aria-valuenow="0"><div class="progress-fill"></div></div></div><button class="button dark" data-context-action="upload">Start demo upload →</button>' : `<button class="button dark" data-context-action="${s.target}">${s.action} →</button>`}${id === "offline" ? '<div class="recovery-note">Offline · changes requiring a connection are unavailable.</div>' : ""}</div>`;
    if (id === "welcome") {
      const mark = $(".context-intro", content);
      mountWordmark(mark);
      if (!state.reduced) {
        const square = $(".intro-square", mark),
          name = $(".intro-name", mark),
          w =
            name.getBoundingClientRect().width +
            parseFloat(getComputedStyle(mark).gap);
        square.animate(
          [{ transform: `translateX(${w}px)` }, { transform: "translateX(0)" }],
          { duration: 900, easing: "ease-in-out" },
        );
        name.animate(
          [{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0)" }],
          { duration: 900, easing: "ease-in-out" },
        );
        mark.getAnimations({ subtree: true }).forEach((a) => {
          a.playbackRate = state.speed;
          if (state.paused || document.hidden) a.pause();
        });
      }
    }
    if (id === "success") freezeAcknowledgment(content);
    if (id === "offline") {
      const scene = $(".character-scene", content);
      scene.insertAdjacentHTML(
        "beforeend",
        '<span style="position:absolute;bottom:8px;font-size:10px;color:var(--muted)">· · · / · · ·</span>',
      );
    }
  }
}
function peopleHTML() {
  return `<div class="people-preview">${[
    ["SL", "Sofia Lin", "Product designer"],
    ["RK", "Ravi Kumar", "Frontend engineer"],
    ["AO", "Ada Okonjo", "Creative developer"],
  ]
    .map(
      ([initials, name, role]) =>
        `<div class="person-preview"><span class="avatar">${initials}</span><b>${name}</b><p>${role}</p></div>`,
    )
    .join("")}</div>`;
}
function contextAction(action) {
  const content = $("#app-content");
  if (["discover", "connection", "refreshed", "created"].includes(action)) {
    clearScenarioTimers();
    content.innerHTML = `<div class="app-page-heading"><h3>${action === "created" ? "Your first project" : "Your network"}</h3><span>READY TO CONNECT</span></div>${action === "created" ? '<div class="background-content" style="margin:25px 0"><span class="project-glyph">N</span><div><b>New beginnings</b><span>Your demo project is ready.</span></div><span class="pill neutral">Draft</span></div>' : peopleHTML()}<div class="context-loading" role="status"><span class="tiny-square"></span>${action === "refreshed" ? "Up to date. Your existing view stayed available." : action === "created" ? "Demo project created. No real data was changed." : "A preview of the people you could meet."}</div><button class="text-button" data-context-action="reset">Return to scenario ↻</button>`;
  } else if (action === "retry" || action === "reconnect") {
    content.innerHTML = `<div class="context-loading" role="status">${loader("shuttle", 16)}<span>${action === "retry" ? "Trying again…" : "Checking the demo connection…"}</span></div>`;
    scenarioTimers.push(setTimeout(() => contextAction("discover"), 1200));
  } else if (action === "activity") {
    $(".empty-state p", content).textContent =
      "Import is still running. The delay does not indicate failure. You can leave this view and check activity later.";
    $("[data-context-action]", content).textContent = "Continue waiting";
  } else if (action === "reset") {
    showScenario(state.scenario);
  } else if (action === "upload") {
    const button = $("[data-context-action=upload]", content);
    button.disabled = true;
    button.textContent = "Uploading…";
    let step = 0;
    const advance = () => {
      step++;
      const track = $("[role=progressbar]", content);
      if (!track) return;
      track.setAttribute("aria-valuenow", step);
      $(".progress-fill", content).style.width = `${step * 5}%`;
      $$(".progress-label span", content)[0].textContent =
        `Project assets · ${step} of 20 files`;
      $$(".progress-label span", content)[1].textContent = `${step * 5}%`;
      if (step < 20) scenarioTimers.push(setTimeout(advance, 200));
      else {
        button.disabled = false;
        button.textContent = "Replay upload ↻";
        $(".empty-state h4", content).textContent = "Your files are together.";
        $(".empty-state p", content).textContent =
          "20 of 20 demo files uploaded successfully. No real files were transferred.";
        const scene = $(".character-scene", content);
        scene.dataset.gesture = "acknowledge";
        freezeAcknowledgment(content);
        announce("Demo upload complete. 20 files.");
      }
    };
    scenarioTimers.push(setTimeout(advance, 200));
  }
}

async function settleLoader(el) {
  if (!el) return;
  const pieces = $$(".particle", el);
  const frames = pieces.map((p) => {
    const cs = getComputedStyle(p);
    return {
      transform: cs.transform,
      opacity: cs.opacity,
      width: cs.width,
      height: cs.height,
      left: cs.left,
      top: cs.top,
      borderRadius: cs.borderRadius,
    };
  });
  el.dataset.settled = "true";
  const promises = pieces.map((p, i) => {
    p.style.animation = "none";
    const end = {
      transform: "translate(0, 0) rotate(0deg)",
      opacity: i === 0 ? 1 : 0,
      width: `${parseFloat(getComputedStyle(el).getPropertyValue("--dot"))}px`,
      height: `${parseFloat(getComputedStyle(el).getPropertyValue("--dot"))}px`,
      left: "0px",
      top: "0px",
      borderRadius: "28%",
    };
    if (state.reduced) {
      Object.assign(p.style, end);
      return Promise.resolve();
    }
    const a = p.animate([frames[i], end], {
      duration: 260,
      easing: "cubic-bezier(.2,.8,.3,1)",
      fill: "forwards",
    });
    a.playbackRate = state.speed;
    if (state.paused || document.hidden) a.pause();
    return a.finished.catch(() => {});
  });
  $$("svg,.mini-name", el).forEach((p) => {
    if (state.reduced) p.style.opacity = 0;
    else {
      const a = p.animate(
        [{ opacity: getComputedStyle(p).opacity }, { opacity: 0 }],
        {
          duration: 180,
          fill: "forwards",
        },
      );
      a.playbackRate = state.speed;
      if (state.paused || document.hidden) a.pause();
    }
  });
  await Promise.all(promises);
}
function openStudy(id) {
  const s = studies.find((x) => x.id === id);
  if (!s) return;
  $("#dialog-title").textContent = s.name;
  $("#dialog-eyebrow").textContent = s.tag.toUpperCase();
  $("#dialog-body").innerHTML =
    `<div class="dialog-stage grid-ground">${loader(id, 40)}<span class="settled-caption">Indeterminate activity · no implied percentage</span></div><div class="dialog-details"><p>${s.detail}</p><div class="dialog-controls"><button class="button dark" id="study-settle">Resolve to a still square</button><button class="button quiet" id="study-loop">Replay motion ↻</button><button class="button quiet" id="study-pause" aria-pressed="false">Pause study</button><label for="study-size">Visible square</label><select id="study-size"><option value="12">12px</option><option value="16">16px</option><option value="24">24px</option><option value="40" selected>40px</option><option value="64">64px</option></select></div></div>`;
  const pauseButton = $("#study-pause");
  pauseButton.disabled = state.reduced || state.paused;
  pauseButton.onclick = () => {
    const paused = pauseButton.getAttribute("aria-pressed") !== "true";
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.textContent = paused ? "Resume study" : "Pause study";
    $(".dialog-stage").dataset.localPaused = String(paused);
  };
  const replace = () => {
    const stage = $(".dialog-stage");
    stage.innerHTML =
      loader(id, Number($("#study-size").value)) +
      '<span class="settled-caption">' +
      (Number($("#study-size").value) < 16 &&
      ["split", "queue", "orbit", "relay", "tally", "shatter"].includes(id)
        ? "Small-size fallback · Breathe"
        : "Indeterminate activity · no implied percentage") +
      "</span>";
    $("#study-settle").disabled = false;
    pauseButton.setAttribute("aria-pressed", "false");
    pauseButton.textContent = "Pause study";
    pauseButton.disabled = state.reduced || state.paused;
    stage.dataset.localPaused = "false";
  };
  $("#study-loop").onclick = replace;
  $("#study-size").onchange = replace;
  $("#study-settle").onclick = async () => {
    $("#study-settle").disabled = true;
    $(".dialog-stage").dataset.localPaused = "false";
    pauseButton.disabled = true;
    await settleLoader($(".dialog-stage .loader"));
    const caption = $(".settled-caption");
    if (caption)
      caption.textContent = "Resolved · one still NetworkBase square";
  };
  $("#study-dialog").showModal();
}
function openCompare() {
  const selected = studies.filter((s) => state.selected.has(s.id));
  if (selected.length < 2) return;
  $("#dialog-title").textContent = "A closer comparison.";
  $("#dialog-eyebrow").textContent = "SIDE BY SIDE / SAME SCALE, SAME PACE";
  $("#dialog-body").innerHTML =
    `<div class="compare-grid" style="grid-template-columns:repeat(${selected.length},minmax(0,1fr))">${selected.map((s) => `<article class="compare-item"><div class="dialog-stage grid-ground">${loader(s.id, 32)}</div><h3>${s.name}</h3><p>${s.short}</p></article>`).join("")}</div><div class="compare-controls"><button id="compare-settle" class="button dark">Resolve all</button><button id="compare-replay" class="button quiet">Replay together ↻</button><button id="compare-pause" class="button quiet" aria-pressed="false">Pause comparison</button></div>`;
  const pauseButton = $("#compare-pause");
  pauseButton.disabled = state.reduced || state.paused;
  pauseButton.onclick = () => {
    const paused = pauseButton.getAttribute("aria-pressed") !== "true";
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.textContent = paused ? "Resume comparison" : "Pause comparison";
    $(".compare-grid").dataset.localPaused = String(paused);
  };
  $("#compare-settle").onclick = () => {
    $(".compare-grid").dataset.localPaused = "false";
    pauseButton.disabled = true;
    $$("#dialog-body .loader").forEach(settleLoader);
    $("#compare-settle").disabled = true;
  };
  $("#compare-replay").onclick = () => {
    $$("#dialog-body .compare-item").forEach((el, i) => {
      $(".dialog-stage", el).innerHTML = loader(selected[i].id, 32);
    });
    $("#compare-settle").disabled = false;
    $(".compare-grid").dataset.localPaused = "false";
    pauseButton.setAttribute("aria-pressed", "false");
    pauseButton.textContent = "Pause comparison";
    pauseButton.disabled = state.reduced || state.paused;
    restartCSS($("#dialog-body"));
  };
  $("#study-dialog").showModal();
  restartCSS($("#dialog-body"));
}
function clearOperation() {
  operationTimers.forEach(clearTimeout);
  operationTimers = [];
  clearInterval(operationInterval);
  operationInterval = 0;
}
function operationMessage(title, body, visual = "") {
  $("#operation-result").innerHTML = `${visual}<h4>${title}</h4><p>${body}</p>`;
}
function operationFinish(kind) {
  clearOperation();
  $("#operation-cancel").disabled = true;
  $("#operation-run").disabled = false;
  $("#operation-clock").textContent =
    `${((performance.now() - operationStarted) / 1000).toFixed(1)}s · ${kind === "failure" ? "FAILED" : "COMPLETE"}`;
  if (kind === "failure") {
    operationMessage(
      "We couldn’t finish this request.",
      "This is a simulated error. Your current content is safe. Try again when you’re ready.",
      character(state.mascot, "rest"),
    );
    $("#operation-result").insertAdjacentHTML(
      "beforeend",
      '<button class="button dark" id="operation-retry">Try again →</button>',
    );
    $("#operation-retry").onclick = () => runOperation("normal");
  } else {
    operationMessage(
      kind === "fast" ? "Already done." : "Everything is in place.",
      kind === "fast"
        ? "Completed in 120ms. The loading indicator never appeared."
        : kind === "background"
          ? "Refresh complete. Existing content remained available throughout."
          : "The operation completed. The active indicator resolved before returning to the resting identity.",
      character(state.mascot, "acknowledge"),
    );
    const body = $("#operation-result .character");
    if (body) body.style.animationIterationCount = "1";
  }
}
function runOperation(override) {
  clearOperation();
  operationStarted = performance.now();
  const kind = override || $("#operation-outcome").value;
  const mechanic = $("#operation-mechanic").value;
  $("#operation-run").disabled = true;
  $("#operation-cancel").disabled = false;
  $("#background-content").hidden = kind !== "background";
  $("#operation-clock").textContent = "REQUEST STARTED";
  if (kind === "offline") {
    operationMessage(
      "You’re offline.",
      "No request was sent in this simulation. Reconnect to continue; your current content is still available.",
      character(state.mascot, "rest"),
    );
    $("#operation-run").disabled = false;
    $("#operation-cancel").disabled = true;
    $("#operation-clock").textContent = "OFFLINE";
    return;
  }
  operationMessage("Request started.", "Preparing your demo operation.");
  if (kind === "fast") {
    operationTimers.push(setTimeout(() => operationFinish("fast"), 120));
    return;
  }
  operationTimers.push(
    setTimeout(() => {
      operationMessage(
        kind === "background"
          ? "Checking for updates…"
          : kind === "progress"
            ? "Bringing your files together…"
            : "Bringing things together…",
        kind === "progress"
          ? "A measured demo: 20 files, one completed step at a time."
          : kind === "background"
            ? "Keep working. Your existing project stays available below."
            : "This is an indeterminate wait. The animation does not represent a percentage.",
        loader(mechanic),
      );
      if (kind === "progress") {
        $("#operation-result").insertAdjacentHTML(
          "beforeend",
          '<div class="progress-shell" aria-live="off"><div class="progress-label"><span>0 of 20 demo files</span><span>0%</span></div><div class="progress-track" role="progressbar" aria-label="Demo file transfer" aria-valuemin="0" aria-valuemax="20" aria-valuenow="0"><div class="progress-fill"></div></div></div>',
        );
      }
    }, 300),
  );
  let step = 0;
  operationInterval = setInterval(() => {
    const elapsed = (performance.now() - operationStarted) / 1000;
    $("#operation-clock").textContent = `${elapsed.toFixed(1)}s · WORKING`;
    if (kind === "progress" && elapsed >= 0.4) {
      step = Math.min(20, step + 1);
      const track = $("#operation-result [role=progressbar]");
      if (track) {
        track.setAttribute("aria-valuenow", step);
        $("#operation-result .progress-fill").style.width = `${step * 5}%`;
        $$("#operation-result .progress-label span")[0].textContent =
          `${step} of 20 demo files`;
        $$("#operation-result .progress-label span")[1].textContent =
          `${step * 5}%`;
      }
      if (step === 20) {
        clearInterval(operationInterval);
        finishWithSettle(kind);
      }
    }
  }, 200);
  if (kind === "slow") {
    operationTimers.push(
      setTimeout(() => {
        clearInterval(operationInterval);
        const active = $("#operation-result .loader");
        settleLoader(active);
        $("#operation-result h4").textContent = "Taking longer. Still working.";
        $("#operation-result p").textContent =
          "Ten seconds have passed. This is a delay, not a confirmed failure. Continue waiting, complete the demo, or cancel.";
        $("#operation-clock").textContent = "10.0s · DELAYED";
        $("#operation-result").insertAdjacentHTML(
          "beforeend",
          '<button id="operation-complete" class="button quiet">Simulate successful completion →</button>',
        );
        $("#operation-complete").onclick = () => finishWithSettle("slow");
      }, 10000),
    );
  } else if (kind !== "progress") {
    operationTimers.push(
      setTimeout(
        () => finishWithSettle(kind === "failure" ? "failure" : kind),
        kind === "failure" ? 1400 : 1600,
      ),
    );
  }
}
async function finishWithSettle(kind) {
  // A run token prevents a canceled/replaced demo from completing an obsolete transition.
  const started = operationStarted;
  clearOperation();
  await settleLoader($("#operation-result .loader"));
  if (started === operationStarted) operationFinish(kind);
}
function syncMotion() {
  state.reduced = $("#reduced").checked || systemMotion.matches;
  root.dataset.reduced = String(state.reduced);
  root.dataset.paused = String(state.paused || document.hidden);
  $("#system-motion").hidden = !systemMotion.matches;
  $("#pause-all").setAttribute("aria-pressed", String(state.paused));
  $("#pause-all").innerHTML = state.paused
    ? "▶ Resume motion"
    : '<span aria-hidden="true">Ⅱ</span> Pause motion';
  $("#pause-all").disabled = state.reduced;
  $("#intro-scrub").disabled = state.reduced;
  if (state.reduced) {
    cancelIntro();
    $("#intro-scrub").value = 100;
    $("#intro-time").textContent = "Still";
  }
  document.getAnimations().forEach((a) => {
    if (a instanceof CSSAnimation) return;
    if (state.reduced) {
      a.cancel();
      return;
    }
    if (state.paused || document.hidden) {
      if (a.playState === "running") a.pause();
    } else if (
      a.playState === "paused" &&
      !$("#intro-scrub").matches(":active")
    )
      a.play();
  });
}
function applyTheme() {
  root.dataset.theme =
    $("#theme").value === "system"
      ? systemTheme.matches
        ? "ink"
        : "paper"
      : $("#theme").value;
}

renderStudies();
renderMascots();
mountWordmark($("#hero-wordmark"));
$("#scenario-tabs").innerHTML = scenarios
  .map(
    (s) =>
      `<button data-scenario="${s.id}" aria-pressed="${s.id === state.scenario}">${s.name}</button>`,
  )
  .join("");
$("#size-specimens").innerHTML = [12, 16, 24, 48]
  .map(
    (size) =>
      `<div>${loader("split", size)}<span>${size}px${size < 16 ? " · Breathe" : ""}</span></div>`,
  )
  .join("");
operationMessage(
  "Ready when you are.",
  "Choose an outcome and run the simulation. You can cancel any operation.",
  character("living", "rest"),
);
showScenario("welcome");
syncMotion();

$("#theme").onchange = applyTheme;
systemTheme.addEventListener("change", applyTheme);
$("#accent").onchange = (e) => (root.dataset.accent = e.target.value);
$("#speed").onchange = (e) => {
  state.speed = Number(e.target.value);
  root.style.setProperty("--cycle", `${1.8 / state.speed}s`);
  document
    .getAnimations()
    .filter((a) => !(a instanceof CSSAnimation))
    .forEach((a) => a.updatePlaybackRate(state.speed));
};
$("#reduced").onchange = () => {
  syncMotion();
  if (!state.reduced) {
    playIntro();
    restartCSS(document.body);
  }
};
systemMotion.addEventListener("change", () => {
  syncMotion();
  if (!state.reduced) playIntro();
});
$("#pause-all").onclick = () => {
  state.paused = !state.paused;
  syncMotion();
  updateIntroTimeline();
};
$("#replay-all").onclick = () => {
  state.paused = false;
  syncMotion();
  playIntro();
  restartCSS(document.body);
  showScenario(state.scenario);
};
$("#intro-replay").onclick = () => playIntro();
$("#intro-scrub").oninput = (e) => playIntro(Number(e.target.value));
$("#intro-duration").oninput = (e) => {
  state.duration = Number(e.target.value);
  $("#duration-label").textContent = `${state.duration} ms`;
  playIntro();
};
$$("[data-reveal]").forEach(
  (button) =>
    (button.onclick = () => {
      state.reveal = button.dataset.reveal;
      $$("[data-reveal]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === button)),
      );
      $("#intro-mode-label").textContent =
        state.reveal === "stepped"
          ? "01A · STEPPED REVEAL"
          : "01B · CONTINUOUS REVEAL";
      $("#reveal-description").textContent =
        state.reveal === "stepped"
          ? "Individual letters. One coordinated sweep."
          : "A clean boundary. One continuous reveal.";
      playIntro();
    }),
);
$$("[data-filter]").forEach(
  (button) =>
    (button.onclick = () => {
      $$("[data-filter]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === button)),
      );
      $$(".mechanic-card").forEach(
        (card) =>
          (card.hidden =
            button.dataset.filter !== "all" &&
            card.dataset.group !== button.dataset.filter),
      );
    }),
);
$("#mechanics-grid").onclick = (e) => {
  const button = e.target.closest("[data-inspect]");
  if (button) openStudy(button.dataset.inspect);
};
$("#mechanics-grid").onchange = (e) => {
  const id = e.target.dataset.compare;
  if (!id) return;
  if (e.target.checked && state.selected.size >= 3) {
    e.target.checked = false;
    announce("Choose up to three studies to compare.");
    return;
  }
  if (e.target.checked) state.selected.add(id);
  else state.selected.delete(id);
  $("#compare-count").textContent = `${state.selected.size}/3`;
  $("#compare-open").disabled = state.selected.size < 2;
};
$("#compare-open").onclick = openCompare;
$("#dialog-close").onclick = () => $("#study-dialog").close();
$("#study-dialog").onclick = (e) => {
  if (e.target === $("#study-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
};
$("#study-dialog").addEventListener("close", () =>
  $("#dialog-body").replaceChildren(),
);
$("#gesture").onchange = (e) => setGesture(e.target.value);
$("#gesture-replay").onclick = () => restartCSS($("#mascot-grid"));
$$("[data-territory]").forEach(
  (b) => (b.onclick = () => setGesture(b.dataset.territory)),
);
$("#mascot-grid").onclick = (e) => {
  const b = e.target.closest("[data-choose]");
  if (!b) return;
  state.mascot = b.dataset.choose;
  $("#context-mascot").value = state.mascot;
  renderMascots();
  showScenario(state.scenario);
  announce(
    `${directions.find((d) => d.id === state.mascot).name} selected for product previews.`,
  );
};
$("#context-mascot").onchange = (e) => {
  state.mascot = e.target.value;
  renderMascots();
  showScenario(state.scenario);
};
$("#viewport").onchange = (e) =>
  $("#application").classList.toggle("mobile", e.target.value === "mobile");
$("#scenario-tabs").onclick = (e) => {
  const b = e.target.closest("[data-scenario]");
  if (b) showScenario(b.dataset.scenario);
};
$("#app-content").onclick = (e) => {
  const b = e.target.closest("[data-context-action]");
  if (b) contextAction(b.dataset.contextAction);
};
$("#context-replay").onclick = () => showScenario(state.scenario);
$("#operation-run").onclick = () => runOperation();
$("#operation-cancel").onclick = () => {
  clearOperation();
  operationStarted = performance.now();
  $("#operation-cancel").disabled = true;
  $("#operation-run").disabled = false;
  $("#operation-clock").textContent = "CANCELED";
  operationMessage(
    "Operation canceled.",
    "The demo has stopped. Your existing content remains available.",
    character(state.mascot, "rest"),
  );
};
$("#zoom").onchange = (e) =>
  $("#zoom-specimen").classList.toggle("zoomed", e.target.checked);
document.addEventListener("visibilitychange", syncMotion);
visibilityObserver = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) =>
      entry.target.classList.toggle("offscreen", !entry.isIntersecting),
    ),
  { rootMargin: "80px" },
);
$$(
  ".mechanic-card,.mascot-card,.size-specimens,.application,.operation-panel",
).forEach((el) => visibilityObserver.observe(el));
document.fonts.ready.then(() => {
  showScenario(state.scenario);
  playIntro();
});
