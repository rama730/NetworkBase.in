// Home page behaviour (prototype U69rCV4KB2N8BomkYUZzKL v3). The markup is complete without it; this only adds motion
// and interaction, and every piece stops with the cleanup it returns.
import { attachGridTrail, isLightHex, randomColor, type TrailPreset } from "@/lib/grid-trail";
import { COPY_FAILED, copyText } from "@/lib/clipboard";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>-_=+*#";
const SECTIONS: [id: string, label: string][] = [["start", "Start"], ["how", "How it works"], ["people", "People"], ["workspace", "Workspace"], ["classes", "Classes"], ["terminal", "Terminal"], ["get-going", "Get going"], ["join", "Join"]];
// Real skill names from the catalog (the same ones the example profiles use)
const SKILLS = ["React", "TypeScript", "Figma", "Python", "SQL", "Flutter", "Swift", "Firebase", "Design systems", "UX research", "Accessibility testing", "Apache Airflow"];
const DWELL = 5000;

export function setupHome(root: HTMLElement) {
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = matchMedia("(hover: none)").matches;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const cleanups: (() => void)[] = [];
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const wait = (ms: number) => new Promise<void>((r) => later(r, ms));
  const on = <K extends keyof HTMLElementEventMap | "hashchange">(el: HTMLElement | Window | null, type: K, fn: (e: K extends keyof HTMLElementEventMap ? HTMLElementEventMap[K] : Event) => void) => {
    if (!el) return;
    el.addEventListener(type, fn as EventListener);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener));
  };
  const observe = (fn: IntersectionObserverCallback, targets: (Element | null)[], options?: IntersectionObserverInit) => {
    const io = new IntersectionObserver(fn, options);
    targets.forEach((t) => t && io.observe(t));
    cleanups.push(() => io.disconnect());
    return io;
  };

  // ---- decoding mono labels
  const decode = (el: HTMLElement) => {
    const final = el.dataset.text || el.textContent || ""; el.dataset.text = final;
    if (!motion) { el.textContent = final; return; }
    const total = 22; let frame = 0;
    const tick = () => {
      const shown = Math.floor((frame / total) * final.length);
      el.textContent = [...final].map((ch, i) => i < shown || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join("");
      if (frame++ < total) later(tick, 38); else el.textContent = final;
    };
    tick();
  };
  const heroEyebrow = $("nbh-hero-eyebrow");
  if (heroEyebrow && performance.now() < 2500) decode(heroEyebrow); // only while the page is still opening

  // ---- below the fold reveals once; anything already on screen is shown at once, so nothing blinks
  const reveals = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
  reveals.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight) el.classList.add("in"); });
  if (motion) root.classList.add("motion");
  const seen = observe((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      el.classList.add("in");
      el.querySelectorAll<HTMLElement>("[data-decode]").forEach(decode);
      seen.unobserve(el);
    }
  }, reveals.filter((el) => !el.classList.contains("in")), { threshold: 0.15 });

  // ---- wordmark: lean away from the pointer; a click makes the orange cursor hop back and retype
  const wm = $("nbh-wordmark"), cursor = $("nbh-wm-cursor");
  if (wm && cursor) {
    const letters = [...wm.querySelectorAll<HTMLElement>(".wm-letter")];
    let typing = false;
    const ready = () => wm.classList.add("js-ready");
    const pending = cursor.getAnimations();
    if (pending[0]) pending[0].finished.then(ready, ready); else ready();
    const moveCursor = (before: Element | null, hop = false) => {
      const a = cursor.getBoundingClientRect();
      wm.insertBefore(cursor, before);
      const dx = a.left - cursor.getBoundingClientRect().left;
      if (hop && Math.abs(dx) > 2) cursor.animate([{ transform: `translate(${dx}px, 0)` }, { transform: `translate(${dx / 2}px, -45%)` }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(.16,1,.3,1)" });
    };
    const retype = async () => {
      if (typing || !motion || !wm.classList.contains("js-ready")) return;
      typing = true;
      letters.forEach((s) => { s.style.transform = ""; s.classList.add("on"); });
      wm.classList.add("js-typing", "reset");
      cursor.classList.remove("done");
      letters.forEach((s) => s.classList.remove("on"));
      moveCursor(letters[0] ?? null, true);
      await wait(560);
      wm.classList.remove("reset");
      for (let k = 0; k < letters.length; k++) { letters[k]!.classList.add("on"); moveCursor(letters[k + 1] ?? null); await wait(55); }
      await wait(60);
      cursor.classList.add("done");
      typing = false;
    };
    on(wm, "click", retype);
    if (motion && !touch) {
      on(wm, "pointermove", (e) => {
        if (typing || !wm.classList.contains("js-ready")) return;
        for (const s of letters) {
          const r = s.getBoundingClientRect(), d = e.clientX - (r.left + r.width / 2), near = Math.max(0, 1 - Math.abs(d) / 240);
          s.style.transform = near ? `translateY(${(-near * 7).toFixed(1)}%) rotate(${(-Math.sign(d) * near * 9).toFixed(1)}deg)` : "";
        }
      });
      on(wm, "pointerleave", () => letters.forEach((s) => { s.style.transform = ""; }));
    }
  }

  // ---- nav: call to action after the hero, section counter, menu; phone bar
  const nav = $("nbh-nav"), mbar = $("nbh-mbar"), menu = $("nbh-menu"), menuBtn = $<HTMLButtonElement>("nbh-menu-btn");
  if (!motion) nav?.classList.add("no-motion");
  let pastHero = false, finalSeen = false;
  const updateMbar = () => mbar?.classList.toggle("show", pastHero && !finalSeen && !!menu?.hidden);
  observe(([e]) => { pastHero = !e!.isIntersecting && e!.boundingClientRect.top < 0; nav?.classList.toggle("scrolled", pastHero); updateMbar(); }, [$("nbh-hero-ctas")]);
  observe(([e]) => { finalSeen = e!.isIntersecting; updateMbar(); }, [$("join")], { threshold: 0.2 });
  const navLinks = [...root.querySelectorAll<HTMLAnchorElement>(".nav-links a")];
  const navN = $("nbh-nav-n"), navSec = $("nbh-nav-sec");
  observe((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      navLinks.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + e.target.id)));
      const k = SECTIONS.findIndex(([id]) => id === e.target.id);
      if (k < 0 || !navN || !navSec || navSec.dataset.text === SECTIONS[k]![1]) continue;
      navN.textContent = String(k + 1).padStart(2, "0");
      navSec.dataset.text = SECTIONS[k]![1]; decode(navSec);
    }
  }, SECTIONS.map(([id]) => $(id)), { rootMargin: "-45% 0px -50% 0px" });
  const setMenu = (open: boolean) => { if (!menu || !menuBtn) return; menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); menuBtn.textContent = open ? "Close" : "Menu"; updateMbar(); };
  on(menuBtn, "click", () => setMenu(!!menu?.hidden));
  on(menu, "click", (e) => { if ((e.target as Element).closest("a")) setMenu(false); });

  // ---- LOCKED (18 Nov 2026): the pixel people band. Drift, lift near the pointer, click a figure to say hi.
  const band = $("nbh-band"), cv = $<HTMLCanvasElement>("nbh-band-canvas");
  const bandApi = band && cv ? pixelBand(band, cv, motion, observe, on, later) : null;
  if (bandApi) { cleanups.push(bandApi.stop); bandApi.wipe(); }

  // ---- workspace tour: tabs, auto-advance while visible, keys, swipe, deep links (#workspace-<tool>)
  const play = $("nbh-play"), stage = $("nbh-stage");
  if (play && stage) {
    const tabs = [...play.querySelectorAll<HTMLButtonElement>(".pitem")];
    const keys = tabs.map((t) => t.dataset.key!);
    const colors = tabs.map((t) => t.style.getPropertyValue("--c"));
    let active = 0, cycle = 0, paused = false, pinned = false, inView = false;
    const show = (i: number, user = false) => {
      active = (i + tabs.length) % tabs.length;
      const key = keys[active]!, color = colors[active]!, light = !isLightHex(color);
      tabs.forEach((t, k) => {
        t.setAttribute("aria-selected", String(k === active)); t.tabIndex = k === active ? 0 : -1;
        const pr = t.querySelector<HTMLElement>(".prog")!; pr.getAnimations().forEach((a) => a.cancel());
      });
      stage.style.setProperty("--stage", color);
      stage.classList.toggle("light-text", light); stage.classList.toggle("dark-text", !light);
      $("nbh-stage-ex")?.classList.toggle("light", light);
      const path = $("nbh-stage-path"); if (path) path.textContent = "workspace / " + key;
      stage.setAttribute("aria-labelledby", "nbh-tab-" + key);
      stage.querySelectorAll<HTMLElement>("[data-mock]").forEach((m) => { m.hidden = m.dataset.mock !== key; });
      stage.querySelectorAll<HTMLElement>("[data-foot]").forEach((f) => { f.hidden = f.dataset.foot !== key; });
      const mock = stage.querySelector<HTMLElement>(`[data-mock="${key}"]`);
      if (motion && mock) mock.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 600, easing: "cubic-bezier(.16,1,.3,1)" });
      if (user) { paused = pinned = true; try { history.replaceState(null, "", "#workspace-" + key); } catch { /* sandboxed frames */ } }
      run();
    };
    const run = () => {
      clearTimeout(cycle);
      if (!motion || paused || !inView) return;
      tabs[active]!.querySelector<HTMLElement>(".prog")!.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: DWELL, easing: "linear", fill: "forwards" });
      cycle = later(() => show(active + 1), DWELL);
    };
    cleanups.push(() => clearTimeout(cycle));
    tabs.forEach((t, i) => on(t, "click", () => show(i, true)));
    const step: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const onKeys = (e: KeyboardEvent, focusTab: boolean) => {
      const to = e.key in step ? active + step[e.key]! : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
      if (to === null) return;
      e.preventDefault(); show(to, true);
      if (focusTab) tabs[active]!.focus();
    };
    on(play.querySelector<HTMLElement>(".plist"), "keydown", (e) => onKeys(e, true));
    on(stage, "keydown", (e) => { if (e.target === stage) onKeys(e, false); });
    on($("nbh-prev"), "click", () => show(active - 1, true));
    on($("nbh-next"), "click", () => show(active + 1, true));
    on(play, "pointerenter", () => { paused = true; clearTimeout(cycle); tabs[active]!.querySelector<HTMLElement>(".prog")!.getAnimations().forEach((a) => a.pause()); });
    on(play, "pointerleave", () => { if (pinned) return; paused = false; run(); });
    let swipeX: number | null = null;
    on(stage, "pointerdown", (e) => { if (e.pointerType !== "mouse") swipeX = e.clientX; });
    on(stage, "pointerup", (e) => {
      if (swipeX === null) return;
      const dx = e.clientX - swipeX; swipeX = null;
      if (Math.abs(dx) > 48) show(active + (dx < 0 ? 1 : -1), true);
    });
    observe(([e]) => { inView = !!e?.isIntersecting; run(); }, [play], { threshold: 0.3 });
    const fromHash = () => {
      const k = location.hash.startsWith("#workspace-") ? keys.indexOf(location.hash.slice(11)) : -1;
      if (k < 0) return false;
      show(k, true);
      $("workspace")?.scrollIntoView({ behavior: motion ? "smooth" : "auto" });
      return true;
    };
    on(window, "hashchange", fromHash);
    if (!fromHash()) show(0);
  }

  // ---- release-notes ticker: a second copy makes the loop seamless; with reduced motion it is a still, scrollable row
  const ticker = $("nbh-ticker");
  if (ticker && motion) {
    const copies = [...ticker.children].map((n) => { const copy = n.cloneNode(true) as HTMLElement; copy.setAttribute("aria-hidden", "true"); return ticker.appendChild(copy); });
    ticker.style.setProperty("--tick", Math.round(ticker.scrollWidth / 2 / 40) + "s");
    cleanups.push(() => copies.forEach((c) => c.remove()));
  }

  // ---- terminal types itself once when it scrolls into view
  const term = $("nbh-term");
  if (term && motion) {
    const lines = [...term.querySelectorAll<HTMLElement>("[data-kind]")];
    const caret = term.querySelector(".term-caret");
    observe(([e], io) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      lines.forEach((l) => { l.hidden = true; });
      // Each line ends with its own newline: keep the cursor before it, at the end of the line being typed.
      const placeCaret = (line: HTMLElement) => {
        if (!caret) return;
        const nl = [...line.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent === "\n");
        if (nl) line.insertBefore(caret, nl); else line.appendChild(caret);
      };
      (async () => {
        for (const line of lines) {
          line.hidden = false;
          placeCaret(line);
          if (line.dataset.kind === "cmd") {
            const textNode = [...line.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
            const full = textNode?.textContent ?? "";
            for (let n = 1; textNode && n <= full.length; n++) { textNode.textContent = full.slice(0, n); await wait(32 + Math.random() * 40); }
            await wait(220);
          } else await wait(260);
        }
      })();
    }, [term], { threshold: 0.35 });
  }
  on($("nbh-copy-install"), "click", (e) => {
    const btn = e.currentTarget as HTMLElement;
    const done = (label: string) => { btn.title = label; btn.setAttribute("aria-label", label); btn.style.background = "rgb(153 206 173 / 35%)"; later(() => { btn.style.background = ""; btn.title = "Copy"; btn.setAttribute("aria-label", "Copy the install command"); }, 1600); };
    copyText("npm i -g @networkbase/cli").then(() => done("Copied"), () => done(COPY_FAILED));
  });

  // ---- the grids (locked engine)
  const engines = [...root.querySelectorAll<HTMLElement>("[data-grid-trail]")].map((el) => attachGridTrail(el, el.dataset.gridTrail as TrailPreset));
  document.fonts?.ready.then(() => engines.forEach((g) => g.refresh()));

  return () => {
    timers.forEach((t) => clearTimeout(t));
    cleanups.forEach((c) => c());
    engines.forEach((g) => g.destroy());
  };
}

