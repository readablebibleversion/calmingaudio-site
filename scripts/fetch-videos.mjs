// Pulls every public upload from the channel into data/videos.json.
//
// Two modes:
//   1. YOUTUBE_API_KEY set  -> official YouTube Data API v3 (recommended for CI; ~5 quota units per run).
//   2. No key               -> YouTube's public web endpoints (no setup, but can be rate-limited on cloud IPs).
//
// Existing entries are kept as a cache, so slugs (and therefore page URLs) never change
// once a video has been published on the site, even if its YouTube title is edited later.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, "site.config.json"), "utf8"));
const dataFile = path.join(root, "data", "videos.json");
const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

let previous = { videos: [] };
try { previous = JSON.parse(await readFile(dataFile, "utf8")); } catch {}
const cache = new Map(previous.videos.map((v) => [v.id, v]));

const log = (...a) => console.log("[fetch]", ...a);

// ---------- helpers ----------
function isoDurationToSeconds(iso = "") {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, d = 0, h = 0, mi = 0, s = 0] = m.map((x) => Number(x || 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n], n); }
  }));
  return out;
}

function walk(o, f) {
  if (o && typeof o === "object") { f(o); for (const k in o) walk(o[k], f); }
}

// ---------- mode 1: Data API ----------
async function api(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: API_KEY })) url.searchParams.set(k, v);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`YouTube API ${endpoint} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function fetchWithApi() {
  const ch = await api("channels", { part: "snippet,contentDetails,statistics", id: config.channelId });
  const c = ch.items?.[0];
  if (!c) throw new Error("Channel not found via API");
  const uploads = c.contentDetails.relatedPlaylists.uploads;

  const ids = [];
  let pageToken = "";
  do {
    const p = await api("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 50, ...(pageToken && { pageToken }) });
    ids.push(...p.items.map((i) => i.contentDetails.videoId));
    pageToken = p.nextPageToken || "";
  } while (pageToken);

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await api("videos", { part: "snippet,contentDetails,statistics,status", id: ids.slice(i, i + 50).join(",") });
    for (const v of batch.items) {
      if (v.status?.privacyStatus !== "public") continue;
      videos.push({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description || "",
        publishedAt: v.snippet.publishedAt,
        durationSeconds: isoDurationToSeconds(v.contentDetails.duration),
        viewCount: Number(v.statistics?.viewCount || 0),
        keywords: v.snippet.tags || [],
      });
    }
  }

  return {
    channel: {
      title: c.snippet.title,
      description: c.snippet.description,
      avatar: c.snippet.thumbnails?.high?.url || c.snippet.thumbnails?.default?.url || "",
      subscriberCount: c.statistics.hiddenSubscriberCount ? null : Number(c.statistics.subscriberCount),
      totalViews: Number(c.statistics.viewCount || 0),
    },
    videos,
  };
}

// ---------- mode 2: public web endpoints ----------
let clientVersion = "2.20261026.01.00";
async function yti(endpoint, body) {
  const r = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } }, ...body }),
  });
  if (!r.ok) throw new Error(`youtubei ${endpoint} ${r.status}`);
  return r.json();
}

async function fetchWithoutKey() {
  const page = await fetch(`https://www.youtube.com/channel/${config.channelId}`, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } }).then((r) => r.text());
  clientVersion = page.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || clientVersion;
  const meta = (p) => page.match(new RegExp(`<meta property="${p}" content="([^"]*)"`))?.[1] || "";
  const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  // The uploads playlist is the channel id with "UC" swapped for "UU".
  const playlist = "VLUU" + config.channelId.slice(2);
  const listed = [];
  const seen = new Set();
  let data = await yti("browse", { browseId: playlist });
  for (let guard = 0; guard < 200; guard++) {
    let token = null;
    walk(data, (o) => {
      const l = o.lockupViewModel;
      if (l?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && l.contentId && !seen.has(l.contentId)) {
        seen.add(l.contentId);
        listed.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content || "" });
      }
      const pv = o.playlistVideoRenderer; // older response shape
      if (pv?.videoId && !seen.has(pv.videoId)) {
        seen.add(pv.videoId);
        listed.push({ id: pv.videoId, title: pv.title?.runs?.[0]?.text || "" });
      }
      if (o.continuationCommand?.token) token = o.continuationCommand.token;
    });
    if (!token) break;
    data = await yti("browse", { continuation: token });
  }
  log(`found ${listed.length} uploads`);

  // Details are fetched for new videos, plus the 25 newest so edits to recent titles/descriptions show up.
  const refresh = new Set(listed.slice(0, 25).map((v) => v.id));
  let failures = 0;
  const videos = await pool(listed, 6, async (item) => {
    const cached = cache.get(item.id);
    if (cached && !refresh.has(item.id) && cached.description !== undefined) return cached;
    try {
      const p = await yti("player", { videoId: item.id });
      const d = p.videoDetails;
      const m = p.microformat?.playerMicroformatRenderer || {};
      if (!d) throw new Error(p.playabilityStatus?.status || "no details");
      return {
        id: item.id,
        title: d.title || item.title,
        description: d.shortDescription || "",
        publishedAt: m.publishDate || m.uploadDate || cached?.publishedAt || null,
        durationSeconds: Number(d.lengthSeconds || 0),
        viewCount: Number(d.viewCount || 0),
        keywords: d.keywords || [],
        shortsEligible: !!m.isShortsEligible,
      };
    } catch (e) {
      failures++;
      return cached || { id: item.id, title: item.title, description: "", publishedAt: null, durationSeconds: 0, viewCount: 0, keywords: [] };
    }
  });
  if (failures) log(`${failures} detail lookups failed (kept cached/basic info)`);

  return {
    channel: {
      title: decode(meta("og:title")) || previous.channel?.title || config.siteName,
      description: decode(meta("og:description")) || previous.channel?.description || "",
      avatar: meta("og:image") || previous.channel?.avatar || "",
      subscriberCount: previous.channel?.subscriberCount ?? null,
      totalViews: null,
    },
    videos,
  };
}

// ---------- slugs ----------
function slugify(title) {
  return title
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#\w+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-").slice(0, 10).join("-")
    .slice(0, 80).replace(/-+$/, "") || "video";
}

// ---------- run ----------
log(API_KEY ? "using YouTube Data API" : "no YOUTUBE_API_KEY set, using public endpoints");
let result;
try {
  result = API_KEY ? await fetchWithApi() : await fetchWithoutKey();
} catch (e) {
  if (previous.videos.length) {
    console.warn("[fetch] failed, keeping previous data:", e.message);
    process.exit(0);
  }
  throw e;
}

const used = new Set();
for (const v of previous.videos) if (v.slug) used.add(v.slug);
for (const v of result.videos) {
  const existing = cache.get(v.id)?.slug;
  if (existing) { v.slug = existing; continue; }
  let s = slugify(v.title);
  if (used.has(s)) s = `${s}-${v.id.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  used.add(s);
  v.slug = s;
}

result.videos.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
await mkdir(path.dirname(dataFile), { recursive: true });
await writeFile(dataFile, JSON.stringify({ fetchedAt: new Date().toISOString(), ...result }, null, 2));
log(`wrote ${result.videos.length} videos to data/videos.json`);
