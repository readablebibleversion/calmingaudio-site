// Calming Audio site behavior. Everything here is progressive enhancement: pages work without it.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;

  // Every interactive widget is a small explicit state machine. Its current state is mirrored to
  // data-state on the element (for CSS, tests and agents to read), and send() only follows the
  // transitions listed for the current state, so impossible moves like "send while sending" are no-ops.
  // render(state, data) is the one place that updates the DOM for a state.
  const machine = (el, initial, transitions, render) => {
    let state = initial;
    const enter = (next, data) => { state = next; el.dataset.state = next; render(next, data); };
    enter(initial);
    return {
      get state() { return state; },
      send(event, data) {
        const next = transitions[state]?.[event];
        if (next) enter(next, data);
        return !!next;
      },
    };
  };

  // ---------- header ----------
  const header = $("[data-header]");
  const onScroll = () => header?.classList.toggle("scrolled", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Mobile menu: closed <-> open. Closes on link click, Escape, or growing past the mobile breakpoint.
  const toggle = $("[data-nav-toggle]");
  if (toggle && header) {
    const nav = machine(header, "closed", { closed: { toggle: "open" }, open: { toggle: "closed", close: "closed" } }, (s) => {
      root.classList.toggle("nav-open", s === "open");
      toggle.setAttribute("aria-expanded", s === "open");
      $(".sr-only", toggle).textContent = s === "open" ? "Close menu" : "Menu";
    });
    toggle.addEventListener("click", () => nav.send("toggle"));
    $$("[data-nav] a").forEach((a) => a.addEventListener("click", () => nav.send("close")));
    addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.send("close")) toggle.focus(); });
    matchMedia("(min-width: 761px)").addEventListener("change", (e) => e.matches && nav.send("close"));
  }

  // ---------- reveal on scroll ----------
  const settle = (el) => el.addEventListener("transitionend", () => el.classList.add("settled"), { once: true });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); settle(e.target); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  $$("[data-reveal]").forEach((el) => (reduced ? el.classList.add("in", "settled") : io.observe(el)));
  // Reveal whatever is already on screen right away instead of waiting for the observer's first pass.
  requestAnimationFrame(() => $$("[data-reveal]:not(.in)").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0 && r.width) { el.classList.add("in"); settle(el); io.unobserve(el); }
  }));

  // ---------- drifting motes ----------
  const canvas = $("[data-motes]");
  if (canvas && !reduced) {
    const ctx = canvas.getContext("2d");
    let w, h, dpr, motes = [], raf;
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.width = innerWidth * dpr;
      h = canvas.height = innerHeight * dpr;
      const n = Math.round(Math.min(90, (innerWidth * innerHeight) / 16000));
      motes = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: (Math.random() * 1.4 + 0.4) * dpr,
        vy: -(Math.random() * 0.12 + 0.03) * dpr, vx: (Math.random() - 0.5) * 0.06 * dpr,
        t: Math.random() * Math.PI * 2, s: Math.random() * 0.006 + 0.002,
        hue: Math.random() < 0.7 ? "190,230,245" : "200,185,255",
      }));
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.t += m.s; m.y += m.vy; m.x += m.vx + Math.sin(m.t) * 0.08 * dpr;
        if (m.y < -10) { m.y = h + 10; m.x = Math.random() * w; }
        const a = 0.25 + Math.sin(m.t * 2) * 0.2 + 0.2;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${m.hue},${a.toFixed(3)})`;
        ctx.shadowBlur = 8 * dpr; ctx.shadowColor = `rgba(${m.hue},0.6)`;
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    resize(); draw();
    addEventListener("resize", () => { cancelAnimationFrame(raf); resize(); draw(); });
    document.addEventListener("visibilitychange", () => { cancelAnimationFrame(raf); if (!document.hidden) draw(); });
  }

  // ---------- cursor glow on tiles ----------
  $$("[data-glow]").forEach((el) => el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }));

  // ---------- lightweight YouTube facade (home feature): poster -> playing ----------
  $$(".lite-yt").forEach((box) => {
    const player = machine(box, "poster", { poster: { play: "playing" } }, (s) => {
      if (s !== "playing") return;
      const f = document.createElement("iframe");
      f.src = `https://www.youtube.com/embed/${box.dataset.yt}?autoplay=1&rel=0`;
      f.title = box.dataset.title || "YouTube video";
      f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      f.allowFullscreen = true;
      box.append(f);
      box.querySelector(".lite-play")?.remove();
      f.focus();
    });
    box.addEventListener("click", () => player.send("play"));
  });

  // ---------- count up ----------
  const cio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      cio.unobserve(e.target);
      const el = e.target, end = +el.dataset.countTo, suf = el.dataset.suffix || "", t0 = performance.now(), dur = 1800;
      const fmt = (n) => n.toLocaleString("en-US") + suf;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 4);
        el.textContent = fmt(Math.round(end * eased));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.6 });
  if (!reduced) $$("[data-count-to]").forEach((el) => cio.observe(el));

  // ---------- library: filter, search, sort ----------
  // The view is one state object, { filter, q, sort }, mirrored to the URL (?c=&q=&sort=) so any view
  // can be bookmarked, shared or reloaded, and to data-view-filter/-q/-sort/-shown on the library.
  const lib = $("[data-library]");
  if (lib) {
    const gridEl = $("[data-grid]", lib);
    const cards = $$(".card", gridEl);
    const search = $("[data-search]", lib);
    const sort = $("[data-sort]", lib);
    const countEl = $("[data-count]", lib);
    const empty = $("[data-empty]", lib);
    const scoped = !!lib.dataset.scope; // category pages: chips navigate normally
    const sorts = [...sort.options].map((o) => o.value);
    const filters = new Set(["all", ...$$("[data-chips] .chip", lib).map((ch) => ch.dataset.filter)]);
    const params = new URLSearchParams(location.search);
    const view = {
      filter: !scoped && filters.has(params.get("c")) ? params.get("c") : "all",
      q: params.get("q") || "",
      sort: sorts.includes(params.get("sort")) ? params.get("sort") : sorts[0],
    };
    search.value = view.q;
    sort.value = view.sort;

    const apply = (animate = true) => {
      view.q = search.value.trim();
      view.sort = sort.value;
      const { filter } = view;
      const terms = view.q.toLowerCase().split(/\s+/).filter(Boolean);
      const key = view.sort;
      const sorted = [...cards].sort((a, b) => {
        const d = (k) => +b.dataset[k] - +a.dataset[k];
        return key === "views" ? d("views") : key === "dur" ? d("dur") : key === "old" ? -d("date") : d("date");
      });
      let shown = 0;
      sorted.forEach((c) => {
        const ok = (filter === "all" || c.dataset.cats.split(" ").includes(filter)) && terms.every((t) => c.dataset.title.includes(t));
        c.classList.toggle("is-hidden", !ok);
        c.classList.remove("is-entering");
        if (ok) {
          if (animate) {
            if (!reduced) { c.style.setProperty("--n", Math.min(shown, 16)); void c.offsetWidth; c.classList.add("is-entering"); }
            c.classList.add("in", "settled");
          }
          shown++;
        }
        gridEl.append(c);
      });
      countEl.textContent = `Showing ${shown} of ${cards.length} videos`;
      empty.hidden = shown > 0;
      Object.assign(lib.dataset, { viewFilter: filter, viewQ: view.q, viewSort: view.sort, viewShown: shown });
      if (!scoped) $$("[data-chips] .chip").forEach((ch) => ch.setAttribute("aria-current", ch.dataset.filter === filter ? "true" : "false"));
      const u = new URL(location.href);
      const setParam = (k, v, dflt) => (v && v !== dflt ? u.searchParams.set(k, v) : u.searchParams.delete(k));
      if (!scoped) setParam("c", filter, "all");
      setParam("q", view.q);
      setParam("sort", view.sort, sorts[0]);
      if (u.href !== location.href) history.replaceState(null, "", u);
    };

    if (!scoped) $$("[data-chips] .chip", lib).forEach((ch) => ch.addEventListener("click", (e) => {
      e.preventDefault();
      view.filter = ch.dataset.filter;
      ch.scrollIntoView({ behavior: reduced ? "auto" : "smooth", inline: "center", block: "nearest" });
      apply();
    }));
    let timer;
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 140); });
    sort.addEventListener("change", () => apply());
    apply(false);
  }

  // ---------- description: short (fits, no toggle) | collapsed <-> expanded ----------
  $$("[data-desc]").forEach((d, i) => {
    const body = $(".desc-body", d);
    const btn = $("[data-desc-toggle]", d);
    body.id ||= `desc-body-${i}`;
    btn.setAttribute("aria-controls", body.id);
    const fits = body.scrollHeight <= body.clientHeight + 8;
    const desc = machine(d, fits ? "short" : "collapsed", { collapsed: { toggle: "expanded" }, expanded: { toggle: "collapsed" } }, (s) => {
      d.classList.toggle("short", s === "short");
      d.classList.toggle("open", s === "expanded");
      btn.textContent = s === "expanded" ? "Show less" : "Show more";
      btn.setAttribute("aria-expanded", s === "expanded");
    });
    btn.addEventListener("click", () => desc.send("toggle"));
  });

  // ---------- share: idle -> sharing -> idle | copied | failed -> idle ----------
  $$("[data-share]").forEach((b) => {
    const { url, title } = b.dataset;
    const label = $("span", b);
    const text = { idle: "Share", sharing: "Share", copied: "Link copied", failed: "Couldn’t copy link" };
    let reset;
    const share = machine(b, "idle", {
      idle: { share: "sharing" },
      sharing: { done: "idle", copied: "copied", failed: "failed" },
      copied: { share: "sharing", reset: "idle" },
      failed: { share: "sharing", reset: "idle" },
    }, (s) => {
      label.textContent = text[s];
      b.setAttribute("aria-busy", s === "sharing");
      clearTimeout(reset);
      if (s === "copied" || s === "failed") reset = setTimeout(() => share.send("reset"), 2200);
    });
    b.addEventListener("click", async () => {
      if (!share.send("share")) return; // already sharing
      if (navigator.share) {
        // Dismissing the share sheet rejects with AbortError; either way we're back to idle.
        try { await navigator.share({ url, title }); } catch {}
        return share.send("done");
      }
      try { await navigator.clipboard.writeText(url); share.send("copied"); } catch { share.send("failed"); }
    });
  });

  // ---------- contact form ----------
  // idle | invalid | unconfigured | failed --submit--> (invalid | unconfigured | sending)
  // sending --> sent (final) | failed. While sending or sent, further submits (Enter key included) are ignored.
  const form = $("[data-contact]");
  if (form) {
    const type = $("[data-type]", form);
    const budget = $("[data-budget]", form);
    const status = $("[data-status]", form);
    const submitBtn = $("[data-submit]", form);
    const done = $("[data-done]", form);
    const endpoint = form.dataset.endpoint;
    const TIMEOUT_MS = 20000;
    form.started.value = Date.now();
    const preset = new URLSearchParams(location.search).get("type");
    if (preset && [...type.options].some((o) => o.value === preset)) type.value = preset;
    const syncBudget = () => budget.classList.toggle("collapsed", !["sponsorship", "partnership", "custom", "licensing"].includes(type.value));
    type.addEventListener("change", syncBudget);
    syncBudget();

    const messages = {
      invalid: "Please fill in the highlighted fields.",
      unconfigured: "The contact form isn’t connected yet. Please check back soon.",
      failed: "Something went wrong sending your message. Please try again in a moment.",
    };
    const retry = { invalid: "invalid", unconfigured: "unconfigured", send: "sending" };
    const contact = machine(form, "idle", {
      idle: retry, invalid: retry, unconfigured: retry, failed: retry,
      sending: { ok: "sent", fail: "failed" },
      sent: {},
    }, (s, focusEl) => {
      status.textContent = messages[s] || "";
      status.classList.toggle("error", s in messages);
      form.classList.toggle("sending", s === "sending");
      form.setAttribute("aria-busy", s === "sending");
      submitBtn.disabled = s === "sending" || s === "sent";
      done.hidden = s !== "sent";
      if (s === "sent") done.setAttribute("tabindex", "-1"), done.focus();
      focusEl?.focus();
    });

    form.addEventListener("input", (e) => e.target.closest(".field")?.classList.remove("invalid"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (contact.state === "sending" || contact.state === "sent") return;
      let bad = null;
      $$("[required]", form).forEach((el) => {
        const ok = el.checkValidity() && el.value.trim();
        el.closest(".field")?.classList.toggle("invalid", !ok);
        if (!ok && !bad) bad = el;
      });
      if (bad) return contact.send("invalid", bad);
      if (!endpoint) return contact.send("unconfigured");

      const fd = new FormData(form);
      fd.set("inquiry_type", type.options[type.selectedIndex].text);
      contact.send("send");
      try {
        // A url-encoded body keeps this a "simple" request, which Google Apps Script accepts cross-origin.
        // The timeout stops a hung request from leaving the form stuck in "sending".
        const r = await fetch(endpoint, { method: "POST", body: new URLSearchParams(fd), signal: AbortSignal.timeout?.(TIMEOUT_MS) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.success === false) throw new Error(j.message || "Send failed");
        form.reset();
        syncBudget();
        contact.send("ok");
      } catch {
        contact.send("fail", submitBtn);
      }
    });
  }
})();
