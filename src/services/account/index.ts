import type { SupabaseClient } from '@supabase/supabase-js';
import type { AidId, PackId, RankingPeriod } from '../../content/economy';
import type { AccountRun, AccountSnapshot, RankingSnapshot, ReplaySubmission, RunTicket } from '../../types/account';
import { privacyConsent } from '../privacy';

async function deadline<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('La cuenta no respondió.')), 10000); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export class AccountService {
  lastError?: string;
  readonly enabled: boolean;
  constructor(private readonly client: SupabaseClient | null, enabled = import.meta.env.VITE_SERVER_ECONOMY_ENABLED === 'true') { this.enabled = enabled && !!client; }
  async request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T | null> {
    if (!this.enabled || !this.client) return null;
    try {
      const session = await deadline(this.client.auth.getSession());
      if (session.error || !session.data.session) throw new Error('Iniciá sesión para usar tu cuenta.');
      const consent = privacyConsent.load();
      const response = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.data.session.access_token}` }, body: JSON.stringify({ action, ...payload, ageGroup:consent.ageGroup, guardianAuthorized:consent.guardianAuthorized }), signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'La cuenta no respondió.');
      this.lastError = undefined;
      return body as T;
    } catch (error) { this.lastError = error instanceof Error ? error.message : 'La cuenta no respondió.'; return null; }
  }
  /** Mutations reuse the same key when a transport response is lost. */
  private async retry<T>(action:string,payload:Record<string,unknown>):Promise<T|null> {
    return await this.request<T>(action,payload) ?? await this.request<T>(action,payload);
  }
  async google(link=false):Promise<boolean>{
    if(!this.client||!this.enabled)return false;
    try{
      const options={redirectTo:location.origin+location.pathname};
      const response=link?await this.client.auth.linkIdentity({provider:'google',options}):await this.client.auth.signInWithOAuth({provider:'google',options});
      this.lastError=response.error?.message;return !response.error;
    }catch(error){this.lastError=error instanceof Error?error.message:'La cuenta no respondió.';return false;}
  }
  async signOut():Promise<boolean>{if(!this.client)return false;try{const {error}=await this.client.auth.signOut();this.lastError=error?.message;return !error;}catch(error){this.lastError=error instanceof Error?error.message:'La cuenta no respondió.';return false;}}
  buyAttempt(requestId=crypto.randomUUID()){return this.retry<AccountSnapshot>('buy-attempt',{requestId});}
  captureReferral(code:string){return this.request<{token?:string}>('capture-referral',{code});}
  claimReferral(token:string){return this.request<AccountSnapshot>('claim-referral',{token});}
  snapshot() { return this.request<AccountSnapshot>('snapshot'); }
  buyAid(id: AidId, requestId = crypto.randomUUID()) { return this.request<AccountSnapshot>('buy-aid', { id, requestId }); }
  buyCosmetic(id: string, requestId = crypto.randomUUID()) { return this.request<AccountSnapshot>('buy-cosmetic', { id, requestId }); }
  startRun(mode: 'casual' | 'daily', aids: AidId[], requestId = crypto.randomUUID(), publicName = '') { return this.retry<RunTicket>('start-run', { mode, aids, requestId, publicName }); }
  async useAid(runId: string, id: AidId, tick: number, requestId = crypto.randomUUID()) {
    const payload = { runId, id, tick, requestId };
    return await this.request<{ id: AidId; tick: number }>('use-aid', payload) ?? await this.request<{ id: AidId; tick: number }>('use-aid', payload);
  }
  finishRun(submission: ReplaySubmission) { return this.retry<AccountRun>('finish-run', { ...submission }); }
  run(runId: string) { return this.request<AccountRun>('run', { runId }); }
  doubleCoins(runId: string, intentId: string) { return this.request<AccountSnapshot>('double-coins', { runId, intentId }); }
  adIntent(reward: 'coin-bonus' | 'double-coins' | 'second-chance' | 'daily-attempt', runId?: string) { return this.retry<{ id: string; expiresAt: string }>('ad-intent', { reward, runId, provider: 'google-h5',requestId:crypto.randomUUID() }); }
  completeAd(intentId: string, viewed: boolean, evidence = 'browser-callback') { return this.retry<AccountSnapshot | RunTicket>('ad-complete', { intentId, viewed, evidence, provider: 'google-h5' }); }
  cancelAd(intentId: string) { return this.request<AccountSnapshot>('ad-cancel', { intentId }); }
  async leaderboard(period: RankingPeriod, periodKey?: string): Promise<RankingSnapshot | null> {
    if (import.meta.env.VITE_SERVER_RANKINGS_ENABLED !== 'true') return null;
    if (!(import.meta.env.VITE_RANKING_PERIODS??'daily,monthly').split(',').map((value:string)=>value.trim()).includes(period)) { this.lastError='Ese ranking todavía no está habilitado.'; return null; }
    return this.request<RankingSnapshot>('leaderboard', { period, periodKey });
  }
  async linkEmail(email: string): Promise<boolean> {
    if (!this.client || !this.enabled) return false;
    try { const { error } = await deadline(this.client.auth.updateUser({ email: email.trim() })); this.lastError = error?.message; return !error; }
    catch (error) { this.lastError = error instanceof Error ? error.message : 'La cuenta no respondió.'; return false; }
  }
  async verifyEmail(email: string, token: string, type: 'email_change' | 'email' = 'email_change'): Promise<boolean> {
    if (!this.client || !this.enabled) return false;
    try { const { error } = await deadline(this.client.auth.verifyOtp({ email: email.trim(), token: token.trim(), type })); this.lastError = error?.message; return !error; }
    catch (error) { this.lastError = error instanceof Error ? error.message : 'La cuenta no respondió.'; return false; }
  }
  async signIn(email: string): Promise<boolean> {
    if (!this.client || !this.enabled) return false;
    try { const { error } = await deadline(this.client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: location.origin } })); this.lastError = error?.message; return !error; }
    catch (error) { this.lastError = error instanceof Error ? error.message : 'La cuenta no respondió.'; return false; }
  }
  async createOrder(packId: PackId, adultConfirmed: boolean, requestId = crypto.randomUUID()): Promise<{ orderId: string; approvalUrl: string } | null> {
    return this.request('paypal-order', { packId, adultConfirmed, requestId });
  }
  captureOrder(orderId: string) { return this.request<AccountSnapshot>('paypal-capture', { orderId }); }
}
