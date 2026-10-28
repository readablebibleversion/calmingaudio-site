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

Spam protection is built in: a hidden field that bots fill in, and a check that rejects forms submitted faster than a person could type.

## Editing categories

Edit `categories.json`. Each category has a `match` pattern that is checked against video titles. A video can be in several categories. The first match, in file order, is its main category. To force a video in or out of a category, add its YouTube id to that category's `"pin": [...]` or `"exclude": [...]`. The build log lists any video that matched no category.

## Other settings (`site.config.json`)

- `featuredVideoId`: pin a specific video in the home page “Latest upload” spot (blank means the newest).
- `hiddenVideoIds`: YouTube ids to leave off the site.

Video page URLs are saved in `data/videos.json`, so a page keeps its address even if you later rename the video on YouTube.
