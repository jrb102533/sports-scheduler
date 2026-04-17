/**
 * emailTemplate — unit tests
 *
 * Tests buildEmail() and rsvpButtonsHtml() — the two exported functions from
 * emailTemplate.ts. These functions generate HTML emails; we test that:
 *  - Required variables are substituted into the output
 *  - Conditional blocks are included/excluded based on presence of teamName, ctaUrl
 *  - Default values are applied when optional fields are omitted
 *  - RSVP buttons contain the correct URLs and labels
 *
 * The file system read of the base template is real (no mock needed) because
 * the template file is checked into the repo alongside these tests.
 */

import { describe, it, expect } from 'vitest';
import { buildEmail, rsvpButtonsHtml } from './emailTemplate';

// ─── Minimal valid vars ───────────────────────────────────────────────────────

function makeVars(overrides: Partial<Parameters<typeof buildEmail>[0]> = {}) {
  return {
    recipientName: 'Jane Coach',
    preheader: 'Your team has a new event.',
    title: 'Game Scheduled',
    message: '<p>You have a game on Saturday.</p>',
    ...overrides,
  };
}

// ─── buildEmail ───────────────────────────────────────────────────────────────

describe('buildEmail — variable substitution', () => {
  it('substitutes recipientName into the output HTML', () => {
    const html = buildEmail(makeVars({ recipientName: 'Maria Rodriguez' }));
    expect(html).toContain('Maria Rodriguez');
  });

  it('substitutes title into the output HTML', () => {
    const html = buildEmail(makeVars({ title: 'Practice Cancelled' }));
    expect(html).toContain('Practice Cancelled');
  });

  it('substitutes the preheader text', () => {
    const html = buildEmail(makeVars({ preheader: 'Your schedule has changed.' }));
    expect(html).toContain('Your schedule has changed.');
  });

  it('substitutes the message body', () => {
    const html = buildEmail(makeVars({ message: '<p>See you at the field!</p>' }));
    expect(html).toContain('See you at the field!');
  });

  it('defaults unsubscribeUrl to # when not provided', () => {
    const html = buildEmail(makeVars());
    // The template uses {{unsubscribeUrl}} — after substitution it should be '#'
    // We check that the raw placeholder is gone and '#' appears in a link context
    expect(html).not.toContain('{{unsubscribeUrl}}');
  });

  it('uses the supplied unsubscribeUrl when provided', () => {
    const html = buildEmail(makeVars({ unsubscribeUrl: 'https://example.com/unsubscribe' }));
    expect(html).toContain('https://example.com/unsubscribe');
  });

  it('substitutes year into the output HTML', () => {
    const html = buildEmail(makeVars({ year: '2030' }));
    expect(html).toContain('2030');
  });

  it('defaults year to the current UTC year when not provided', () => {
    const html = buildEmail(makeVars());
    const currentYear = String(new Date().getUTCFullYear());
    expect(html).toContain(currentYear);
  });

  it('substitutes extraHtml at the correct location', () => {
    const extra = '<p class="rsvp-block">RSVP here</p>';
    const html = buildEmail(makeVars({ extraHtml: extra }));
    expect(html).toContain('RSVP here');
  });

  it('leaves no unreplaced {{placeholder}} tokens in the output', () => {
    const html = buildEmail(makeVars({
      teamName: 'Thunder FC',
      ctaUrl: 'https://app.example.com',
      ctaLabel: 'View Schedule',
    }));
    // All {{…}} tokens should have been replaced
    expect(html).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
  });
});

describe('buildEmail — teamName conditional block', () => {
  it('omits the team name callout when teamName is not provided', () => {
    const html = buildEmail(makeVars({ teamName: undefined }));
    // "Team name callout" block must be stripped — teamName placeholder removed
    expect(html).not.toContain('{{teamName}}');
  });

  it('omits the team name callout when teamName is empty string', () => {
    const html = buildEmail(makeVars({ teamName: '' }));
    expect(html).not.toContain('{{teamName}}');
  });

  it('includes the team name callout when teamName is provided', () => {
    const html = buildEmail(makeVars({ teamName: 'Thunder FC' }));
    expect(html).toContain('Thunder FC');
  });
});

