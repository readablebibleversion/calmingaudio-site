// Builds the static site into dist/ from data/videos.json, categories.json and site.config.json.
// No dependencies: every page is plain, pre-rendered HTML so search engines see all content and links.

import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");
const readJson = async (f) => JSON.parse(await readFile(path.join(root, f), "utf8"));

const config = await readJson("site.config.json");
const { categories } = await readJson("categories.json");
const data = await readJson("data/videos.json");
const SITE = config.siteUrl.replace(/\/+$/, "");
const BUILD = Date.now().toString(36);
const YT_CHANNEL = `https://www.youtube.com/${config.channelHandle}`;
const YT_SUB = `${YT_CHANNEL}?sub_confirmation=1`;

// ---------- helpers ----------
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const abs = (p) => SITE + p;
const ytWatch = (id) => `https://www.youtube.com/watch?v=${id}`;
const ytEmbed = (id) => `https://www.youtube.com/embed/${id}`;
const thumb = (id, q = "hqdefault") => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
const fmtNum = (n) => new Intl.NumberFormat("en-US").format(n);
const fmtCompact = (n) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const isoDate = (iso) => (iso ? new Date(iso).toISOString() : undefined);

function fmtDuration(s) {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (s < 60) return `0:${String(s).padStart(2, "0")}`;
  if (h === 0) return `${m} min`;
  if (m === 0 || m === 60) return `${m === 60 ? h + 1 : h} hr`;
  return `${h} hr ${m} min`;
}
function isoDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `PT${h ? h + "H" : ""}${m ? m + "M" : ""}${sec || (!h && !m) ? sec + "S" : ""}`;
}
function excerpt(text = "", max = 155) {
  const firstPara = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).find((p) => p.length > 30) || text.replace(/\s+/g, " ").trim();
  return firstPara.length > max ? firstPara.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : firstPara;
}
function linkify(text = "") {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="nofollow noopener" target="_blank">$1</a>')
    .replace(/\n/g, "<br>");
}
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

// ---------- data prep ----------
const hidden = new Set(config.hiddenVideoIds || []);
const compiled = categories.map((c) => ({ ...c, re: new RegExp(c.match, "i"), pin: new Set(c.pin || []), exclude: new Set(c.exclude || []), videos: [] }));
const catBySlug = Object.fromEntries(compiled.map((c) => [c.slug, c]));

const videos = data.videos
  .filter((v) => !hidden.has(v.id) && v.title)
  .map((v) => {
    const isShort = /#shorts?\b/i.test(v.title) || (v.durationSeconds > 0 && v.durationSeconds <= 60) || (v.shortsEligible && v.durationSeconds <= 180);
    let cats = isShort
      ? compiled.filter((c) => c.shorts)
      : compiled.filter((c) => !c.shorts && !c.exclude.has(v.id) && (c.pin.has(v.id) || c.re.test(v.title)));
    return { ...v, isShort, cats, url: `/watch/${v.slug}/` };
  });
