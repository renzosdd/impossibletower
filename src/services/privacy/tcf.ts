import { privacyConsent, type AdvertisingConsentAdapter, type AdsConsent, type PrivacyConsentService } from './index';

const GOOGLE_VENDOR_ID = 755;
const CONSENT_PURPOSES = [1, 3, 4];
const FLEXIBLE_PURPOSES = [2, 7, 9, 10];

export interface TcfData {
  cmpId?: number;
  cmpStatus?: string;
  cmpLoaded?: boolean;
  eventStatus?: string;
  gdprApplies?: boolean;
  tcfPolicyVersion?: number;
  isServiceSpecific?: boolean;
  tcString?: string;
  listenerId?: number;
  purpose?: { consents?: Record<number, boolean>; legitimateInterests?: Record<number, boolean> };
  vendor?: { consents?: Record<number, boolean>; legitimateInterests?: Record<number, boolean>; disclosedVendors?: Record<number, boolean> };
  publisher?: { restrictions?: Record<number, Record<number, number>> };
}

export type TcfApi = (command: 'addEventListener' | 'removeEventListener' | 'ping', version: 2, callback: (data: TcfData | boolean | undefined, success?: boolean) => void, parameter?: number) => void;

export interface TcfAdapterConfiguration {
  cmpId: number;
  certificationAttested: boolean;
  getApi?: () => TcfApi | undefined;
  timeoutMs?: number;
  pollMs?: number;
}

function browserApi(): TcfApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = (window as unknown as { __tcfapi?: TcfApi }).__tcfapi;
  return typeof api === 'function' ? api : undefined;
}

export function evaluateGoogleTcfConsent(data: TcfData | undefined, expectedCmpId: number, ping?: TcfData): AdsConsent {
  if (!data || data.cmpId !== expectedCmpId) return 'unknown';
  const ready = data.cmpStatus === 'loaded' && ['tcloaded', 'useractioncomplete'].includes(data.eventStatus ?? '');
  if (data.gdprApplies === false) {
    const minimalResponseReady = data.cmpStatus === undefined && data.eventStatus === undefined && ping?.cmpId === expectedCmpId && ping.gdprApplies === false && ping.cmpLoaded === true && ping.cmpStatus === 'loaded';
    return ready || minimalResponseReady ? 'granted' : 'unknown';
  }
  if (!ready || data.gdprApplies !== true) return 'unknown';
  if (!Number.isInteger(data.tcfPolicyVersion) || data.tcfPolicyVersion! < 5 || data.isServiceSpecific !== true || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(data.tcString ?? '') || data.vendor?.disclosedVendors?.[GOOGLE_VENDOR_ID] !== true) return 'denied';
  const restriction = (purpose: number) => data.publisher?.restrictions?.[purpose]?.[GOOGLE_VENDOR_ID];
  const consent = (purpose: number) => data.vendor?.consents?.[GOOGLE_VENDOR_ID] === true && data.purpose?.consents?.[purpose] === true;
  const legitimateInterest = (purpose: number) => data.vendor?.legitimateInterests?.[GOOGLE_VENDOR_ID] === true && data.purpose?.legitimateInterests?.[purpose] === true;
  if (!CONSENT_PURPOSES.every(purpose => (restriction(purpose) === undefined || restriction(purpose) === 1) && consent(purpose))) return 'denied';
  if (!FLEXIBLE_PURPOSES.every(purpose => {
    const required = restriction(purpose);
    if (required === 1) return consent(purpose);
    if (required === undefined || required === 2) return legitimateInterest(purpose);
    return false;
  })) return 'denied';
  return 'granted';
}

export class TcfConsentAdapter implements AdvertisingConsentAdapter {
  private consent: AdsConsent = 'unknown';
  private configured = false;
  private api?: TcfApi;
  private listenerId?: number;
  private readonly listeners = new Set<() => void>();
  private connection?: Promise<boolean>;
  private cancelConnection?: () => void;
  private disposed = false;
  private revision = 0;
  private readonly getApi: () => TcfApi | undefined;

  constructor(private readonly configuration: TcfAdapterConfiguration) {
    this.getApi = configuration.getApi ?? browserApi;
  }

  isConfigured(): boolean {
    try { return !this.disposed && this.configured && this.configuration.certificationAttested === true && typeof this.getApi() === 'function'; } catch { return false; }
  }

