// Feature flags — set the corresponding VITE_ env var to 'true' to enable.
export const FLAGS = {
  KIDS_MODE: import.meta.env.VITE_FEATURE_KIDS_MODE === 'true',
} as const;