for (const v of videos) for (const c of v.cats) c.videos.push(v);
const activeCats = compiled.filter((c) => c.videos.length);
const longform = videos.filter((v) => !v.isShort);
const totalHours = Math.round(videos.reduce((a, v) => a + (v.durationSeconds || 0), 0) / 3600);
const firstYear = Math.min(...videos.map((v) => (v.publishedAt ? new Date(v.publishedAt).getFullYear() : 9999)));
const uncategorized = longform.filter((v) => !v.cats.length);
const stats = { videos: videos.length, hours: totalHours, categories: activeCats.length, since: firstYear };
// Pages without their own image share the newest upload's thumbnail (wide, unlike the square channel avatar).
const defaultImage = longform[0] ? thumb(longform[0].id) : data.channel?.avatar || "";
const defaultImageAlt = longform[0]?.title || config.siteName;
const newest = (list) => list.reduce((a, v) => (v.publishedAt > a ? v.publishedAt : a), "") || data.fetchedAt;
// Meta descriptions use the first paragraph that is unique to the video, skipping shared
// boilerplate ("For more sleep sounds…") and link lists, so no two pages share a snippet.
const paragraphs = (text = "") => text.split(/\n\s*\n|\n(?=[A-Z🎵#•-])/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
const paraCount = new Map();
for (const v of videos) for (const p of new Set(paragraphs(v.description))) paraCount.set(p, (paraCount.get(p) || 0) + 1);
const ownSummary = (v, max) => {
  const p = paragraphs(v.description).find((x) => x.length >= 60 && paraCount.get(x) === 1 && !/https?:\/\/|\b[A-Z] [A-Z] [A-Z]\b|subscribe/i.test(x));
  return p ? excerpt(p, max) : "";
};
const genericDesc = (v) => {
  const length = v.durationSeconds >= 3600 ? `${fmtDuration(v.durationSeconds)} of ` : "";
  const kind = v.cats[0] && !v.cats[0].shorts ? v.cats[0].name.toLowerCase() : "calming sound";
  return `${v.title}: ${length}${kind} from Calming Audio for sleep, study and relaxation.`;
};

// ---------- partials ----------
const icons = {
  yt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M8 7h9v9"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const logo = `<span class="logo-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>`;

function header(active) {
  const link = (href, label, key) => `<a href="${href}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="site-header" data-header>
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="${esc(config.siteName)} home">${logo}<span>${esc(config.siteName)}</span></a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav" data-nav-toggle><span></span><span></span><span class="sr-only">Menu</span></button>
    <nav id="site-nav" class="site-nav" data-nav>
      ${link("/videos/", "All videos", "videos")}
      ${link("/categories/", "Categories", "categories")}
      ${link("/contact/", "Sponsorships", "contact")}
      <a class="btn btn-sub" href="${YT_SUB}" target="_blank" rel="noopener">${icons.yt}<span>Subscribe</span></a>
    </nav>
  </div>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand" href="/">${logo}<span>${esc(config.siteName)}</span></a>
      <p class="muted">${esc(config.tagline)}. Making calm, hours-long soundscapes since ${stats.since}.</p>
      <a class="btn btn-ghost" href="${YT_CHANNEL}" target="_blank" rel="noopener">${icons.yt}<span>Calming Audio on YouTube</span></a>
    </div>
    <div>
      <h2 class="footer-h">Categories</h2>
      <ul class="footer-links">${activeCats.map((c) => `<li><a href="/category/${c.slug}/">${esc(c.name)}</a></li>`).join("")}</ul>
    </div>
    <div>
      <h2 class="footer-h">Work with us</h2>
      <ul class="footer-links">
        <li><a href="/contact/">Sponsorships</a></li>
        <li><a href="/contact/?type=licensing">Licensing</a></li>
        <li><a href="/contact/?type=custom">Custom soundscapes</a></li>
        <li><a href="/videos/">All ${stats.videos} videos</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap footer-bottom muted"><span>© ${new Date().getFullYear()} Calming Audio LLC. All rights reserved.</span><span>Turn the volume down low. Sleep well.</span></div>
</footer>`;
}

function layout({ title, description, pathname, body, active, head = "", ld = [], ogImage, ogImageAlt, ogType = "website", bodyClass = "", noindex = false }) {
  const canonical = abs(pathname);
  const fullTitle = pathname === "/" ? `${config.siteName}: ${config.tagline}` : `${title} | ${config.siteName}`;
  const img = ogImage || defaultImage;
  const imgAlt = ogImageAlt || (ogImage ? title : defaultImageAlt);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, follow">' : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${canonical}">`}
<meta name="author" content="${esc(config.siteName)}">
<meta name="theme-color" content="#060912">
<meta name="color-scheme" content="dark">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="${ogType}">
${img ? `<meta property="og:image" content="${esc(img)}">
<meta property="og:image:secure_url" content="${esc(img)}">
<meta property="og:image:width" content="480">
<meta property="og:image:height" content="360">
<meta property="og:image:alt" content="${esc(imgAlt)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${img ? `<meta name="twitter:image" content="${esc(img)}">
<meta name="twitter:image:alt" content="${esc(imgAlt)}">` : ""}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(config.siteName)}: new videos" href="/feed.xml">
<link rel="alternate" type="text/plain" title="LLM-friendly site summary" href="/llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://i.ytimg.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..500&family=Manrope:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/styles.css?v=${BUILD}">
${head}
${ld.map(jsonLd).join("\n")}
<script>document.documentElement.classList.add("js")</script>
<script src="/assets/app.js?v=${BUILD}" defer></script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<div class="sky" aria-hidden="true"><div class="aurora a1"></div><div class="aurora a2"></div><div class="aurora a3"></div><canvas class="motes" data-motes></canvas><div class="grain"></div></div>
${header(active)}
<main id="main">
${body}
</main>
${footer()}
</body>
</html>`;
}

function card(v, i = 0, { showCat = true } = {}) {
  const c = v.cats[0];
  const cats = v.cats.map((x) => x.slug).join(" ");
  return `<article class="card${v.isShort ? " card-short" : ""}" data-reveal style="--i:${i % 8}" data-cats="${cats}" data-title="${esc(v.title.toLowerCase())}" data-date="${v.publishedAt ? Date.parse(v.publishedAt) : 0}" data-dur="${v.durationSeconds || 0}" data-views="${v.viewCount || 0}">
  <a class="card-media" href="${v.url}" tabindex="-1" aria-hidden="true">
    <img src="${thumb(v.id, "mqdefault")}" srcset="${thumb(v.id, "mqdefault")} 320w, ${thumb(v.id, "hqdefault")} 480w" sizes="(max-width: 640px) 92vw, 360px" width="320" height="180" loading="lazy" decoding="async" alt="${esc(v.title)}">
    ${v.durationSeconds ? `<span class="badge">${fmtDuration(v.durationSeconds)}</span>` : ""}
    <span class="card-play">${icons.play}</span>
  </a>
  <div class="card-body">
    ${showCat && c ? `<a class="card-cat" href="/category/${c.slug}/">${esc(c.name)}</a>` : ""}
    <h3 class="card-title"><a href="${v.url}">${esc(v.title)}</a></h3>
    <div class="card-meta">
      ${v.publishedAt ? `<time datetime="${isoDate(v.publishedAt)}">${fmtDate(v.publishedAt)}</time>` : "<span></span>"}
      <a class="yt-link" href="${ytWatch(v.id)}" target="_blank" rel="noopener" aria-label="Watch ${esc(v.title)} on YouTube">${icons.yt}<span>YouTube</span></a>
    </div>
  </div>
</article>`;
}

const grid = (list, opts) => `<div class="grid" data-grid>${list.map((v, i) => card(v, i, opts)).join("\n")}</div>`;

function catTile(c, i) {
  const sample = c.videos.slice(0, 3);
  return `<a class="cat-tile" href="/category/${c.slug}/" data-reveal data-glow style="--i:${i % 6}">
  <span class="cat-thumbs" aria-hidden="true">${sample.map((v) => `<img src="${thumb(v.id, "mqdefault")}" alt="" loading="lazy" width="320" height="180">`).join("")}</span>
  <span class="cat-icon" aria-hidden="true">${c.icon || "◦"}</span>
  <span class="cat-name">${esc(c.name)}</span>
  <span class="cat-desc">${esc(c.description)}</span>
  <span class="cat-count">${c.videos.length} video${c.videos.length === 1 ? "" : "s"} ${icons.arrow}</span>
</a>`;
}

const chips = (current) => `<div class="chips" role="list" data-chips>
  <a role="listitem" class="chip" href="/videos/" data-filter="all"${!current ? ' aria-current="true"' : ""}>All <span>${videos.length}</span></a>
  ${activeCats.map((c) => `<a role="listitem" class="chip" href="/category/${c.slug}/" data-filter="${c.slug}"${current === c.slug ? ' aria-current="true"' : ""}>${esc(c.name)} <span>${c.videos.length}</span></a>`).join("\n  ")}
</div>`;

const toolbar = (current) => `<div class="toolbar" data-reveal>
  <label class="search">${icons.search}<span class="sr-only">Search videos</span><input type="search" placeholder="Search rain, fan, piano…" data-search autocomplete="off"></label>
  <label class="sort"><span class="sr-only">Sort</span><select data-sort>
    <option value="date">Newest first</option>
    <option value="views">Most played</option>
    <option value="dur">Longest</option>
    <option value="old">Oldest first</option>
  </select></label>
</div>
${chips(current)}
<p class="result-count muted" data-count aria-live="polite"></p>
<p class="empty" data-empty hidden>Nothing matches that yet. Try “rain”, “ocean” or “brown noise”.</p>`;

const ORG_ID = SITE + "/#organization";
const SITE_ID = SITE + "/#website";
const orgLd = {
  "@context": "https://schema.org", "@type": "Organization", "@id": ORG_ID,
  name: "Calming Audio", legalName: "Calming Audio LLC", url: SITE + "/", description: config.description,
  ...(data.channel?.avatar && { logo: { "@type": "ImageObject", url: data.channel.avatar }, image: data.channel.avatar }),
  sameAs: [YT_CHANNEL, `https://www.youtube.com/channel/${config.channelId}`],
  contactPoint: { "@type": "ContactPoint", contactType: "sponsorships and partnerships", url: abs("/contact/") },
};
const publisherRef = { "@id": ORG_ID };
const webPage = (type, name, description, p, extra = {}) => ({
  "@context": "https://schema.org", "@type": type, "@id": abs(p) + "#webpage", name, description, url: abs(p),
  inLanguage: "en-US", isPartOf: { "@id": SITE_ID }, ...extra,
});
const breadcrumbLd = (items) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(p) })),
});
const itemListLd = (list) => ({
  "@type": "ItemList", numberOfItems: list.length,
  itemListElement: list.slice(0, 100).map((v, i) => ({ "@type": "ListItem", position: i + 1, url: abs(v.url), name: v.title })),
});

