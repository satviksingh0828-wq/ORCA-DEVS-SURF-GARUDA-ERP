const FOOTER =
  '<a href="https://orca.devs.surf" style="color:inherit;text-decoration:none">POWERED BY ORCA DEVS SURF</a>';
const EMAIL_LOGO_CONTENT_ID = "garuda-logo";
const AUDIT_BCC_EMAIL = "satvik.singh.0828@gmail.com";
export const PRIYANSHI_EMAIL = "priyanshi@garudalogistics.in";

export type EmailAttachment = {
  filename: string;
  content: string;
  content_id?: string;
};

export function primaryAdminAlertEmail(): string | null {
  const email = process.env.ADMIN_ALERT_EMAIL?.trim();
  return email || null;
}

function emailLogoUrl(): string {
  const configuredUrl = process.env.EMAIL_LOGO_URL?.trim();
  if (configuredUrl) return configuredUrl;

  const appUrl =
    process.env.APP_URL?.trim() ||
    (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : "");
  if (!appUrl) return "";

  return new URL("/garuda-logo.png", appUrl).toString();
}

export function adminAlertEmails(): string[] {
  return [
    ...new Set(
      [process.env.ADMIN_2_ALERT_EMAIL]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim()),
    ),
  ];
}

export function resolveEmailRecipients(options: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
}) {
  const primaryAdmin = primaryAdminAlertEmail();
  const normalizedPrimary = primaryAdmin?.toLowerCase();
  const isPrimaryAdmin = (email: string) => email.toLowerCase() === normalizedPrimary;
  let to = [...new Set(options.to.filter(Boolean))].filter((email) => !isPrimaryAdmin(email));
  const cc = [...new Set([...(options.cc ?? []), PRIYANSHI_EMAIL].filter(Boolean))].filter(
    (email) => !to.includes(email) && !isPrimaryAdmin(email),
  );
  const bcc = [AUDIT_BCC_EMAIL].filter((email) => !to.includes(email) && !cc.includes(email));
  if (!to.length) {
    const fallbackRecipient =
      options.from ?? process.env.NOTIFIER_EMAIL ?? process.env.ALERT_FROM_EMAIL;
    if (fallbackRecipient) to = [fallbackRecipient];
  }
  return { to, cc, bcc };
}

export function emailTemplate(options: {
  title: string;
  eyebrow?: string;
  intro: string;
  content: string;
  accent?: string;
  notice?: string;
}): string {
  const accent = options.accent ?? "#4f46e5";
  const logoUrl = emailLogoUrl();
  const logo = logoUrl
    ? `<img src="${logoUrl}" width="68" alt="Garuda Logistics Solutions" style="display:block;width:68px;height:auto;margin:0 auto 10px">`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.08)">
<tr><td style="height:6px;background:${accent}"></td></tr>
<tr><td align="center" style="padding:24px 34px 18px;border-bottom:1px solid #e2e8f0">${logo}<div style="font-size:18px;font-weight:800;letter-spacing:.04em;color:#0f172a">GARUDA LOGISTICS SOLUTIONS</div><div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin-top:5px">Operations &amp; Transport Management</div></td></tr>
<tr><td style="padding:30px 34px 12px">
${options.eyebrow ? `<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:9px">${options.eyebrow}</div>` : ""}
<h1 style="font-size:23px;line-height:1.25;margin:0 0 12px;color:#0f172a">${options.title}</h1>
<p style="font-size:14px;line-height:1.65;color:#475569;margin:0">${options.intro}</p></td></tr>
<tr><td style="padding:12px 34px 26px">${options.content}
${options.notice ? `<p style="font-size:12px;line-height:1.55;color:#64748b;margin:20px 0 0;padding:12px 14px;background:#f8fafc;border-radius:8px">${options.notice}</p>` : ""}
</td></tr>
<tr><td align="center" style="padding:17px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:10px;letter-spacing:.18em;font-weight:700;color:#64748b">${FOOTER}</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendResendEmail(options: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  from?: string;
  idempotencyKey?: string;
  attachments?: EmailAttachment[];
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const { to, cc, bcc } = resolveEmailRecipients(options);
  if (!apiKey || !to.length) throw new Error("Email service or recipients are not configured");

  // Email clients commonly block or proxy remote images. Attach the logo inline
  // when it is reachable so the branding renders independently of that policy.
  const logoUrl = emailLogoUrl();
  let html = options.html;
  const attachments: EmailAttachment[] = [...(options.attachments ?? [])];
  if (logoUrl && html.includes(logoUrl)) {
    try {
      const logoResponse = await fetch(logoUrl);
      if (logoResponse.ok) {
        const content = Buffer.from(await logoResponse.arrayBuffer()).toString("base64");
        attachments.push({
          filename: "garuda-logo.png",
          content,
          content_id: EMAIL_LOGO_CONTENT_ID,
        });
        html = html.replaceAll(logoUrl, `cid:${EMAIL_LOGO_CONTENT_ID}`);
      }
    } catch (logoError) {
      console.error("[email] Could not embed logo; using the hosted image instead:", logoError);
    }
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from:
        options.from ??
        process.env.NOTIFIER_EMAIL ??
        process.env.ALERT_FROM_EMAIL ??
        "onboarding@resend.dev",
      to,
      ...(cc.length ? { cc } : {}),
      bcc,
      subject: options.subject,
      html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${await response.text()}`);
}
