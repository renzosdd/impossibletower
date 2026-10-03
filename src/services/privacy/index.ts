export type AgeGroup = 'unknown' | 'under13' | 'teen' | 'adult';
export type AdsConsent = 'unknown' | 'granted' | 'denied';

export interface PrivacyState {
  version: 1;
  ageGroup: AgeGroup;
  guardianAuthorized: boolean;
  adsConsent: AdsConsent;
  updatedAt: string | null;
}

export interface AdvertisingConsentAdapter {
  isConfigured(): boolean;
  getConsent(): AdsConsent;
  subscribe(listener: () => void): () => void;
}

export interface PrivacyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PRIVACY_STORAGE_KEY = 'impossible-tower.privacy.v1';

const initialState = (): PrivacyState => ({ version: 1, ageGroup: 'unknown', guardianAuthorized: false, adsConsent: 'unknown', updatedAt: null });

function browserStorage(): PrivacyStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}

function readState(storage?: PrivacyStorage): PrivacyState {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(PRIVACY_STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return initialState();
    const value = raw as Partial<PrivacyState>;
    if (value.version !== 1 || !['unknown', 'under13', 'teen', 'adult'].includes(String(value.ageGroup)) || !['unknown', 'granted', 'denied'].includes(String(value.adsConsent)) || typeof value.guardianAuthorized !== 'boolean') return initialState();
    return {
      version: 1,
      ageGroup: value.ageGroup!,
      guardianAuthorized: value.ageGroup === 'teen' && value.guardianAuthorized,
      adsConsent: value.ageGroup === 'adult' ? value.adsConsent! : 'unknown',
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    };
  } catch { return initialState(); }
}

export class PrivacyConsentService {
  private state: PrivacyState;
  private adapter: AdvertisingConsentAdapter | null = null;
  private detachAdapter?: () => void;
  private readonly listeners = new Set<(state: PrivacyState) => void>();

  constructor(private readonly storage: PrivacyStorage | undefined = browserStorage()) {
    this.state = readState(storage);
    if (storage && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', event => {
        if (event.key !== null && event.key !== PRIVACY_STORAGE_KEY) return;
        if (event.storageArea !== null && event.storageArea !== this.storage) return;
        this.state = readState(this.storage);
        this.notify();
      });
    }
  }

  load(): PrivacyState { return { ...this.state }; }

  saveAgeGroup(ageGroup: AgeGroup): PrivacyState {
    if (!['unknown', 'under13', 'teen', 'adult'].includes(ageGroup)) return this.load();
    const changed = ageGroup !== this.state.ageGroup;
    return this.save({ ...this.state, ageGroup, guardianAuthorized: !changed && ageGroup === 'teen' && this.state.guardianAuthorized, adsConsent: !changed && ageGroup === 'adult' ? this.state.adsConsent : 'unknown' });
  }

  saveGuardianAuthorization(authorized: boolean): PrivacyState {
    return this.save({ ...this.state, guardianAuthorized: this.state.ageGroup === 'teen' && authorized === true });
  }

  saveAdsConsent(consent: AdsConsent): PrivacyState {
    if (!['unknown', 'granted', 'denied'].includes(consent)) return this.load();
    return this.save({ ...this.state, adsConsent: this.state.ageGroup === 'adult' ? consent : 'unknown' });
  }

  revokeAdsConsent(): PrivacyState { return this.saveAdsConsent('denied'); }

  canUseOnlineServices(): boolean {
    return this.state.ageGroup === 'adult' || (this.state.ageGroup === 'teen' && this.state.guardianAuthorized);
  }

  canRequestAds(): boolean {
    if (this.state.ageGroup !== 'adult' || this.state.adsConsent !== 'granted' || !this.adapter) return false;
    try { return this.adapter.isConfigured() && this.adapter.getConsent() === 'granted'; } catch { return false; }
  }

  setAdvertisingConsentAdapter(adapter: AdvertisingConsentAdapter | null): void {
    if (adapter === this.adapter) return;
    try { this.detachAdapter?.(); } catch {}
    this.detachAdapter = undefined;
    this.adapter = adapter;
    if (adapter) {
      try { this.detachAdapter = adapter.subscribe(() => this.notify()); } catch { this.adapter = null; }
    }
    this.notify();
  }

  subscribe(listener: (state: PrivacyState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private save(value: PrivacyState): PrivacyState {
    this.state = { ...value, updatedAt: new Date().toISOString() };
    try { this.storage?.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(this.state)); } catch {}
    this.notify();
    return this.load();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener(this.load()); } catch {}
    }
  }
}

export const privacyConsent = new PrivacyConsentService();
