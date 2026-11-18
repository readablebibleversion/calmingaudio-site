// Calming Audio contact form forwarder (free, runs in your own Google account).
//
// Each website message is emailed to the Google account that owns this script.
// No email address is written here or anywhere on the website.
// Setup steps are in the README under "Contact form". After editing this file, publish it with
// Deploy → Manage deployments → Edit → Version: New version, so the website URL stays the same.
//
// Everything below is checked here on the server, because anyone can send a request to this URL
// without using the website's form.

const SITE_NAME = "Calming Audio website";

// Longest value accepted for each field (characters). Longer values are cut.
const LIMITS = { name: 100, email: 254, company: 120, message: 5000 };

// Only the choices the website's form offers are accepted.
const INQUIRY_TYPES = {
  sponsorship: "Sponsorship",
  partnership: "Brand partnership",
  licensing: "Licensing",
  custom: "Custom soundscape",
  press: "Press",
  other: "Something else",
};
const BUDGETS = ["", "Under $500", "$500 – $2,000", "$2,000 – $5,000", "$5,000+"];

// Rate limits, so a bot can't flood your inbox or use up Google's ~100 emails a day.
const MAX_PER_EMAIL_PER_HOUR = 3;  // messages from one sender address
const MAX_TOTAL_PER_HOUR = 20;     // messages from everyone combined
const MAX_TOTAL_PER_DAY = 60;

function doPost(e) {
  try {
    return handle((e && e.parameter) || {});
  } catch (err) {
    console.error("Contact form error: " + err); // visible under Executions in the Apps Script editor
    return json({ success: false, message: "Something went wrong. Please try again later." });
  }
}

function handle(p) {
  // Spam traps: a hidden field bots fill in, and forms sent faster than a person could type.
  // "started" is set by the website when the page loads. Missing or impossible values are treated as bots.
  const started = Number(p.started);
  const age = Date.now() - started;
  if (p.botcheck || !started || age < 3000 || age > 24 * 60 * 60 * 1000) {
    console.warn("Contact form: blocked by spam trap");
    return json({ success: true }); // don't tell bots they were caught
  }

  const name = oneLine(p.name, LIMITS.name);
  const email = oneLine(p.email, LIMITS.email).toLowerCase();
  const company = oneLine(p.company, LIMITS.company);
  const message = clean(p.message, LIMITS.message);
  const type = INQUIRY_TYPES[p.inquiry_type] || INQUIRY_TYPES.other;
  const budget = BUDGETS.indexOf(String(p.budget || "")) >= 0 ? String(p.budget || "") : "";

  if (!name || !message || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/.test(email)) {
    return json({ success: false, message: "Missing name, email or message." });
  }

  if (!allowed(email)) {
    console.warn("Contact form: rate limit reached");
    return json({ success: false, message: "Too many messages right now. Please try again in an hour." });
  }

  const subject = `[${SITE_NAME}] ${type}${company ? " from " + company : ""}: ${name}`;
  const details = [
    `Type:     ${type}`,
    `Name:     ${name}`,
    `Email:    ${email}`,
    company ? `Company:  ${company}` : null,
    budget ? `Budget:   ${budget}` : null,
  ].filter(Boolean).join("\n");
  const body = `${details}\n\n${message}\n\n(Reply to this email to answer them directly.)`;

  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    replyTo: email,
    name: SITE_NAME,
    subject: subject,
    body: body, // plain text only, so nothing in a message can run as HTML in your inbox
  });
  return json({ success: true });
}

// Counts recent messages and refuses once a limit is reached. The lock stops two requests racing past a limit.
function allowed(email) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const cache = CacheService.getScriptCache();
    const hour = Math.floor(Date.now() / 3600000);
    const day = Math.floor(hour / 24);
    const keys = {
      // The sender is stored only as a hash, never as their address.
      sender: "s:" + hour + ":" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email)),
      hour: "h:" + hour,
    };
    const counts = cache.getAll(Object.values(keys));
    const n = (k) => Number(counts[keys[k]] || 0);
    // The daily count lives in script properties, because cache entries expire after at most 6 hours.
    const props = PropertiesService.getScriptProperties();
    const saved = String(props.getProperty("daily") || "").split(":");
    const today = Number(saved[0]) === day ? Number(saved[1]) || 0 : 0;
    if (n("sender") >= MAX_PER_EMAIL_PER_HOUR || n("hour") >= MAX_TOTAL_PER_HOUR || today >= MAX_TOTAL_PER_DAY) return false;
    cache.putAll({ [keys.sender]: String(n("sender") + 1), [keys.hour]: String(n("hour") + 1) }, 3600);
    props.setProperty("daily", day + ":" + (today + 1));
    return true;
  } finally {
    lock.releaseLock();
  }
}

// Removes control characters and cuts to length. oneLine also removes line breaks, so nobody can
// add extra email headers through the name, email or company fields.
function clean(s, max) {
  return String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}
function oneLine(s, max) {
  return clean(String(s || "").replace(/[\r\n\t]+/g, " "), max);
}

// Lets you open the script URL in a browser to confirm it's deployed.
function doGet() {
  return json({ ok: true, info: "Calming Audio contact form endpoint. Send a POST." });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
