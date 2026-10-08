import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import type {} from '@netlify/functions';
export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export const env = (name: string) => Netlify.env.get(name);
export const enabled = (name: string) => env(name) === 'true';
export function rankingPeriods(): string[] {
  if (!enabled('SERVER_RANKINGS_ENABLED')) return [];
  const periods = (env('SERVER_RANKING_PERIODS') || 'daily,weekly,all-time,monthly').split(',').map(value => value.trim());
  if (!periods.length || periods.some(value => !['daily', 'weekly', 'all-time', 'monthly'].includes(value))) throw new ApiError(503, 'Rankings sin configurar.');
  return [...new Set(['daily', ...periods])];
}
export function required(name: string): string { const value = env(name); if (!value) throw new ApiError(503, 'Servicio sin configurar.'); return value; }
export function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export function failure(error: unknown): Response { return json({ error: error instanceof ApiError ? error.message : 'El servicio no respondió.' }, error instanceof ApiError ? error.status : 503); }
export function database(): SupabaseClient {
  return createClient(required('SUPABASE_URL'), env('SUPABASE_SECRET_KEY') || required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
}
export async function authenticate(request: Request, db: SupabaseClient): Promise<User> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ') || header.length > 10000) throw new ApiError(401, 'Iniciá sesión para usar tu cuenta.');
  const { data, error } = await db.auth.getUser(header.slice(7));
  if (error || !data.user) throw new ApiError(401, 'La sesión venció.');
  return data.user;
}
export async function rpc<T>(db: SupabaseClient, action: string, userId: string | null, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc('tower_account_api', { p_action: action, p_user: userId, p_data: payload });
  if (error) throw new ApiError(400, error.message);
  return data as T;
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 100000) throw new ApiError(413, 'Solicitud demasiado grande.');
  try { const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw new ApiError(400, 'Solicitud inválida.'); }
}
export function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
async function kickBackground(path: string): Promise<void> {
  const url = new URL(path, required('APP_URL'));
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${required('REPLAY_WORKER_SECRET')}` }, body: '{}', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Worker unavailable');
}
export const kickReplay = () => kickBackground('/api/replay-background');
export const kickSettlement = () => kickBackground('/api/settle-background');
