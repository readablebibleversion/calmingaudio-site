// Calming Audio site behavior. Everything here is progressive enhancement: pages work without it.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;

  // ---------- header ----------
  const header = $("[data-header]");
  const onScroll = () => header?.classList.toggle("scrolled", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const toggle = $("[data-nav-toggle]");
  toggle?.addEventListener("click", () => {
    const open = root.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", open);
  });
  $$("[data-nav] a").forEach((a) => a.addEventListener("click", () => {
    root.classList.remove("nav-open");
    toggle?.setAttribute("aria-expanded", "false");
  }));

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

  // ---------- lightweight YouTube facade (home feature) ----------
  $$(".lite-yt").forEach((box) => box.addEventListener("click", () => {
    if (box.querySelector("iframe")) return;
    const f = document.createElement("iframe");
    f.src = `https://www.youtube.com/embed/${box.dataset.yt}?autoplay=1&rel=0`;
    f.title = box.dataset.title || "YouTube video";
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    f.allowFullscreen = true;
    box.append(f);
    box.querySelector(".lite-play")?.remove();
  }));

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
  const lib = $("[data-library]");
  if (lib) {
    const gridEl = $("[data-grid]", lib);
    const cards = $$(".card", gridEl);
    const search = $("[data-search]", lib);
    const sort = $("[data-sort]", lib);
    const countEl = $("[data-count]", lib);
    const empty = $("[data-empty]", lib);
    const scoped = !!lib.dataset.scope; // category pages: chips navigate normally
    const params = new URLSearchParams(location.search);
    let filter = (!scoped && params.get("c")) || "all";
    if (params.get("q")) search.value = params.get("q");

    const apply = (animate = true) => {
      const q = search.value.trim().toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      const key = sort.value;
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
      if (!scoped) {
        $$("[data-chips] .chip").forEach((ch) => ch.setAttribute("aria-current", ch.dataset.filter === filter ? "true" : "false"));
        const u = new URL(location.href);
        filter === "all" ? u.searchParams.delete("c") : u.searchParams.set("c", filter);
        q ? u.searchParams.set("q", q) : u.searchParams.delete("q");
        history.replaceState(null, "", u);
      }
    };

    if (!scoped) $$("[data-chips] .chip", lib).forEach((ch) => ch.addEventListener("click", (e) => {
      e.preventDefault();
      filter = ch.dataset.filter;
      ch.scrollIntoView({ behavior: reduced ? "auto" : "smooth", inline: "center", block: "nearest" });
      apply();
    }));
    let timer;
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 140); });
    sort.addEventListener("change", () => apply());
    apply(false);
  }

  // ---------- description expand ----------
  $$("[data-desc]").forEach((d) => {
    const body = $(".desc-body", d);
    if (body.scrollHeight <= body.clientHeight + 8) d.classList.add("short");
    $("[data-desc-toggle]", d).addEventListener("click", (e) => {
      const open = d.classList.toggle("open");
      e.currentTarget.textContent = open ? "Show less" : "Show more";
    });
  });

  // ---------- share ----------
  $$("[data-share]").forEach((b) => b.addEventListener("click", async () => {
    const { url, title } = b.dataset;
    const label = $("span", b);
    try {
      if (navigator.share) await navigator.share({ url, title });
      else { await navigator.clipboard.writeText(url); label.textContent = "Link copied"; setTimeout(() => (label.textContent = "Share"), 2200); }
    } catch {}
  }));

  // ---------- contact form ----------
  const form = $("[data-contact]");
  if (form) {
    const type = $("[data-type]", form);
    const budget = $("[data-budget]", form);
    const status = $("[data-status]", form);
    const endpoint = form.dataset.endpoint;
    form.started.value = Date.now();
    const preset = new URLSearchParams(location.search).get("type");
    if (preset && [...type.options].some((o) => o.value === preset)) type.value = preset;
    const syncBudget = () => budget.classList.toggle("collapsed", !["sponsorship", "partnership", "custom", "licensing"].includes(type.value));
    type.addEventListener("change", syncBudget);
    syncBudget();

    form.addEventListener("input", (e) => e.target.closest(".field")?.classList.remove("invalid"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = ""; status.classList.remove("error");
      let bad = null;
      $$("[required]", form).forEach((el) => {
        const ok = el.checkValidity() && el.value.trim();
        el.closest(".field")?.classList.toggle("invalid", !ok);
        if (!ok && !bad) bad = el;
      });
      if (bad) { bad.focus(); status.textContent = "Please fill in the highlighted fields."; status.classList.add("error"); return; }
      if (!endpoint) { status.textContent = "The contact form isn’t connected yet. Please check back soon."; status.classList.add("error"); return; }

      const fd = new FormData(form);
      fd.set("inquiry_type", type.options[type.selectedIndex].text);
      form.classList.add("sending");
      try {
        // A url-encoded body keeps this a "simple" request, which Google Apps Script accepts cross-origin.
        const r = await fetch(endpoint, { method: "POST", body: new URLSearchParams(fd) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.success === false) throw new Error(j.message || "Send failed");
        $("[data-done]", form).hidden = false;
        form.reset();
      } catch (err) {
        status.textContent = "Something went wrong sending your message. Please try again in a moment.";
        status.classList.add("error");
      } finally {
        form.classList.remove("sending");
      }
    });
  }
})();
