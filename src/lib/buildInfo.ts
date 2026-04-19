// Build-time constants injected by vite.config.ts define block.
// In CI these come from GitHub Actions env vars; locally they fall back to defaults.
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_BRANCH__: string;
declare const __BUILD_PR__: string | null;
export type AppEnv = 'development' | 'staging' | 'production';

const _mode = import.meta.env.MODE;
const _env: AppEnv = _mode === 'production' ? 'production' : _mode === 'staging' ? 'staging' : 'development';

export const buildInfo = {
  version:    __APP_VERSION__,
  sha:        __BUILD_SHA__,
  time:       __BUILD_TIME__,
  branch:     __BUILD_BRANCH__,
  pr:         __BUILD_PR__,
  env:        _env,

  get isProduction(): boolean { return import.meta.env.MODE === 'production'; },
  get shortSha(): string { return __BUILD_SHA__.slice(0, 7); },
  get releaseDate(): string {
    try { return new Date(__BUILD_TIME__).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch { return __BUILD_TIME__; }
  },
  get buildTimestamp(): string {
    try { return new Date(__BUILD_TIME__).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'; }
    catch { return __BUILD_TIME__; }
  },
};