// ---------- pages ----------
const pages = [];
const page = (pathname, html) => pages.push([pathname, html]);

// Home
{
  const featured = videos.find((v) => v.id === config.featuredVideoId) || longform[0];
  const latest = longform.filter((v) => v !== featured).slice(0, 8);
  const popular = [...longform].sort((a, b) => b.viewCount - a.viewCount).slice(0, 8);
  const words = ["Sound", "for", "<em>slower</em>", "nights."];
  const body = `
<section class="hero">
  <div class="wrap hero-inner">
    <div class="hero-copy">
      <p class="eyebrow" data-reveal>Since ${stats.since} · ${stats.videos} videos · ${fmtNum(stats.hours)}+ hours of calm</p>
      <h1 class="hero-title" aria-label="Sound for slower nights.">${words.map((w, i) => `<span class="w" style="--i:${i}" aria-hidden="true">${w}</span>`).join(" ")}</h1>
      <p class="lede" data-reveal style="--i:3">Rain on tin roofs, distant thunder, crackling fires, deep brown noise and gentle music. Long, steady soundscapes made for sleep, study and quiet minds.</p>
      <div class="hero-cta" data-reveal style="--i:4">
        <a class="btn btn-primary" href="#latest">${icons.play}<span>Start listening</span></a>
        <a class="btn btn-ghost" href="/categories/"><span>Find your sound</span></a>
      </div>
    </div>
    <div class="breath" data-breath aria-hidden="true">
      <span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>
      <span class="orb"></span>
      <span class="breath-text"><b data-breath-in>Breathe in</b><b data-breath-out>Breathe out</b></span>
    </div>
  </div>
  <a class="scroll-cue" href="#latest" aria-label="Scroll to latest video"><span></span></a>
</section>

<section class="section" id="latest">
  <div class="wrap">
    <div class="section-head" data-reveal><p class="eyebrow">Newest soundscape</p><h2>Latest upload</h2></div>
    <article class="feature" data-reveal>
      <div class="feature-media lite-yt" data-yt="${featured.id}" data-title="${esc(featured.title)}">
        <img src="${thumb(featured.id, "maxresdefault")}" onerror="this.onerror=null;this.src='${thumb(featured.id, "hqdefault")}'" alt="${esc(featured.title)}" width="1280" height="720" fetchpriority="high">
        <button class="lite-play" type="button" aria-label="Play ${esc(featured.title)}">${icons.play}</button>
      </div>
      <div class="feature-copy">
        ${featured.cats[0] ? `<a class="card-cat" href="/category/${featured.cats[0].slug}/">${esc(featured.cats[0].name)}</a>` : ""}
        <h3><a href="${ytWatch(featured.id)}" target="_blank" rel="noopener">${esc(featured.title)}</a></h3>
        <p class="muted">${esc(ownSummary(featured, 220) || genericDesc(featured))}</p>
        <div class="feature-meta muted"><time datetime="${isoDate(featured.publishedAt)}">${fmtDate(featured.publishedAt)}</time><span>${fmtDuration(featured.durationSeconds)}</span></div>
        <div class="row"><a class="btn btn-primary" href="${featured.url}"><span>Open video page</span>${icons.arrow}</a><a class="btn btn-ghost" href="${ytWatch(featured.id)}" target="_blank" rel="noopener">${icons.yt}<span>Watch on YouTube</span></a></div>
      </div>
    </article>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head" data-reveal><p class="eyebrow">${stats.categories} moods</p><h2>Find your sound</h2><a class="link-arrow" href="/categories/">All categories ${icons.arrow}</a></div>
    <div class="cat-grid">${activeCats.filter((c) => !c.shorts).slice(0, 6).map(catTile).join("")}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head" data-reveal><p class="eyebrow">Fresh from the channel</p><h2>Recently added</h2><a class="link-arrow" href="/videos/">All ${stats.videos} videos ${icons.arrow}</a></div>
    ${grid(latest)}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head" data-reveal><p class="eyebrow">Listener favorites</p><h2>Most played</h2></div>
    ${grid(popular)}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="partner" data-reveal data-glow>
      <div>
        <p class="eyebrow">Sponsorships &amp; partnerships</p>
        <h2>Reach people in their calmest moments.</h2>
        <p class="muted">Our listeners press play to sleep, study and slow down, and they stay for hours. We partner with brands that fit that space: sleep, wellness, focus, home and comfort.</p>
        <a class="btn btn-primary" href="/contact/">${icons.arrow}<span>Start a conversation</span></a>
      </div>
      <dl class="stats">
        <div><dt>Videos</dt><dd data-count-to="${stats.videos}">${stats.videos}</dd></div>
        <div><dt>Hours of audio</dt><dd data-count-to="${stats.hours}" data-suffix="+">${fmtNum(stats.hours)}+</dd></div>
        <div><dt>Creating since</dt><dd>${stats.since}</dd></div>
      </dl>
    </div>
  </div>
</section>`;
  page("/", layout({
    title: config.siteName, description: config.description, pathname: "/", body, bodyClass: "home",
    ld: [
      orgLd,
      { "@context": "https://schema.org", "@type": "WebSite", "@id": SITE_ID, name: config.siteName, alternateName: "Calming Audio sleep sounds", url: SITE + "/", description: config.description, inLanguage: "en-US", publisher: publisherRef },
      webPage("CollectionPage", `${config.siteName}: ${config.tagline}`, config.description, "/", { about: publisherRef, mainEntity: itemListLd(longform.slice(0, 20)) }),
    ],
  }));
}