  getConsent(): AdsConsent { return this.isConfigured() ? this.consent : 'unknown'; }

  isDisposed(): boolean { return this.disposed; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  connect(): Promise<boolean> {
    if (this.disposed || this.configuration.certificationAttested !== true || !Number.isInteger(this.configuration.cmpId) || this.configuration.cmpId <= 0 || this.configuration.cmpId > 4095) return Promise.resolve(false);
    if (this.connection) return this.connection;
    const connection = new Promise<boolean>(resolve => {
      let settled = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      const finish = (connected: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(poll);
        this.cancelConnection = undefined;
        resolve(connected);
      };
      const timeout = setTimeout(() => finish(false), this.configuration.timeoutMs ?? 10_000);
      this.cancelConnection = () => finish(false);
      const attach = () => {
        if (settled || this.disposed) return;
        try {
          const api = this.getApi();
          if (!api) { poll = setTimeout(attach, this.configuration.pollMs ?? 250); return; }
          this.api = api;
          api('addEventListener', 2, (value, success) => {
            if (this.disposed) return;
            const revision = ++this.revision;
            const data = value && typeof value === 'object' ? value : undefined;
            if (Number.isInteger(data?.listenerId)) this.listenerId = data!.listenerId;
            if (success && data?.gdprApplies === false && data.cmpId === this.configuration.cmpId && data.cmpStatus === undefined && data.eventStatus === undefined) {
              this.configured = false;
              this.consent = 'unknown';
              this.notify();
              try {
                api('ping', 2, value => {
                  if (this.disposed || revision !== this.revision) return;
                  const ping = value && typeof value === 'object' ? value : undefined;
                  this.consent = evaluateGoogleTcfConsent(data, this.configuration.cmpId, ping);
                  this.configured = this.consent === 'granted';
                  this.notify();
                  finish(this.configured);
                });
              } catch {
                finish(false);
              }
              return;
            }
            this.configured = success === true && data?.cmpId === this.configuration.cmpId && data?.cmpStatus === 'loaded';
            this.consent = success === true ? evaluateGoogleTcfConsent(data, this.configuration.cmpId) : 'unknown';
            this.notify();
            if (!success || (data?.cmpStatus === 'loaded' && ['tcloaded', 'useractioncomplete'].includes(data.eventStatus ?? ''))) finish(this.configured);
          });
        } catch {
          this.configured = false;
          this.consent = 'unknown';
          this.notify();
          finish(false);
        }
      };
      attach();
    });
    this.connection = connection;
    void connection.then(connected => { if (!connected && !this.api && this.connection === connection) this.connection = undefined; });
    return connection;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelConnection?.();
    this.configured = false;
    this.consent = 'unknown';
    this.notify();
    if (this.api && this.listenerId !== undefined) {
      try { this.api('removeEventListener', 2, () => {}, this.listenerId); } catch {}
    }
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch {}
    }
  }
}

const configuredAdapters = new WeakMap<PrivacyConsentService, { cmpId: number; adapter: TcfConsentAdapter }>();

export function connectGoogleTcfConsent(privacy: PrivacyConsentService = privacyConsent): TcfConsentAdapter | null {
  const configured = String(import.meta.env.VITE_GOOGLE_CMP_CONFIGURED ?? '').toLowerCase() === 'true';
  const rawId = String(import.meta.env.VITE_GOOGLE_CMP_ID ?? '').trim();
  if (!configured || !/^\d{1,4}$/.test(rawId) || Number(rawId) <= 0 || Number(rawId) > 4095) {
    configuredAdapters.get(privacy)?.adapter.dispose();
    configuredAdapters.delete(privacy);
    privacy.setAdvertisingConsentAdapter(null);
    return null;
  }
  const previous = configuredAdapters.get(privacy);
  if (previous?.cmpId === Number(rawId) && !previous.adapter.isDisposed()) {
    void previous.adapter.connect();
    return previous.adapter;
  }
  previous?.adapter.dispose();
  const adapter = new TcfConsentAdapter({ cmpId: Number(rawId), certificationAttested: true });
  configuredAdapters.set(privacy, { cmpId: Number(rawId), adapter });
  privacy.setAdvertisingConsentAdapter(adapter);
  void adapter.connect();
  return adapter;
}
