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
  /** Defaults to '#' when not provided. */
  unsubscribeUrl?: string;
  /** Defaults to '#' when not provided. */
  privacyUrl?: string;
  /** Defaults to current UTC year when not provided. */
  year?: string;
}

// Load template once at module initialisation. Cloud Functions keep the
// process warm across invocations, so this is effectively a one-time read.
const TEMPLATE_PATH = path.resolve(__dirname, '../../email-templates/base-template.html');
const RAW_TEMPLATE: string = fs.readFileSync(TEMPLATE_PATH, 'utf8');

/**
 * Build a branded HTML email from the base template.
 *
 * Conditional blocks:
 *  - Team callout table is removed when `teamName` is absent or empty.
 *  - CTA button + URL fallback paragraph are removed when `ctaUrl` or
 *    `ctaLabel` is absent or empty.
 */
export function buildEmail(vars: EmailVars): string {
  const {
    recipientName,
    preheader,
    title,
    message,
    teamName = '',
    ctaUrl = '',
    ctaLabel = '',
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