// All videos
{
const description = `Browse all ${stats.videos} Calming Audio videos: rain, ocean, fireplace, white noise, nature sounds and relaxing music for sleep and focus.`;
page("/videos/", layout({
  title: "All videos", active: "videos", pathname: "/videos/", description,
  ld: [webPage("CollectionPage", `All videos | ${config.siteName}`, description, "/videos/", { mainEntity: itemListLd(videos) }), breadcrumbLd([["Home", "/"], ["All videos", "/videos/"]])],
  body: `<section class="page-head"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb" data-reveal><a href="/">Home</a><span>/</span><span aria-current="page">All videos</span></nav><p class="eyebrow" data-reveal>The full library</p><h1 data-reveal>All videos</h1><p class="lede" data-reveal>Every Calming Audio upload, ${fmtNum(stats.hours)}+ hours in all. Filter by mood, search by sound, or sort by what listeners play most.</p></div></section>
<section class="section section-tight"><div class="wrap" data-library>${toolbar()}${grid(videos)}</div></section>`,
}));
}

// Categories hub
{
const description = `Explore ${stats.categories} Calming Audio categories: rain and storms, ocean, fireplace, white and brown noise, baby sleep, nature, study music and more.`;
page("/categories/", layout({
  title: "Categories", active: "categories", pathname: "/categories/", description,
  ld: [
    webPage("CollectionPage", `Categories | ${config.siteName}`, description, "/categories/", {
      mainEntity: { "@type": "ItemList", numberOfItems: activeCats.length, itemListElement: activeCats.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: abs(`/category/${c.slug}/`), name: c.name })) },
    }),
    breadcrumbLd([["Home", "/"], ["Categories", "/categories/"]]),
  ],
  body: `<section class="page-head"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb" data-reveal><a href="/">Home</a><span>/</span><span aria-current="page">Categories</span></nav><p class="eyebrow" data-reveal>${stats.categories} moods</p><h1 data-reveal>Find your sound</h1><p class="lede" data-reveal>Some people sleep best with rain, others need a fan. Pick a mood and press play.</p></div></section>
<section class="section section-tight"><div class="wrap"><div class="cat-grid">${activeCats.map(catTile).join("")}</div></div></section>`,
}));
}

