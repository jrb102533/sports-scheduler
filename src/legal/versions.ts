/**
 * Single source of truth for legal document versions.
 * Increment the version here when a document changes.
 * The auth state listener compares stored user consent versions
 * against these values to determine whether re-consent is required.
 */
export const LEGAL_VERSIONS = {
  privacyPolicy: '1.1',
  termsOfService: '1.1',
  liabilityLimitations: '1.0',
  effectiveDate: '2026-04-25',
} as const;

export type LegalDocumentType = 'privacyPolicy' | 'termsOfService' | 'liabilityLimitations' | 'marketingEmail';
