# Calming Audio website

A fast static website for the Calming Audio YouTube channel. It pulls every upload automatically, gives each video its own search-friendly page, sorts videos into categories, and includes a sponsorship contact form.

No frameworks and no `npm install`. You only need Node 20 or newer.

## Run it locally

```bash
npm run update   # pull the latest videos from YouTube, then build
npm run dev      # build and preview at http://localhost:4173
```

## What gets built

| Page | What it's for |
| --- | --- |
| `/` | Home: hero, latest upload, categories, recent and most-played videos, sponsor pitch |
| `/videos/` | Every video, with search, sort and category filters |
| `/categories/` and `/category/<name>/` | One crawlable page per category |
| `/watch/<video-name>/` | One page per video: embedded player, title linked to YouTube, full description, related videos |
| `/contact/` | Sponsorship and contact form |
| `sitemap.xml` | Includes Google video-sitemap data for every video page |
| `robots.txt` | Lets every search engine and AI crawler in, and points to the sitemap |
| `llms.txt`, `llms-full.txt` | Plain-text guides to the site and every video for AI assistants ([llmstxt.org](https://llmstxt.org)) |
| `feed.xml` | RSS feed of the 30 newest videos |

Every page has a unique title and meta description, a canonical URL, Open Graph and Twitter card tags, and robots directives that allow large image and video previews. Pages also carry structured data: `Organization` and `WebSite` on the home page, `CollectionPage` with `ItemList` on list pages, `ContactPage`, `BreadcrumbList` everywhere, and `VideoObject` on each video page, so Google can show it as a video result and credit your site for it. Meta descriptions skip the boilerplate repeated across YouTube descriptions, so no two pages share a snippet.

After the site goes live, add `calmingaudio.com` to [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters), and submit `https://calmingaudio.com/sitemap.xml` in both.

## Going live on calmingaudio.com (GitHub Pages, $0/month)

The site is just files, so it doesn't need paid hosting. GitHub Pages hosts it for free, runs the automatic YouTube updates for free, and provides the HTTPS certificate. The only ongoing cost is your domain renewal.

1. Create a free GitHub account and a **public** repository (free Pages requires public), then upload this folder to its `main` branch. Nothing private is in these files.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Open **Settings → Secrets and variables → Actions** and add:
   - `CONTACT_FORM_ENDPOINT`: the Google script URL from the contact form steps below.
   - `YOUTUBE_API_KEY` (optional, not needed): new uploads appear automatically without it. A YouTube Data API v3 key only adds refreshed descriptions and play counts for older videos.
4. In **Settings → Pages → Custom domain**, enter `calmingaudio.com` and save.
5. At your DNS host (currently SiteGround: Site Tools → Domain → DNS Zone Editor), change **only** these records:
   - Replace the `A` record for `calmingaudio.com` with four A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Set `www` to a `CNAME` pointing at `<your-github-username>.github.io`
   - **Leave the MX records alone**, so any @calmingaudio.com email keeps working.
6. After DNS updates (minutes to a few hours), tick **Enforce HTTPS** in Settings → Pages.

After that, the workflow in `.github/workflows/deploy.yml` checks YouTube every 6 hours. New uploads appear on the site without you doing anything. You can also run it by hand from the **Actions** tab.

**About SiteGround:** once the new site is live you can drop the SiteGround hosting plan. Check first whether you use @calmingaudio.com email boxes or registered the domain there, because cancelling would affect those. If so, move the domain and email first, for example to Cloudflare Registrar (at-cost domain renewals) with free Cloudflare Email Routing that forwards @calmingaudio.com mail to Gmail.

Cloudflare Pages and Netlify also host this for free. Use build command `npm run update` and output folder `dist`.

## Contact form (free, Google Apps Script)

The form sends each message to a small script that runs in your own Google account. The script emails the message to that same account, with **Reply-To** set to the sender so you can answer with one click. It's free (about 100 emails a day), and no email address appears in the website or in this repository.

1. Sign in to Google with the account that should receive messages, then open <https://script.google.com> → **New project**.
2. Delete the sample code, paste in everything from `contact-form/Code.gs`, and save.
3. Click **Deploy → New deployment**. Under "Select type" (gear icon) pick **Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**.
4. Google asks you to authorize the script, since it sends email as you. Click **Advanced → Go to (project name)** and allow it. This warning appears for any personal script.
5. Copy the **Web app URL** (it ends in `/exec`). Add it as the `CONTACT_FORM_ENDPOINT` repository secret, or paste it into `site.config.json` → `contactForm.endpoint`.

Until the URL is set, the form shows a friendly "not connected yet" message instead of sending. If you later edit the script, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

Spam and abuse protection is built into the script, which checks every request itself because anyone can call its URL directly:

- a hidden field that bots fill in, and a check that rejects forms sent faster than a person could type (or with no start time)
- rate limits: 3 messages per sender address per hour, 20 per hour in total, 60 per day, so nobody can flood your inbox or use up Google's daily email allowance
- fields are cut to fixed lengths, line breaks are stripped from the name, email and company (so nobody can add email headers), and the topic and budget must be one of the form's own choices
- messages are emailed as plain text, so nothing in them can run in your inbox

Blocked and failed requests are logged under **Executions** in the Apps Script editor.

## Security

The site is static: no database, no logins, no passwords and no server code on calmingaudio.com, which removes most ways in. On top of that:

- **Content Security Policy** in every page (`securityMeta()` in `scripts/build.mjs`). Browsers only run this site's own script, only load YouTube, Google Fonts and the contact-form endpoint, and refuse anything injected. If you add a new embed or service, add its domain there or it will be blocked. Don't add inline `onclick=""`-style handlers; put the code in `src/assets/app.js`.
- **No secrets in the code.** `YOUTUBE_API_KEY` (optional) and `CONTACT_FORM_ENDPOINT` are GitHub repository secrets. The contact-form URL ends up in the public page by design; the rate limits above are what protect it. GitHub secret scanning and push protection are on, so a key pushed by mistake is blocked.
- **Locked-down deploys.** The workflow has no permissions by default, each job gets only what it needs, and every action is pinned to an exact commit.
- **HTTPS** is enforced by GitHub Pages and Cloudflare. HTTP security headers that a `<meta>` tag can't set (HSTS, framing protection) go in Cloudflare: see the security report.
- `npm run dev` only listens on this computer and never serves files outside `dist/`.

## Interactive states

Each interactive widget in `src/assets/app.js` is a small explicit state machine built with the `machine()` helper. Its current state is always on the element as `data-state`, so CSS, tests and AI agents can read it, and a widget only accepts the moves its current state allows.

| Widget | Element | States |
| --- | --- | --- |
| Mobile menu | `[data-header]` | `closed` ⇄ `open` (closes on link click, Escape, or widening past mobile) |
| Contact form | `[data-contact]` | `idle`, `invalid`, `unconfigured`, `sending` → `sent` (final) or `failed`. Submits during `sending`/`sent` are ignored, so a message is never sent twice; requests time out after 20 seconds |
| Description | `[data-desc]` | `short` (fits, no toggle), or `collapsed` ⇄ `expanded` |
| Share button | `[data-share]` | `idle` → `sharing` → `copied` / `failed` → `idle` |
| Home video | `.lite-yt` | `poster` → `playing` |

The video library keeps its view (`filter`, `q`, `sort`) in the URL as `?c=&q=&sort=`, so any filtered view can be bookmarked or shared, and mirrors it to `data-view-filter`, `data-view-q`, `data-view-sort` and `data-view-shown` on `[data-library]`.

## Editing categories

Edit `categories.json`. Each category has a `match` pattern that is checked against video titles. A video can be in several categories. The first match, in file order, is its main category. To force a video in or out of a category, add its YouTube id to that category's `"pin": [...]` or `"exclude": [...]`. The build log lists any video that matched no category.

## Other settings (`site.config.json`)

- `featuredVideoId`: pin a specific video in the home page “Latest upload” spot (blank means the newest).
- `hiddenVideoIds`: YouTube ids to leave off the site.
- `app.appStoreUrl`: paste the Sleep Globes App Store link here when the app goes live. Every "Coming soon to iPhone" button turns into "Download on the App Store".

The Sleep Globes privacy, terms and support pages (`/privacy/`, `/terms/`, `/support/`) are written in `scripts/build.mjs`. The app links to those exact addresses, so keep the paths.

The separate free Moonhum app has a landing page at `/moonhum/` (its App Store link is `site.config.json` → `moonhum.appStoreUrl`; screenshots are in `src/assets/moonhum/`) and its own pages at `/moonhum/privacy/` and `/moonhum/support/`, also in `scripts/build.mjs`. App Store Connect links to them and Moonhum's App Privacy answer is "Data Not Collected", so update that policy if the app ever starts collecting anything. Moonhum is free, so it needs no terms page.

The SkyCalm fear-of-flying app has a landing page at `/skycalm/` (App Store link in `site.config.json` → `skycalm.appStoreUrl`; screenshots are in `src/assets/skycalm/`). Its privacy, terms and support pages live on its own site, skycalm.net (`skycalm.site`), so the site links there instead of hosting copies.

Video page URLs are saved in `data/videos.json`, so a page keeps its address even if you later rename the video on YouTube.
