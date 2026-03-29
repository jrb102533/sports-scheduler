/** Minimal mock of firebase-functions/v2/https for unit tests. */
export class HttpsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpsError';
  }
}
