import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Challenge, Profile, RunResult } from '../../types';

export interface BackendConfig { url?: string; anonKey?: string; }

const REQUEST_TIMEOUT_MS = 5_000;
const SEED_PATTERN = /^[a-zA-Z0-9:_-]{1,96}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public pseudonyms only: no HTML, control characters, URLs or contact fields. */
export function sanitizePublicName(value: unknown): string {
  if (typeof value !== 'string') return 'Anónimo';
  return Array.from(value.normalize('NFKC').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim())
    .slice(0, 24).join('') || 'Anónimo';
}

export function isValidChallenge(value: unknown): value is Challenge {
  if (!value || typeof value !== 'object') return false;
  const challenge = value as Partial<Challenge>;
  return challenge.version === 1 && typeof challenge.seed === 'string' && SEED_PATTERN.test(challenge.seed)
    && typeof challenge.height === 'number' && Number.isFinite(challenge.height) && challenge.height >= 0 && challenge.height <= 5_000
    && typeof challenge.score === 'number' && Number.isInteger(challenge.score) && challenge.score >= 0 && challenge.score <= 1_000_000
    && (challenge.name === undefined || typeof challenge.name === 'string');
}

/** Same coarse plausibility bounds are enforced inside the database RPC. */
export function isPlausibleRun(run: RunResult): boolean {
  return !run.assisted && ['casual', 'daily', 'challenge'].includes(run.mode)
    && typeof run.seed === 'string' && SEED_PATTERN.test(run.seed)
    && Number.isFinite(run.height) && run.height >= 0 && run.height <= 5_000
    && Number.isInteger(run.objectsPlaced) && run.objectsPlaced >= 0 && run.objectsPlaced <= 500
    && run.height <= run.objectsPlaced * 20 + 1
    && Number.isInteger(run.score) && run.score >= 0 && run.score <= 1_000_000
    && run.score >= Math.round(run.height * 10 + run.objectsPlaced * 25)
    && run.score <= Math.round(run.height * 10 + run.objectsPlaced * 350 + 1)
    && Number.isFinite(run.duration) && run.duration >= Math.max(0.5, run.objectsPlaced * 0.65) && run.duration <= 2_400
    && Number.isInteger(run.perfectDrops) && run.perfectDrops >= 0 && run.perfectDrops <= run.objectsPlaced
    && Number.isInteger(run.maxCombo) && run.maxCombo >= 0 && run.maxCombo <= run.objectsPlaced;
}

async function withinDeadline<T>(operation: PromiseLike<T>, milliseconds = REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Backend request timed out')), milliseconds); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Aborts actual network requests too; the outer deadline also bounds auth locks. */
const timedFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const abort = () => controller.abort();
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abort);
  }
};

/** Optional companion to local storage. Failures never reject a gameplay call. */
export class BackendService {
  readonly enabled: boolean;
  lastError?: string;
  private readonly client: SupabaseClient | null;
  private initialization: Promise<void> | null = null;
  private userId: string | null = null;

  constructor(config: BackendConfig = {
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  }) {
    let client: SupabaseClient | null = null;
    if (config.url?.trim() && config.anonKey?.trim()) {
      try {
        client = createClient(config.url.trim(), config.anonKey.trim(), {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          global: { fetch: timedFetch },
        });
      } catch (error) { this.rememberError(error); }
    }
    this.client = client;
    this.enabled = client !== null;
  }

  initialize(): Promise<void> {
    if (!this.client || this.userId) return Promise.resolve();
    if (this.initialization) return this.initialization;
    const client = this.client;
    this.initialization = this.safely(async () => {
      const session = await withinDeadline(client.auth.getSession());
      if (session.error) throw session.error;
      if (session.data.session) {
        this.userId = session.data.session.user.id;
        return;
      }
      const signedIn = await withinDeadline(client.auth.signInAnonymously());
      if (signedIn.error) throw signedIn.error;
      if (!signedIn.data.user) throw new Error('Anonymous sign-in returned no user');
      this.userId = signedIn.data.user.id;
    }, undefined).finally(() => { this.initialization = null; });
    return this.initialization;
  }

