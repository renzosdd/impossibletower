import type { AdProvider, AdResult } from './index';

const INITIALIZE_TIMEOUT_MS = 8_000;
const AD_TIMEOUT_MS = 120_000;
const SCRIPT_SOURCE = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

export interface GoogleH5Configuration {
  client: string;
  channel?: string;
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

  constructor(private readonly configuration: GoogleH5Configuration) {}

  initialize(): Promise<void> {
    this.initialization ??= this.initializeSDK();
    return this.initialization;
  }

  private initializeSDK(): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !isGooglePublisher(this.configuration.client)) {
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
        if (!ready && created) script?.remove();
        this.ready = ready;
        resolve();
      };
      const failed = () => finish(false);
      const timeout = setTimeout(failed, INITIALIZE_TIMEOUT_MS);
      try {
        const sdk = window as unknown as GoogleWindow;
        sdk.adsbygoogle ??= [] as Array<GoogleAdPlacement | GoogleAdConfiguration>;
        sdk.adBreak ??= (value) => { sdk.adsbygoogle?.push(value); };
        sdk.adConfig ??= (value) => { sdk.adsbygoogle?.push(value); };
        this.sdk = sdk;
        const source = `${SCRIPT_SOURCE}?client=${this.configuration.client}`;
        script = document.querySelector<HTMLScriptElement>(`script[src="${source}"]`);
        if (!script) {
          script = document.createElement('script');
          script.src = source;
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.setAttribute('data-ad-client', this.configuration.client);
          if (this.configuration.channel) script.setAttribute('data-ad-channel', this.configuration.channel);
          created = true;
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
    return this.ready && !this.active && typeof this.sdk?.adBreak === 'function';
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
          resolve(value);
        };
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
      return { success };
    } finally {
      this.active = false;
    }
  }
}