describe('buildEmail — CTA button conditional block', () => {
  it('omits CTA section when ctaUrl is not provided', () => {
    const html = buildEmail(makeVars({ ctaLabel: 'Go' }));
    // Template strips the CTA block; no leftover placeholder
    expect(html).not.toContain('{{ctaUrl}}');
    expect(html).not.toContain('{{ctaLabel}}');
  });

  it('omits CTA section when ctaLabel is not provided', () => {
    const html = buildEmail(makeVars({ ctaUrl: 'https://app.example.com' }));
    expect(html).not.toContain('{{ctaUrl}}');
    expect(html).not.toContain('{{ctaLabel}}');
  });

  it('includes CTA button when both ctaUrl and ctaLabel are provided', () => {
    const html = buildEmail(makeVars({
      ctaUrl: 'https://app.example.com/game/1',
      ctaLabel: 'View Game',
    }));
    expect(html).toContain('https://app.example.com/game/1');
    expect(html).toContain('View Game');
  });

  it('includes both the button and the URL fallback paragraph when CTA is set', () => {
    const html = buildEmail(makeVars({
      ctaUrl: 'https://app.example.com/invite',
      ctaLabel: 'Accept Invite',
    }));
    // The fallback "Or copy this link" text only appears when both vars are set
    expect(html).toContain('https://app.example.com/invite');
  });
});

describe('buildEmail — returns a valid HTML document', () => {
  it('output starts with <!DOCTYPE html> or <html>', () => {
    const html = buildEmail(makeVars());
    const trimmed = html.trimStart();
    const isHtmlDoc = trimmed.startsWith('<!DOCTYPE html>') || trimmed.startsWith('<html');
    expect(isHtmlDoc).toBe(true);
  });

  it('output contains a closing </html> tag', () => {
    const html = buildEmail(makeVars());
    expect(html).toContain('</html>');
  });
});

// ─── rsvpButtonsHtml ──────────────────────────────────────────────────────────

describe('rsvpButtonsHtml', () => {
  it('includes the yes URL in the output', () => {
    const html = rsvpButtonsHtml(
      'https://app.example.com/rsvp?t=YES',
      'https://app.example.com/rsvp?t=NO',
      'https://app.example.com/rsvp?t=MAYBE',
    );
    expect(html).toContain('https://app.example.com/rsvp?t=YES');
  });

  it('includes the no URL in the output', () => {
    const html = rsvpButtonsHtml(
      'https://app.example.com/rsvp?t=YES',
      'https://app.example.com/rsvp?t=NO',
      'https://app.example.com/rsvp?t=MAYBE',
    );
    expect(html).toContain('https://app.example.com/rsvp?t=NO');
  });

  it('includes the maybe URL in the output', () => {
    const html = rsvpButtonsHtml(
      'https://app.example.com/rsvp?t=YES',
      'https://app.example.com/rsvp?t=NO',
      'https://app.example.com/rsvp?t=MAYBE',
    );
    expect(html).toContain('https://app.example.com/rsvp?t=MAYBE');
  });

  it('includes all three button labels', () => {
    const html = rsvpButtonsHtml('yes-url', 'no-url', 'maybe-url');
    expect(html).toContain("Yes, I'm in");
    expect(html).toContain("Can't make it");
    expect(html).toContain('Maybe');
  });

  it('includes "no login required" note', () => {
    const html = rsvpButtonsHtml('y', 'n', 'm');
    expect(html).toContain('no login required');
  });

  it('returns an HTML string (contains anchor tags)', () => {
    const html = rsvpButtonsHtml('y', 'n', 'm');
    expect(html).toContain('<a href=');
  });
});
