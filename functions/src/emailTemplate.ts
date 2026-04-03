import * as fs from 'fs';
import * as path from 'path';

export interface EmailVars {
  recipientName: string;
  preheader: string;
  title: string;
  /** HTML or plain-text content for the message body block. */
  message: string;
  /** Optional — omit or pass empty string to hide the team callout. */
  teamName?: string;
  /** Optional — omit or pass empty string to hide the CTA button section. */
  ctaUrl?: string;
  /** Optional — omit or pass empty string to hide the CTA button section. */
  ctaLabel?: string;
  /** Optional — HTML block injected after the message (e.g. RSVP buttons). */
  extraHtml?: string;
  /** Defaults to '#' when not provided. */
  unsubscribeUrl?: string;
  /** Defaults to '#' when not provided. */
  privacyUrl?: string;
  /** Defaults to current UTC year when not provided. */
  year?: string;
}

// Load template once at module initialisation. Cloud Functions keep the
// process warm across invocations, so this is effectively a one-time read.
const TEMPLATE_PATH = path.resolve(__dirname, '../email-templates/base-template.html');
const RAW_TEMPLATE: string = fs.readFileSync(TEMPLATE_PATH, 'utf8');

/**
 * Build a branded HTML email from the base template.
 *
 * Conditional blocks:
 *  - Team callout table is removed when `teamName` is absent or empty.
 *  - CTA button + URL fallback paragraph are removed when `ctaUrl` or
 *    `ctaLabel` is absent or empty.
 */
/**
 * Generate RSVP button HTML for email templates.
 * Buttons link directly to the rsvpEvent HTTP endpoint — no app login required.
 */
export function rsvpButtonsHtml(yesUrl: string, noUrl: string, maybeUrl: string): string {
  const btn = (label: string, url: string, bg: string) =>
    `<a href="${url}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:${bg};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;margin:0 4px;line-height:1.2;">${label}</a>`;
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:28px 0 8px;">
      <tr>
        <td align="center" style="padding:0;">
          <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#1B3A6B;text-transform:uppercase;letter-spacing:0.5px;">Can you make it?</p>
          ${btn('Yes, I\'m in', yesUrl, '#15803d')}
          ${btn('Maybe', maybeUrl, '#d97706')}
          ${btn('Can\'t make it', noUrl, '#dc2626')}
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">One tap — no login required</p>
  `;
}

export function buildEmail(vars: EmailVars): string {
  const {
    recipientName,
    preheader,
    title,
    message,
    teamName = '',
    ctaUrl = '',
    ctaLabel = '',
    extraHtml = '',
    unsubscribeUrl = '#',
    privacyUrl = '#',
    year = String(new Date().getUTCFullYear()),
  } = vars;

  let html = RAW_TEMPLATE;

  // ── Conditional: team name callout ─────────────────────────────────────────
  // The block spans from the comment through the closing </table> tag.
  // We match it by the distinctive comment the template uses.
  if (!teamName) {
    html = html.replace(
      /<!-- Team name callout \(conditional[^>]*\)[\s\S]*?<\/table>\s*\n/,
      '',
    );
  }

  // ── Conditional: CTA button + URL fallback ──────────────────────────────────
  if (!ctaUrl || !ctaLabel) {
    // Remove the CTA button table
    html = html.replace(
      /<!-- CTA Button -->[\s\S]*?<\/table>\s*\n/,
      '',
    );
    // Remove the "Or copy this link" fallback paragraph
    html = html.replace(
      /<!-- CTA URL fallback[^>]*-->[\s\S]*?<\/p>\s*\n/,
      '',
    );
  }

  // ── Variable substitution ───────────────────────────────────────────────────
  const substitutions: Record<string, string> = {
    recipientName,
    preheader,
    title,
    message,
    teamName,
    ctaUrl,
    ctaLabel,
    extraHtml,
    unsubscribeUrl,
    privacyUrl,
    year,
  };

  for (const [key, value] of Object.entries(substitutions)) {
    // Replace all occurrences of {{key}} with the resolved value.
    html = html.split(`{{${key}}}`).join(value);
  }

  return html;
}