type Observe = (fn: IntersectionObserverCallback, targets: (Element | null)[], options?: IntersectionObserverInit) => IntersectionObserver;
type On = <K extends keyof HTMLElementEventMap | "hashchange">(el: HTMLElement | Window | null, type: K, fn: (e: K extends keyof HTMLElementEventMap ? HTMLElementEventMap[K] : Event) => void) => void;

/** LOCKED: the pixel people band, exactly as approved on 18 Nov 2026. */
function pixelBand(wrap: HTMLElement, cv: HTMLCanvasElement, motion: boolean, observe: Observe, on: On, later: (fn: () => void, ms: number) => number) {
  const ctx = cv.getContext("2d")!;
  const P = ["..###..", "..###..", "..###..", ".......", ".#####.", "#######", "#######", "##...##"];
  const px = 8, step = 9 * px, rowH = 10 * px;
  type Person = { i: number; j: number; c: string; lift: number };
  let w = 0, h = 0, dpr = 1, people: Person[] = [], offset = 0, revealCols = Infinity, raf = 0, visible = true, last = 0;
  let ptr: { x: number; y: number } | null = null, picked: Person | null = null;
  let hits: { p: Person; x: number; y: number; w: number; h: number }[] = [];
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  function draw(now: number) {
    raf = 0;
    const dt = last ? Math.min(64, now - last) : 16; last = now;
    if (motion && visible && !picked) offset = (offset + dt * 0.012) % step; // the band holds still while someone is saying hi
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(wrap).getPropertyValue("--nb-grid-line-soft").trim();
    for (let x = 0; x <= w; x += 16) ctx.fillRect(x, 0, 1, h);
    for (let y = 0; y <= h; y += 16) ctx.fillRect(0, y, w, 1);
    let busy = false;
    hits = [];
    for (const p of people) {
      const shift = p.j % 2 ? step / 2 : 0;
      const x0 = Math.round((p.i * step + shift - offset - step) / px) * px, y0 = p.j * rowH + 8;
      if (x0 / step > revealCols) continue;
      let target = 0;
      if (ptr && motion && Math.hypot(x0 + 28 - ptr.x, y0 + 32 - ptr.y) < 110) target = 1;
      if (p === picked) target = 1;
      hits.push({ p, x: x0, y: y0, w: 7 * px, h: 8 * px });
      p.lift += (target - p.lift) * 0.25; if (Math.abs(target - p.lift) > 0.01) busy = true;
      const lift = Math.round(p.lift * 2) * px;
      ctx.fillStyle = p.c;
      ctx.globalAlpha = 0.55 + p.lift * 0.45;
      P.forEach((row, y) => [...row].forEach((b, x) => { if (b === "#") ctx.fillRect(x0 + x * px, y0 + y * px - lift, px - 1, px - 1); }));
    }
    ctx.globalAlpha = 1;
    if ((motion && visible) || busy) raf = requestAnimationFrame(draw);
  }
  const build = () => {
    const r = cv.getBoundingClientRect(); w = r.width; h = r.height; dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.ceil(w / step) + 2, rows = Math.ceil(h / rowH) + 1;
    if (people.length < cols * rows) { people = []; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) people.push({ i, j, c: randomColor(), lift: 0 }); }
    draw(performance.now());
  };
  const ro = new ResizeObserver(build); ro.observe(cv);
  observe(([e]) => { visible = !!e?.isIntersecting; if (visible) { last = 0; kick(); } }, [cv]);
  const hitAt = (x: number, y: number) => hits.find((t) => x >= t.x - 4 && x <= t.x + t.w + 4 && y >= t.y - 2 * px && y <= t.y + t.h);
  on(wrap, "pointermove", (e) => { const r = cv.getBoundingClientRect(); ptr = { x: e.clientX - r.left, y: e.clientY - r.top }; wrap.classList.toggle("has-hit", !!hitAt(ptr.x, ptr.y)); kick(); });
  on(wrap, "pointerleave", () => { ptr = null; wrap.classList.remove("has-hit"); kick(); });
  let bubble: HTMLElement | null = null, bubbleTimer = 0;
  const closeBubble = () => { bubble?.remove(); bubble = null; picked = null; kick(); };
  on(wrap, "click", (e) => {
    if ((e.target as Element).closest(".bubble")) return;
    const r = cv.getBoundingClientRect(), t = hitAt(e.clientX - r.left, e.clientY - r.top);
    closeBubble();
    if (!t) return;
    picked = t.p;
    const skill = SKILLS[Math.floor(Math.random() * SKILLS.length)];
    bubble = document.createElement("div");
    bubble.className = "bubble"; bubble.setAttribute("role", "status");
    bubble.style.left = Math.min(Math.max(t.x + t.w / 2, 120), w - 120) + "px";
    bubble.style.top = Math.max(t.y - 2 * px, 64) + "px";
    bubble.style.setProperty("--bc", t.p.c);
    bubble.append("Hi! I know ", Object.assign(document.createElement("b"), { textContent: skill }), ".");
    const link = Object.assign(document.createElement("a"), { href: "#people", textContent: `Find people who know ${skill} ↗` });
    bubble.append(link);
    wrap.appendChild(bubble);
    clearTimeout(bubbleTimer); bubbleTimer = later(closeBubble, 4500);
    kick();
  });
  return {
    wipe() {
      if (!motion) return;
      revealCols = -1; const t0 = performance.now();
      const grow = (now: number) => { revealCols = (now - t0) / 45; if (revealCols < 40) requestAnimationFrame(grow); else revealCols = Infinity; kick(); };
      requestAnimationFrame(grow);
    },
    stop() { cancelAnimationFrame(raf); ro.disconnect(); clearTimeout(bubbleTimer); bubble?.remove(); },
  };
}