  async submitRun(result: RunResult, name?: string): Promise<void> {
    if (!this.client) return;
    if (!isPlausibleRun(result)) { this.lastError = 'Run is outside ranking plausibility limits'; return; }
    await this.initialize();
    if (!this.userId) return;
    await this.safely(async () => {
      const response = await withinDeadline(this.client!.rpc('submit_run', {
        p_mode: result.mode, p_seed: result.seed, p_height: result.height, p_score: result.score,
        p_objects: result.objectsPlaced, p_perfect: result.perfectDrops, p_max_combo: result.maxCombo,
        p_duration: result.duration, p_name: sanitizePublicName(name), p_assisted: result.assisted ?? false,
      }));
      if (response.error) throw response.error;
    }, undefined);
  }

  async leaderboard(kind: 'today' | 'all-time'): Promise<{ name: string; height: number }[]> {
    if (!this.client || !['today', 'all-time'].includes(kind)) return [];
    return this.safely(async () => {
      const response = await withinDeadline(this.client!.rpc('read_leaderboard', { p_kind: kind }));
      if (response.error) throw response.error;
      if (!Array.isArray(response.data)) throw new Error('Invalid leaderboard response');
      return response.data.slice(0, 50).flatMap((row: unknown) => {
        if (!row || typeof row !== 'object') return [];
        const entry = row as { name?: unknown; height?: unknown };
        const height = Number(entry.height);
        if (typeof entry.name !== 'string' || !Number.isFinite(height) || height < 0 || height > 5_000) return [];
        return [{ name: sanitizePublicName(entry.name), height }];
      });
    }, []);
  }

  async saveChallenge(challenge: Challenge): Promise<string | null> {
    if (!this.client) return null;
    if (!isValidChallenge(challenge)) { this.lastError = 'Invalid challenge'; return null; }
    await this.initialize();
    if (!this.userId) return null;
    return this.safely(async () => {
      const response = await withinDeadline(this.client!.rpc('create_challenge', {
        p_seed: challenge.seed, p_height: challenge.height, p_score: challenge.score,
        p_name: sanitizePublicName(challenge.name),
      }));
      if (response.error) throw response.error;
      return typeof response.data === 'string' && UUID_PATTERN.test(response.data) ? response.data : null;
    }, null);
  }

  async loadChallenge(id: string): Promise<Challenge | null> {
    if (!this.client || !UUID_PATTERN.test(id)) return null;
    return this.safely(async () => {
      const response = await withinDeadline(this.client!.rpc('load_challenge', { p_id: id }));
      if (response.error) throw response.error;
      if (!isValidChallenge(response.data)) return null;
      return { ...response.data, name: sanitizePublicName(response.data.name) };
    }, null);
  }

  async syncProfile(profile: Profile): Promise<void> {
    if (!this.client) return;
    await this.initialize();
    if (!this.userId) return;
    await this.safely(async () => {
      const safeProfile = { ...profile, publicName: sanitizePublicName(profile.publicName) };
      if (safeProfile.version !== 2 || JSON.stringify(safeProfile).length > 65_536) throw new Error('Invalid cloud profile');
      const response = await withinDeadline(this.client!.rpc('sync_profile', {
        p_name: safeProfile.publicName, p_data: safeProfile,
      }));
      if (response.error) throw response.error;
    }, undefined);
  }

  private async safely<T>(action: () => Promise<T>, fallback: T): Promise<T> {
    try {
      const result = await action();
      this.lastError = undefined;
      return result;
    } catch (error) { this.rememberError(error); return fallback; }
  }

  private rememberError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message
      : error && typeof error === 'object' && 'message' in error ? String(error.message)
      : 'Backend unavailable';
  }
}