// Category pages
for (const c of activeCats) {
  const p = `/category/${c.slug}/`;
  const description = excerpt(`${c.description} ${c.videos.length} videos from Calming Audio.`, 160);
  page(p, layout({
    title: `${c.name}`, active: "categories", pathname: p, description,
    ogImage: c.videos[0] ? thumb(c.videos[0].id) : undefined, ogImageAlt: c.videos[0]?.title,
    ld: [
      webPage("CollectionPage", `${c.name} | ${config.siteName}`, c.description, p, { mainEntity: itemListLd(c.videos) }),
      breadcrumbLd([["Home", "/"], ["Categories", "/categories/"], [c.name, p]]),
    ],
    body: `<section class="page-head"><div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb" data-reveal><a href="/">Home</a><span>/</span><a href="/categories/">Categories</a><span>/</span><span aria-current="page">${esc(c.name)}</span></nav>
  <p class="eyebrow" data-reveal><span class="big-icon">${c.icon || ""}</span> ${c.videos.length} videos</p>
  <h1 data-reveal>${esc(c.name)}</h1><p class="lede" data-reveal>${esc(c.description)}</p></div></section>
<section class="section section-tight"><div class="wrap" data-library data-scope="${c.slug}">${toolbar(c.slug)}${grid(c.videos, { showCat: false })}</div></section>`,
  }));
}

