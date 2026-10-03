import type { AdProvider, AdResult } from './index';
import { privacyConsent, type PrivacyConsentService } from '../privacy';

const INITIALIZE_TIMEOUT_MS = 8_000;
const AD_TIMEOUT_MS = 120_000;
const SCRIPT_SOURCE = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

export interface GoogleH5Configuration {
  client: string;
  channel?: string;
  privacy?: PrivacyConsentService;
  testMode?: boolean;
  deploymentContext?: 'production' | 'preview' | 'development';
}

export interface GoogleAdPlacement {
  type: 'reward';
  name: string;
  beforeReward: (showAd: () => void) => void;
  beforeAd: () => void;
  adViewed: () => void;
  adDismissed: () => void;
  afterAd: () => void;
  adBreakDone: (placement: { breakStatus: string }) => void;
}

interface GoogleAdConfiguration {
  preloadAdBreaks: 'on';
  sound: 'off';
  onReady: () => void;
}

interface GoogleWindow {
  adsbygoogle?: { push: (value: GoogleAdPlacement | GoogleAdConfiguration) => unknown };
  adBreak?: (placement: GoogleAdPlacement) => void;
  adConfig?: (configuration: GoogleAdConfiguration) => void;
}

export function isGooglePublisher(value: string): boolean {
  return /^ca-pub-\d{16}$/.test(value);
}

export class GoogleH5AdProvider implements AdProvider {
  private initialization?: Promise<void>;
  private ready = false;
  private active = false;
  private sdk: GoogleWindow | null = null;
  private readonly privacy: PrivacyConsentService;
  private ownedScript: HTMLScriptElement | null = null;
  private cancelInitialization?: () => void;
  private cancelReward?: () => void;

  constructor(private readonly configuration: GoogleH5Configuration) {
    this.privacy = configuration.privacy ?? privacyConsent;
    this.privacy.subscribe(() => {
      if (this.permissionGranted()) return;
      this.ready = false;
      this.cancelInitialization?.();
      this.initialization = undefined;
      this.cancelReward?.();
      this.ownedScript?.remove();
      this.ownedScript = null;
    });
  }

  private permissionGranted(): boolean {
    if (this.configuration.testMode && !['preview', 'development'].includes(this.configuration.deploymentContext ?? 'production')) return false;
    return this.privacy.canRequestAds();
  }

  initialize(): Promise<void> {
    if (!this.permissionGranted()) return Promise.resolve();
    if (!this.initialization) {
      const initialization = this.initializeSDK();
      this.initialization = initialization;
      void initialization.then(() => { if (this.initialization === initialization && !this.ready) this.initialization = undefined; });
    }
    return this.initialization;
  }

  private initializeSDK(): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !isGooglePublisher(this.configuration.client) || !this.permissionGranted()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      let script: HTMLScriptElement | null = null;
      let created = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        script?.removeEventListener('error', failed);
        this.ready = ready && this.permissionGranted();
        if (!this.ready && created) {
          script?.remove();
          if (this.ownedScript === script) this.ownedScript = null;
        }
        this.cancelInitialization = undefined;
        resolve();
      };
      const failed = () => finish(false);
      this.cancelInitialization = failed;
      const timeout = setTimeout(failed, INITIALIZE_TIMEOUT_MS);
      try {
        const sdk = window as unknown as GoogleWindow;
        sdk.adsbygoogle ??= [] as Array<GoogleAdPlacement | GoogleAdConfiguration>;
        sdk.adBreak ??= (value) => { sdk.adsbygoogle?.push(value); };
        sdk.adConfig ??= (value) => { sdk.adsbygoogle?.push(value); };
        this.sdk = sdk;
        const source = `${SCRIPT_SOURCE}?client=${this.configuration.client}`;
        script = document.querySelector<HTMLScriptElement>(`script[src="${source}"]`);
        if (script && (script.getAttribute('data-adbreak-test') === 'on') !== Boolean(this.configuration.testMode)) { failed(); return; }
        if (!script) {
          script = document.createElement('script');
          script.src = source;
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.setAttribute('data-ad-client', this.configuration.client);
          if (this.configuration.channel) script.setAttribute('data-ad-channel', this.configuration.channel);
          if (this.configuration.testMode) script.setAttribute('data-adbreak-test', 'on');
          created = true;
          this.ownedScript = script;
        }
        script.addEventListener('error', failed);
        sdk.adConfig({ preloadAdBreaks: 'on', sound: 'off', onReady: () => finish(true) });
        if (created && !settled) document.head.appendChild(script);
      } catch {
        failed();
      }
    });
  }

  isRewardedAvailable(): boolean {
    return this.ready && !this.active && this.permissionGranted() && typeof this.sdk?.adBreak === 'function';
  }

  async commercialBreak(_context: string): Promise<void> {}

  async rewardedAd(rewardType: string): Promise<AdResult> {
    if (!this.isRewardedAvailable()) return { success: false };
    this.active = true;
    try {
      const success = await new Promise<boolean>((resolve) => {
        let settled = false;
        let offered = false;
        let started = false;
        let viewed = false;
        let completed = false;
        let dismissed = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.cancelReward = undefined;
          resolve(value && this.permissionGranted() && !this.configuration.testMode);
        };
        this.cancelReward = () => finish(false);
        const timeout = setTimeout(() => {
          this.ready = false;
          finish(false);
        }, AD_TIMEOUT_MS);
        try {
          this.sdk?.adBreak?.({
            type: 'reward',
            name: rewardType,
            beforeReward: (showAd) => {
              if (settled || offered) return;
              if (!this.permissionGranted()) { finish(false); return; }
              offered = true;
              try { showAd(); } catch { finish(false); }
            },
            beforeAd: () => { if (!settled && offered) started = true; },
            adViewed: () => { if (!settled && started && !completed && !dismissed) viewed = true; },
            adDismissed: () => { if (!settled) dismissed = true; },
            afterAd: () => { if (!settled && started) completed = true; },
            adBreakDone: (placement) => finish(offered && started && viewed && completed && !dismissed && placement?.breakStatus === 'viewed'),
          });
        } catch {
          finish(false);
        }
      });
      return this.configuration.testMode ? { success: false, evidence: 'simulation' } : success ? { success: true, evidence: 'browser-callback' } : { success: false };
    } finally {
      this.active = false;
    }
  }
}
