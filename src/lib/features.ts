// Feature flags — controlled via environment variables.
// Set VITE_FEATURE_SMS=true in the relevant .env.*.local file to enable.

export const FEATURE_SMS = import.meta.env.VITE_FEATURE_SMS === 'true';