// Watch pages
for (const v of videos) {
  const main = v.cats[0];
  const related = (main ? main.videos : longform).filter((x) => x.id !== v.id).slice(0, 8);
  const own = ownSummary(v, 158);
  const desc = own.length >= 70 ? own : excerpt(genericDesc(v), 158);
  const crumbs = [["Home", "/"]];
  if (main) crumbs.push([main.name, `/category/${main.slug}/`]);
  crumbs.push([v.title, v.url]);
  const videoLd = {
    "@context": "https://schema.org", "@type": "VideoObject", "@id": abs(v.url) + "#video",
    name: v.title, description: (v.description || genericDesc(v)).slice(0, 2000),
    thumbnailUrl: [thumb(v.id, "maxresdefault"), thumb(v.id, "hqdefault")],
    uploadDate: isoDate(v.publishedAt || data.fetchedAt), embedUrl: ytEmbed(v.id), url: abs(v.url),
    ...(v.durationSeconds && { duration: isoDuration(v.durationSeconds) }),
    ...(v.viewCount && { interactionStatistic: { "@type": "InteractionCounter", interactionType: { "@type": "WatchAction" }, userInteractionCount: v.viewCount } }),
    inLanguage: "en", isFamilyFriendly: true,
    ...(v.cats.length && { genre: v.cats.map((c) => c.name) }),
    author: publisherRef, publisher: publisherRef,
    potentialAction: { "@type": "WatchAction", target: ytWatch(v.id) },
    sameAs: ytWatch(v.id),
    ...(v.keywords?.length && { keywords: v.keywords.slice(0, 20).join(", ") }),
  };
  const descBlock = v.description ? `<div class="desc" data-desc><div class="desc-body">${linkify(v.description)}</div><button class="desc-toggle" type="button" data-desc-toggle>Show more</button></div>` : "";

  page(v.url, layout({
    title: v.title, pathname: v.url, description: desc, ogImage: thumb(v.id, "hqdefault"), ogType: "video.other",
    head: `<meta property="og:video" content="${ytEmbed(v.id)}"><meta property="og:video:secure_url" content="${ytEmbed(v.id)}"><meta property="og:video:type" content="text/html"><meta property="og:video:width" content="1280"><meta property="og:video:height" content="720">${v.publishedAt ? `<meta property="video:release_date" content="${isoDate(v.publishedAt)}">` : ""}${v.durationSeconds ? `<meta property="video:duration" content="${v.durationSeconds}">` : ""}`,
    ld: [videoLd, webPage("WebPage", v.title, desc, v.url, { primaryImageOfPage: thumb(v.id, "hqdefault"), mainEntity: { "@id": abs(v.url) + "#video" }, ...(v.publishedAt && { datePublished: isoDate(v.publishedAt) }) }), breadcrumbLd(crumbs)],
    bodyClass: "watch",
    body: `<section class="watch-hero">
  <div class="ambient" aria-hidden="true" style="background-image:url('${thumb(v.id, "mqdefault")}')"></div>
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span>${main ? `<a href="/category/${main.slug}/">${esc(main.name)}</a><span>/</span>` : ""}<span aria-current="page">${esc(v.title)}</span></nav>
    <div class="player${v.isShort ? " player-short" : ""}" data-reveal>
      <iframe src="${ytEmbed(v.id)}?rel=0&amp;modestbranding=1" title="${esc(v.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
    </div>
    <div class="watch-info">
      <div class="watch-main">
        <h1 class="watch-title" data-reveal><a href="${ytWatch(v.id)}" target="_blank" rel="noopener">${esc(v.title)}<span class="title-ext">${icons.ext}</span></a></h1>
        <div class="watch-meta muted" data-reveal>
          ${v.publishedAt ? `<time datetime="${isoDate(v.publishedAt)}">${fmtDate(v.publishedAt)}</time>` : ""}
          ${v.durationSeconds ? `<span>${fmtDuration(v.durationSeconds)}</span>` : ""}
          ${v.viewCount ? `<span>${fmtCompact(v.viewCount)} plays</span>` : ""}
        </div>
        <div class="tag-row" data-reveal>${v.cats.map((c) => `<a class="chip" href="/category/${c.slug}/">${c.icon || ""} ${esc(c.name)}</a>`).join("")}</div>
        ${descBlock}
      </div>
      <aside class="watch-side" data-reveal>
        <a class="btn btn-primary btn-block" href="${ytWatch(v.id)}" target="_blank" rel="noopener">${icons.yt}<span>Watch on YouTube</span></a>
        <a class="btn btn-ghost btn-block" href="${YT_SUB}" target="_blank" rel="noopener"><span>Subscribe to Calming Audio</span></a>
        <button class="btn btn-ghost btn-block" type="button" data-share data-url="${abs(v.url)}" data-title="${esc(v.title)}">${icons.share}<span>Share</span></button>
        <p class="tip muted">Tip: lower the volume, dim the screen and let it play all night.</p>
      </aside>
    </div>
  </div>
</section>
${related.length ? `<section class="section"><div class="wrap"><div class="section-head" data-reveal><p class="eyebrow">Keep listening</p><h2>More ${main ? esc(main.name.toLowerCase()) : "from Calming Audio"}</h2>${main ? `<a class="link-arrow" href="/category/${main.slug}/">See all ${icons.arrow}</a>` : ""}</div>${grid(related)}</div></section>` : ""}`,
  }));
}

