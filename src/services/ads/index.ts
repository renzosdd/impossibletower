export interface AdResult {
  success: boolean;
}

export interface AdProvider {
  initialize(): Promise<void>;
  commercialBreak(context: string): Promise<void>;
  rewardedAd(rewardType: string): Promise<AdResult>;
  isRewardedAvailable(): boolean;
  gameplayStart?(): void;
  gameplayStop?(): void;
  loadingFinished?(): void;
}

const INITIALIZE_TIMEOUT_MS = 8_000;
const AD_TIMEOUT_MS = 120_000;

interface CrazyGamesSDK {
  init(): void | Promise<void>;
  game?: {
    gameplayStart?(): void | Promise<void>;
    gameplayStop?(): void | Promise<void>;
    loadingStart?(): void | Promise<void>;
    loadingStop?(): void | Promise<void>;
  };
  ad: {
    requestAd(
      type: 'midgame' | 'rewarded',
      callbacks: {
        adStarted: () => void;
        adFinished: () => void;
        adError: (error?: unknown) => void;
      },
    ): void | Promise<unknown>;
  };
}

interface PokiSDK {
  init(): void | Promise<void>;
  commercialBreak(): Promise<void>;
  rewardedBreak(onStart: () => void): Promise<boolean>;
  isAdBlocked?: () => boolean;
  gameplayStart?(): void | Promise<void>;
  gameplayStop?(): void | Promise<void>;
  gameLoadingFinished?(): void | Promise<void>;
}

interface PortalWindow {
  CrazyGames?: { SDK?: CrazyGamesSDK };
  PokiSDK?: PokiSDK;
}

function browserAvailable(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function portalWindow(): PortalWindow | undefined {
  return browserAvailable() ? (window as unknown as PortalWindow) : undefined;
}

function lifecycle(operation: () => void | Promise<void>): void {
  try { void Promise.resolve(operation()).catch(() => undefined); } catch { /* SDK lifecycle is optional to local play. */ }
}

/** Never lets a rejected or stalled external SDK escape into the game loop. */
function bounded<T>(operation: () => T | PromiseLike<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    try {
      Promise.resolve(operation()).then(finish, () => finish(null));
    } catch {
      finish(null);
    }
  });
}

function loadPortalScript<T>(src: string, getSDK: () => T | undefined): Promise<T | null> {
  if (!browserAvailable()) return Promise.resolve(null);
  const existingSDK = getSDK();
  if (existingSDK) return Promise.resolve(existingSDK);

  return new Promise((resolve) => {
    let script: HTMLScriptElement | null = null;
    let created = false;
    let settled = false;
    const finish = (sdk: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script?.removeEventListener('load', loaded);
      script?.removeEventListener('error', failed);
      if (!sdk && created) script?.remove();
      resolve(sdk);
    };
    const loaded = () => finish(getSDK() ?? null);
    const failed = () => finish(null);
    const timeout = setTimeout(failed, INITIALIZE_TIMEOUT_MS);
    try {
      script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
      if (!script) {
        script = document.createElement('script');
        script.src = src;
        script.async = true;
        created = true;
      }
      script.addEventListener('load', loaded);
      script.addEventListener('error', failed);
      if (created) document.head.appendChild(script);
    } catch {
      failed();
    }
  });
}

/** Local play never claims that an ad was watched. Debug mode must opt in. */
export class MockAdProvider implements AdProvider {
  private debugResult: boolean | null = null;

  async initialize(): Promise<void> {}

  async commercialBreak(_context: string): Promise<void> {}

  gameplayStart(): void {}

  gameplayStop(): void {}

  loadingFinished(): void {}

  async rewardedAd(_rewardType: string): Promise<AdResult> {
    return { success: this.debugResult === true };
  }

  isRewardedAvailable(): boolean {
    return this.debugResult !== null;
  }

  setDebugResult(success: boolean | null): void {
    this.debugResult = success;
  }
}

export class CrazyGamesAdProvider implements AdProvider {
  private sdk: CrazyGamesSDK | null = null;
  private initialization?: Promise<void>;
  private active = false;
  private gameplayActive = false;
  private loadingComplete = false;

  initialize(): Promise<void> {
    this.initialization ??= this.initializeSDK();
    return this.initialization;
  }

  private async initializeSDK(): Promise<void> {
    const sdk = await loadPortalScript(
      'https://sdk.crazygames.com/crazygames-sdk-v3.js',
      () => portalWindow()?.CrazyGames?.SDK,
    );
    if (!sdk || typeof sdk.init !== 'function') return;
    const initialized = await bounded(async () => {
      await sdk.init();
      return true;
    }, INITIALIZE_TIMEOUT_MS);
    if (initialized === true && typeof sdk.ad?.requestAd === 'function') {
      this.sdk = sdk;
      lifecycle(() => sdk.game?.loadingStart?.());
    }
  }

