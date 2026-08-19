/**
 * The Power Interview AI email layout, ported from the Jinja templates the rest of the product
 * sends through (`../backend/app/templates/*.j2.html`, vendored again in `../power-interview-email`).
 *
 * It is a port rather than a renderer: this app has no Jinja, and pulling `base.j2.html` off disk
 * would couple a Next build to a sibling Python repo's directory layout. The trade is that the two
 * copies can drift, so **if the backend template changes, change this file too** - the whole point
 * of the shared layout is that marketing mail and transactional mail read as the same product.
 *
 * Deliberately isomorphic (no `server-only`): the composer's live preview and the actual send call
 * the same function, so what an admin approves is byte-for-byte what leaves the SMTP server.
 */

import { normalizeEmailBody } from "@/lib/email/body";
import type { EmailTemplate } from "@/lib/schemas/email";

/** Paints the card's 3px top border. One value per severity template, matching the `accent` block. */
export const EMAIL_ACCENTS: Record<EmailTemplate, string> = {
  info: "#0969da",
  success: "#1a7f37",
  warning: "#9a6700",
  error: "#cf222e",
};

/** What each severity is for, shown next to the template picker. */
export const EMAIL_TEMPLATE_HINTS: Record<EmailTemplate, string> = {
  info: "Announcements, feature news, status updates",
  success: "Confirmations and completed actions",
  warning: "States that need the user's attention",
  error: "Failures and account problems",
};

/** The name the preview addresses, matching what `content.py` renders locally. */
export const PREVIEW_RECIPIENT_NAME = "John";

export interface RenderEmailOptions {
  appName: string;
  /** Recipient's display name. Rendered escaped into `Hi {name},`. */
  name: string;
  subject: string;
  /**
   * Raw HTML fragment. Injected unescaped, exactly as Jinja's `| safe` does, after
   * `normalizeEmailBody` unwraps a complete document down to a fragment.
   */
  body: string;
  template: EmailTemplate;
  /** Copyright year in the footer. Passed in so a server render and a client preview agree. */
  year: number;
}

/** Matches Jinja's `select_autoescape(["html"])` output, including the numeric quote entities. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&#34;");
}

/**
 * Builds the complete email document.
 *
 * Layout is table-based with inline styles because Outlook and several webmail clients drop
 * `<style>` blocks and cannot lay out flexbox. Keep any addition table-based and inline-styled.
 */
export function renderEmailHtml({
  appName,
  name,
  subject,
  body,
  template,
  year,
}: RenderEmailOptions): string {
  const accent = EMAIL_ACCENTS[template];
  // Jinja's `default()` only fires on an undefined variable, but the composer can hold an empty
  // subject mid-typing, and an empty <h1> is a worse preview than the placeholder the template
  // was written to show.
  const safeSubject = escapeHtml(subject || "Account notification");
  const safeTitle = escapeHtml(subject || appName);
  const safeAppName = escapeHtml(appName);
  const safeName = escapeHtml(name || "there");
  // The only rewrite this function performs, and it happens here rather than at a call site so the
  // preview and the send cannot end up with different strings. A pasted document is the one body
  // shape where the two would otherwise disagree: an HTML parser drops a nested `<html>`/`<body>`
  // without complaint, so the frame looks right while SMTP still receives the nesting.
  const fragment = normalizeEmailBody(body);

  return `<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${safeTitle}</title>
</head>

<body
    style="margin: 0; padding: 0; background-color: #f6f8fa; color: #1f2328; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
        style="background-color: #f6f8fa;">
        <tr>
            <td align="center" style="padding: 24px 12px;">

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                    style="max-width: 560px; background-color: #ffffff; border: 1px solid #d0d7de; border-top: 3px solid ${accent}; border-radius: 6px;">

                    <!-- Wordmark -->
                    <tr>
                        <td style="padding: 20px 24px 16px 24px; border-bottom: 1px solid #d0d7de;">
                            <span style="font-size: 15px; font-weight: 600; color: #1f2328; letter-spacing: -0.1px;">
                                ${safeAppName}
                            </span>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 24px;">

                            <h1
                                style="margin: 0 0 16px 0; font-size: 20px; line-height: 1.3; font-weight: 600; color: #1f2328;">
                                ${safeSubject}
                            </h1>

                            <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #1f2328;">
                                Hi ${safeName},
                            </p>

                            <div style="font-size: 14px; line-height: 1.6; color: #1f2328;">
                                ${fragment}
                            </div>

                            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: #1f2328;">
                                ${safeAppName} Team
                            </p>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 16px 24px 20px 24px; border-top: 1px solid #d0d7de; background-color: #f6f8fa; border-radius: 0 0 6px 6px;">

                            <p style="margin: 0 0 10px 0; font-size: 12px; line-height: 1.5; color: #59636e;">
                                You are receiving this message because it relates to activity on your
                                ${safeAppName} account. Need help? Reach out to us and our team will get back to
                                you.
                            </p>

                            <p style="margin: 0 0 10px 0; font-size: 12px; line-height: 1.5; color: #59636e;">
                                <a href="https://powerinterviewai.com"
                                    style="color: #0969da; text-decoration: none;">Website</a> &middot;
                                <a href="mailto:team@vectorleappulse.xyz"
                                    style="color: #0969da; text-decoration: none;">Support</a> &middot;
                                <a href="https://github.com/PowerInterviewAI/client-app"
                                    style="color: #0969da; text-decoration: none;">GitHub</a> &middot;
                                <a href="https://t.me/power_interview_ai"
                                    style="color: #0969da; text-decoration: none;">Telegram</a> &middot;
                                <a href="https://discord.gg/TJJp5azK7Z"
                                    style="color: #0969da; text-decoration: none;">Discord</a>
                            </p>

                            <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #59636e;">
                                VectorLeap Pulse Innovation LTD<br>
                                &copy; ${year} VectorLeap Pulse Innovation LTD. All rights reserved.
                            </p>

                        </td>
                    </tr>

                </table>

            </td>
        </tr>
    </table>

</body>

</html>`;
}

/**
 * Python's `str.capitalize()`, which is what backend and the bulk sender both pass as the
 * greeting. It lowercases everything after the first character, so "JohnDoe" greets as "Johndoe" -
 * reproduced rather than improved, because a marketing email that addresses someone differently
 * from every transactional email they have had would read as coming from somewhere else.
 */
export function greetingName(username: string): string {
  if (!username) return "there";
  return username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
}

/** Seeds a new campaign so the preview shows a real layout instead of an empty card. */
export const STARTER_EMAIL_BODY = `<p style="margin: 0 0 16px 0;">
  Here is what changed in Power Interview AI this month.
</p>

<ul style="margin: 0 0 16px 0; padding-left: 20px;">
  <li style="margin-bottom: 8px;">A first thing worth reading about.</li>
  <li style="margin-bottom: 8px;">A second thing worth reading about.</li>
</ul>

<p style="margin: 0 0 24px 0;">
  Everything is live now, so you can try it on your next practice run.
</p>

<p style="margin: 0;">
  <a href="https://powerinterviewai.com"
     style="display: inline-block; background-color: #0969da; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
    Open Power Interview AI
  </a>
</p>`;
