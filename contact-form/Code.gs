// Calming Audio contact form forwarder (free, runs in your own Google account).
//
// Each website message is emailed to the Google account that owns this script.
// No email address is written here or anywhere on the website.
// Setup steps are in the README under "Contact form".

const SITE_NAME = "Calming Audio website";
const MAX_LEN = 5000;

function doPost(e) {
  const p = (e && e.parameter) || {};
  const clip = (s) => String(s || "").trim().slice(0, MAX_LEN);

  // Spam traps: a hidden field bots fill in, and forms sent faster than a person could type.
  const started = Number(p.started || 0);
  if (p.botcheck || (started && Date.now() - started < 3000)) return json({ success: true });

  const name = clip(p.name);
  const email = clip(p.email);
  const message = clip(p.message);
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, message: "Missing name, email or message." });
  }

  const type = clip(p.inquiry_type) || "General";
  const company = clip(p.company);
  const budget = clip(p.budget);
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
    body: body,
  });
  return json({ success: true });
}

// Lets you open the script URL in a browser to confirm it's deployed.
function doGet() {
  return json({ ok: true, info: "Calming Audio contact form endpoint. Send a POST." });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