  gameplayStart(): void {
    if (!this.sdk || this.gameplayActive || this.active) return;
    this.gameplayActive = true;
    lifecycle(() => this.sdk?.game?.gameplayStart?.());
  }

  gameplayStop(): void {
    if (!this.sdk || !this.gameplayActive) return;
    this.gameplayActive = false;
    lifecycle(() => this.sdk?.game?.gameplayStop?.());
  }

  loadingFinished(): void {
    if (!this.sdk || this.loadingComplete) return;
    this.loadingComplete = true;
    lifecycle(() => this.sdk?.game?.loadingStop?.());
  }

  isRewardedAvailable(): boolean {
    // This means the SDK can accept a request. Inventory and eligibility are
    // decided by CrazyGames, whose adError callback fails the reward closed.
    return this.sdk !== null && !this.active;
  }

  async commercialBreak(_context: string): Promise<void> {
    await this.requestAd('midgame');
  }

  async rewardedAd(_rewardType: string): Promise<AdResult> {
    return { success: await this.requestAd('rewarded') };
  }

  private async requestAd(type: 'midgame' | 'rewarded'): Promise<boolean> {
    if (!this.isRewardedAvailable() || !this.sdk) return false;
    const sdk = this.sdk;
    this.active = true;
    try {
      const completed = await bounded(
        () => new Promise<boolean>((resolve) => {
          const request = sdk.ad.requestAd(type, {
            adStarted: () => {},
            adFinished: () => resolve(true),
            adError: () => resolve(false),
          });
          // Completion is established by adFinished; a resolved request alone
          // is not evidence that the player watched the rewarded ad.
          if (request && typeof request.then === 'function') {
            request.then(() => {}, () => resolve(false));
          }
        }),
        AD_TIMEOUT_MS,
      );
      return completed === true;
    } finally {
      this.active = false;
    }
  }
}

export class PokiAdProvider implements AdProvider {
  private sdk: PokiSDK | null = null;
  private initialization?: Promise<void>;
  private active = false;
  private gameplayActive = false;
  private loadingComplete = false;

  initialize(): Promise<void> {
    this.initialization ??= this.initializeSDK();
    return this.initialization;
  }

  gameplayStart(): void {
    if (!this.sdk || this.gameplayActive || this.active) return;
    this.gameplayActive = true;
    lifecycle(() => this.sdk?.gameplayStart?.());
  }

  gameplayStop(): void {
    if (!this.sdk || !this.gameplayActive) return;
    this.gameplayActive = false;
    lifecycle(() => this.sdk?.gameplayStop?.());
  }

  loadingFinished(): void {
    if (!this.sdk || this.loadingComplete) return;
    this.loadingComplete = true;
    lifecycle(() => this.sdk?.gameLoadingFinished?.());
  }

  private async initializeSDK(): Promise<void> {
    const sdk = await loadPortalScript(
      'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
      () => portalWindow()?.PokiSDK,
    );
    if (!sdk || typeof sdk.init !== 'function') return;
    const initialized = await bounded(async () => {
      await sdk.init();
      return true;
    }, INITIALIZE_TIMEOUT_MS);
    if (initialized === true && typeof sdk.rewardedBreak === 'function' && typeof sdk.commercialBreak === 'function') {
      this.sdk = sdk;
    }
  }

  isRewardedAvailable(): boolean {
    try {
      return this.sdk !== null && !this.active && this.sdk.isAdBlocked?.() !== true;
    } catch {
      return false;
    }
  }

  async commercialBreak(_context: string): Promise<void> {
    if (!this.sdk || this.active) return;
    const sdk = this.sdk;
    this.active = true;
    try {
      await bounded(() => sdk.commercialBreak(), AD_TIMEOUT_MS);
    } finally {
      this.active = false;
    }
  }

  async rewardedAd(_rewardType: string): Promise<AdResult> {
    if (!this.isRewardedAvailable() || !this.sdk) return { success: false };
    const sdk = this.sdk;
    this.active = true;
    try {
      const result = await bounded(() => sdk.rewardedBreak(() => {}), AD_TIMEOUT_MS);
      return { success: result === true };
    } finally {
      this.active = false;
    }
  }
}

export function createAdProvider(): AdProvider {
  if (!browserAvailable()) return new MockAdProvider();
  switch (String(import.meta.env.VITE_PLATFORM ?? '').toLowerCase()) {
    case 'crazygames': return new CrazyGamesAdProvider();
    case 'poki': return new PokiAdProvider();
    default: return new MockAdProvider();
  }
}