// Contact
{
  const endpoint = process.env.CONTACT_FORM_ENDPOINT || config.contactForm?.endpoint || "";
  const body = `<section class="page-head"><div class="wrap"><p class="eyebrow" data-reveal>Sponsorships · Licensing · Custom work</p><h1 data-reveal>Let’s make something calm together.</h1></div></section>
<section class="section section-tight"><div class="wrap contact-grid">
  <div class="contact-copy" data-reveal>
    <p class="lede">Calming Audio is where people go to fall asleep, focus and decompress, often for the full length of a ${fmtDuration(36000)} video. If your brand belongs in that moment, we’d love to hear from you.</p>
    <ul class="offer">
      <li><b>Sponsored integrations</b><span>Tasteful mentions and pinned links on new and evergreen uploads.</span></li>
      <li><b>Brand soundscapes</b><span>A custom ambience built around your product, space or story.</span></li>
      <li><b>Licensing</b><span>Use Calming Audio sound in apps, spas, retail, hospitality or film.</span></li>
      <li><b>Requests &amp; feedback</b><span>Have a sound you can’t sleep without? Tell us.</span></li>
    </ul>
    <dl class="stats stats-inline">
      <div><dt>Videos</dt><dd>${stats.videos}</dd></div>
      <div><dt>Hours of audio</dt><dd>${fmtNum(stats.hours)}+</dd></div>
      <div><dt>Since</dt><dd>${stats.since}</dd></div>
    </dl>
  </div>
  <form class="contact-form" data-contact data-reveal data-glow data-endpoint="${esc(endpoint)}" method="POST" novalidate>
    <input type="hidden" name="started" value="">
    <input type="checkbox" name="botcheck" value="1" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <div class="field"><input id="f-name" name="name" required autocomplete="name" placeholder=" "><label for="f-name">Your name</label></div>
    <div class="field"><input id="f-email" name="email" type="email" required autocomplete="email" placeholder=" "><label for="f-email">Email</label></div>
    <div class="field"><input id="f-company" name="company" autocomplete="organization" placeholder=" "><label for="f-company">Company or brand (optional)</label></div>
    <div class="field field-select"><select id="f-type" name="inquiry_type" required data-type>
      <option value="sponsorship">Sponsorship</option>
      <option value="partnership">Brand partnership</option>
      <option value="licensing">Licensing</option>
      <option value="custom">Custom soundscape</option>
      <option value="press">Press</option>
      <option value="other">Something else</option>
    </select><label for="f-type">What’s this about?</label></div>
    <div class="field field-select" data-budget><select id="f-budget" name="budget">
      <option value="">Prefer not to say</option>
      <option>Under $500</option><option>$500 – $2,000</option><option>$2,000 – $5,000</option><option>$5,000+</option>
    </select><label for="f-budget">Budget (optional)</label></div>
    <div class="field"><textarea id="f-msg" name="message" rows="5" required placeholder=" "></textarea><label for="f-msg">Tell us a little about it</label></div>
    <button class="btn btn-primary btn-block" type="submit" data-submit><span>Send message</span>${icons.arrow}</button>
    <p class="form-status" data-status role="status" aria-live="polite"></p>
    <div class="form-done" data-done hidden><span class="done-ring"></span><h2>Message sent</h2><p class="muted">Thanks for reaching out. We usually reply within a few days.</p></div>
  </form>
</div></section>`;
  const description = "Sponsor, partner with or license audio from Calming Audio. Get in touch about integrations, brand soundscapes and custom requests.";
  page("/contact/", layout({
    title: "Sponsorships & contact", active: "contact", pathname: "/contact/", description, body,
    ld: [webPage("ContactPage", `Sponsorships & contact | ${config.siteName}`, description, "/contact/", { about: publisherRef }), breadcrumbLd([["Home", "/"], ["Sponsorships & contact", "/contact/"]])],
  }));
}

// 404
const notFound = layout({
  title: "Page not found", pathname: "/404.html", description: "This page drifted off.", noindex: true,
  body: `<section class="page-head center"><div class="wrap"><p class="eyebrow">404</p><h1>This page drifted off to sleep.</h1><p class="lede">Let’s get you somewhere calmer.</p><div class="row center"><a class="btn btn-primary" href="/">Back home</a><a class="btn btn-ghost" href="/videos/">Browse videos</a></div></div></section>`,
});

// ---------- write ----------
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, "src", "assets"), path.join(out, "assets"), { recursive: true });
for (const [p, html] of pages) {
  const dir = path.join(out, p);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), html);
}
await writeFile(path.join(out, "404.html"), notFound);

