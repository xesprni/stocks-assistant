export type AuthTokens = { access_token: string; refresh_token: string };

export class AuthExpiredError extends Error {}

export class AuthSessionChangedError extends Error {
  constructor() {
    super("Authentication session changed");
    this.name = "AbortError";
  }
}

export function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Owns identity lifetime; token rotation within that identity does not change its generation. */
export class AuthSessionManager {
  private lifetime = new AbortController();
  private revision = 0;
  private tokens: AuthTokens;
  private refresh: Promise<void> | null = null;
  private recovery: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly options: {
    initial: AuthTokens;
    persist: (tokens: AuthTokens) => void;
    refresh: (refreshToken: string, signal: AbortSignal) => Promise<AuthTokens>;
    onExpired: (message: string) => void;
  }) {
    this.tokens = options.initial;
  }

  get generation() { return this.revision; }
  get signal() { return this.lifetime.signal; }
  get accessToken() { return this.tokens.access_token; }
  get refreshToken() { return this.tokens.refresh_token; }

  assertCurrent(generation: number) {
    if (generation !== this.revision) throw new AuthSessionChangedError();
  }

  replace(tokens: AuthTokens) {
    this.lifetime.abort(new AuthSessionChangedError());
    this.lifetime = new AbortController();
    this.revision += 1;
    this.rejectRecovery("Authentication session changed");
    this.recovery = null;
    this.refresh = null;
    this.commit(tokens);
  }

  clear() { this.replace({ access_token: "", refresh_token: "" }); }

  /** Only the same-account reauthentication flow may resume existing requests. */
  restore(tokens: AuthTokens, generation: number) {
    this.assertCurrent(generation);
    this.commit(tokens);
    this.resolveRecovery();
  }

  private commit(tokens: AuthTokens) {
    this.tokens = tokens;
    this.options.persist(tokens);
  }

  resolveRecovery() { this.recovery?.resolve(); }
  rejectRecovery(message = "Authentication required") { this.recovery?.reject(new Error(message)); }

  private recover(message: string): Promise<void> {
    if (!this.recovery) {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
      const recovery = { promise, resolve, reject };
      this.recovery = recovery;
      // Clear only our own deferred; an old completion cannot clear a newer recovery.
      promise.then(() => {
        if (this.recovery === recovery) this.recovery = null;
      }, () => {
        if (this.recovery === recovery) this.recovery = null;
      });
      this.options.onExpired(message);
    }
    return this.recovery!.promise;
  }

  async authorizeRetry(generation: number, rejectedAccessToken: string, signal: AbortSignal) {
    this.assertCurrent(generation);
    signal.throwIfAborted();
    // Another request may already have rotated the token before this 401 arrived.
    if (this.accessToken && this.accessToken !== rejectedAccessToken) return;
    if (!this.refresh) {
      const refreshToken = this.refreshToken;
      const lifetime = this.signal;
      const refresh = (async () => {
        try {
          if (!refreshToken) throw new AuthExpiredError("Authentication required");
          const next = await this.options.refresh(refreshToken, lifetime);
          this.assertCurrent(generation);
          this.commit(next);
        } catch (error) {
          this.assertCurrent(generation);
          if (!(error instanceof AuthExpiredError)) throw error;
          // Expiry clears credentials, but preserves identity for same-account recovery.
          this.commit({ access_token: "", refresh_token: "" });
          await waitWithSignal(this.recover(error.message), lifetime);
          this.assertCurrent(generation);
        }
      })();
      this.refresh = refresh;
      refresh.then(() => {
        if (this.refresh === refresh) this.refresh = null;
      }, () => {
        if (this.refresh === refresh) this.refresh = null;
      });
    }
    await waitWithSignal(this.refresh, signal);
    this.assertCurrent(generation);
  }
}