// Sitemap with video extensions so Google can attach each video to its page.
const xml = (s) => esc(String(s)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
// lastmod only moves when content really changes (a new upload), so search engines keep trusting it.
const lastmodFor = (p, v) => {
  if (v) return isoDate(v.publishedAt || data.fetchedAt);
  const cat = p.startsWith("/category/") && catBySlug[p.split("/")[2]];
  return isoDate(newest(cat ? cat.videos : videos));
};
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${pages.map(([p]) => {
  const v = videos.find((x) => x.url === p);
  const last = lastmodFor(p, v);
  const vid = v ? `
    <video:video>
      <video:thumbnail_loc>${thumb(v.id, "hqdefault")}</video:thumbnail_loc>
      <video:title>${xml(v.title.slice(0, 100))}</video:title>
      <video:description>${xml((ownSummary(v, 2000) || genericDesc(v)))}</video:description>
      <video:player_loc>${ytEmbed(v.id)}</video:player_loc>${v.durationSeconds && v.durationSeconds <= 28800 ? `
      <video:duration>${v.durationSeconds}</video:duration>` : ""}${v.publishedAt ? `
      <video:publication_date>${isoDate(v.publishedAt)}</video:publication_date>` : ""}
      <video:family_friendly>yes</video:family_friendly>
      <video:uploader info="${YT_CHANNEL}">${xml(config.siteName)}</video:uploader>
    </video:video>` : "";
  return `  <url><loc>${abs(p)}</loc><lastmod>${last}</lastmod>${vid}</url>`;
}).join("\n")}
</urlset>`;
await writeFile(path.join(out, "sitemap.xml"), sitemap);

// Every crawler, search and AI alike, is welcome everywhere; the 404 page carries its own noindex.
await writeFile(path.join(out, "robots.txt"), `# ${config.siteName} (${SITE})
# All search engines and AI crawlers are welcome to index this site.
User-agent: *
Allow: /

# A plain-text guide to this site for AI assistants: ${SITE}/llms.txt
Sitemap: ${SITE}/sitemap.xml
`);

// llms.txt (llmstxt.org): a short Markdown map of the site for AI assistants; llms-full.txt lists every video.
const llmsVideo = (v) => `- [${v.title}](${abs(v.url)}): ${[fmtDuration(v.durationSeconds), v.publishedAt && fmtDate(v.publishedAt)].filter(Boolean).join(", ")}. YouTube: ${ytWatch(v.id)}`;
const llmsIntro = `# ${config.siteName}

> ${config.description}

${config.siteName} is a YouTube channel (${YT_CHANNEL}) publishing long, steady soundscapes for sleep, study, relaxation and focus: rain and thunderstorms, ocean waves, crackling fireplaces, white, pink and brown noise, nature ambience, household and machine sounds, baby sleep sounds and calm music. Many videos run 8 to 12 hours. The library has ${stats.videos} videos (${fmtNum(stats.hours)}+ hours) published since ${stats.since}, and this site lists every one of them. Each video has its own page with the embedded player and full description.

Sponsorships, brand partnerships, licensing and custom soundscape requests: ${abs("/contact/")}
`;
const llms = `${llmsIntro}
## Main pages

- [Home](${SITE}/): latest upload, categories and most played videos
- [All videos](${abs("/videos/")}): the full library, searchable and sortable
- [Categories](${abs("/categories/")}): every mood and sound type
- [Sponsorships & contact](${abs("/contact/")}): contact form for sponsorships, partnerships and licensing
- [YouTube channel](${YT_CHANNEL}): subscribe to ${config.siteName}

## Categories

${activeCats.map((c) => `- [${c.name}](${abs(`/category/${c.slug}/`)}): ${c.description} (${c.videos.length} videos)`).join("\n")}

## Latest videos

${longform.slice(0, 20).map(llmsVideo).join("\n")}

## Most played

${[...longform].sort((a, b) => b.viewCount - a.viewCount).slice(0, 10).map(llmsVideo).join("\n")}

## Optional

- [Every video, with descriptions](${abs("/llms-full.txt")})
- [Sitemap](${abs("/sitemap.xml")})
- [New videos feed (RSS)](${abs("/feed.xml")})
`;
const llmsFull = `${llmsIntro}
${activeCats.map((c) => `## ${c.name}

${c.description}
Page: ${abs(`/category/${c.slug}/`)}

${c.videos.map((v) => `### ${v.title}

- Page: ${abs(v.url)}
- YouTube: ${ytWatch(v.id)}
- ${[v.durationSeconds && `Length: ${fmtDuration(v.durationSeconds)}`, v.publishedAt && `Published: ${fmtDate(v.publishedAt)}`].filter(Boolean).join(" · ")}

${ownSummary(v, 600) || genericDesc(v)}
`).join("\n")}`).join("\n")}`;
await writeFile(path.join(out, "llms.txt"), llms);
await writeFile(path.join(out, "llms-full.txt"), llmsFull);

// RSS feed of the newest uploads, for feed readers and faster discovery.
const feedItems = videos.slice(0, 30);
await writeFile(path.join(out, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>${xml(config.siteName)}</title>
  <link>${SITE}/</link>
  <description>${xml(config.description)}</description>
  <language>en-us</language>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
  <lastBuildDate>${new Date(newest(videos)).toUTCString()}</lastBuildDate>
${feedItems.map((v) => `  <item>
    <title>${xml(v.title)}</title>
    <link>${abs(v.url)}</link>
    <guid isPermaLink="true">${abs(v.url)}</guid>
    ${v.publishedAt ? `<pubDate>${new Date(v.publishedAt).toUTCString()}</pubDate>` : ""}
    <description>${xml(ownSummary(v, 500) || genericDesc(v))}</description>
    ${v.cats.map((c) => `<category>${xml(c.name)}</category>`).join("")}
    <media:thumbnail url="${thumb(v.id)}" width="480" height="360"/>
  </item>`).join("\n")}
</channel>
</rss>
`);
const host = new URL(SITE).hostname;
if (!host.endsWith("github.io")) await writeFile(path.join(out, "CNAME"), host + "\n");
await writeFile(path.join(out, ".nojekyll"), "");

console.log(`[build] ${pages.length} pages · ${videos.length} videos · ${activeCats.length} categories · ${stats.hours} hours`);
if (uncategorized.length) console.log(`[build] ${uncategorized.length} videos matched no category (add keywords in categories.json):\n  - ` + uncategorized.map((v) => v.title).join("\n  - "));
if (!process.env.CONTACT_FORM_ENDPOINT && !config.contactForm?.endpoint) console.log("[build] note: contactForm.endpoint is empty, so the contact form will not send yet (see README).");
