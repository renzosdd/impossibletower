import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrazyGamesAdProvider, createAdProvider, MockAdProvider, PokiAdProvider } from '../../src/services/ads';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function stubBrowser(sdkGlobals: Record<string, unknown>) {
  vi.stubGlobal('window', sdkGlobals);
  vi.stubGlobal('document', {
    querySelector: () => null,
    createElement: () => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      remove: vi.fn(),
    }),
    head: { appendChild: vi.fn() },
  });
}

describe('mock ad provider', () => {
  it('never grants phantom rewards during local play', async () => {
    const provider = new MockAdProvider();
    await provider.initialize();
    await expect(provider.commercialBreak('game-over')).resolves.toBeUndefined();
    expect(provider.isRewardedAvailable()).toBe(false);
    await expect(provider.rewardedAd('second-chance')).resolves.toEqual({ success: false });
  });

  it('supports explicit debug success, failure, and reset', async () => {
    const provider = new MockAdProvider();
    provider.setDebugResult(true);
    expect(provider.isRewardedAvailable()).toBe(true);
    await expect(provider.rewardedAd('second-chance')).resolves.toEqual({ success: true });
    provider.setDebugResult(false);
    expect(provider.isRewardedAvailable()).toBe(true);
    await expect(provider.rewardedAd('second-chance')).resolves.toEqual({ success: false });
    provider.setDebugResult(null);
    expect(provider.isRewardedAvailable()).toBe(false);
  });
});

describe('portal fallback', () => {
  it('selects the local provider without a browser even with a portal environment', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubEnv('VITE_PLATFORM', 'poki');
    expect(createAdProvider()).toBeInstanceOf(MockAdProvider);
  });

  it.each([
    ['poki', 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js', PokiAdProvider],
    ['crazygames', 'https://sdk.crazygames.com/crazygames-sdk-v3.js', CrazyGamesAdProvider],
  ] as const)('loads only the selected %s portal SDK', async (platform, expectedSource, Provider) => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_PLATFORM', platform);
    vi.stubGlobal('window', {});
    const sources: string[] = [];
    vi.stubGlobal('document', {
      querySelector: () => null,
      createElement: () => ({ src: '', addEventListener: vi.fn(), removeEventListener: vi.fn(), remove: vi.fn() }),
      head: { appendChild: (script: { src: string }) => sources.push(script.src) },
    });
    const provider = createAdProvider();
    expect(provider).toBeInstanceOf(Provider);
    const initialization = provider.initialize();
    await vi.advanceTimersByTimeAsync(8_000);
    await initialization;
    expect(sources).toEqual([expectedSource]);
    expect(provider.isRewardedAvailable()).toBe(false);
  });

  it.each(['standalone', 'unknown', ''])('loads no portal SDK for %s mode', async platform => {
    vi.stubEnv('VITE_PLATFORM', platform);
    stubBrowser({});
    const provider = createAdProvider();
    expect(provider).toBeInstanceOf(MockAdProvider);
    await provider.initialize();
    expect(document.head.appendChild).not.toHaveBeenCalled();
  });

  it.each([CrazyGamesAdProvider, PokiAdProvider])('fails closed without a browser', async (Provider) => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    const provider = new Provider();
    await expect(provider.initialize()).resolves.toBeUndefined();
    expect(() => { provider.loadingFinished(); provider.gameplayStart(); provider.gameplayStop(); }).not.toThrow();
    expect(provider.isRewardedAvailable()).toBe(false);
    await expect(provider.rewardedAd('double-coins')).resolves.toEqual({ success: false });
    await expect(provider.commercialBreak('game-over')).resolves.toBeUndefined();
  });

  it.each([CrazyGamesAdProvider, PokiAdProvider])('times out a missing portal SDK', async (Provider) => {
    vi.useFakeTimers();
    stubBrowser({});
    const provider = new Provider();
    const initialization = provider.initialize();
    await vi.advanceTimersByTimeAsync(8_000);
    await initialization;
    expect(provider.isRewardedAvailable()).toBe(false);
    await expect(provider.rewardedAd('double-coins')).resolves.toEqual({ success: false });
  });
});

describe('portal lifecycle', () => {
  it('maps idempotent loading and gameplay transitions to CrazyGames SDK', async () => {
    const game = { loadingStart: vi.fn(), loadingStop: vi.fn(), gameplayStart: vi.fn(), gameplayStop: vi.fn() };
    stubBrowser({ CrazyGames: { SDK: { init: () => Promise.resolve(), game, ad: { requestAd: vi.fn() } } } });
    const provider = new CrazyGamesAdProvider();
    await provider.initialize();
    expect(game.loadingStart).toHaveBeenCalledTimes(1);
    provider.loadingFinished(); provider.loadingFinished();
    provider.gameplayStart(); provider.gameplayStart();
    provider.gameplayStop(); provider.gameplayStop();
    provider.gameplayStart();
    expect(game.loadingStop).toHaveBeenCalledTimes(1);
    expect(game.gameplayStart).toHaveBeenCalledTimes(2);
    expect(game.gameplayStop).toHaveBeenCalledTimes(1);
  });

  it('maps Poki lifecycle and absorbs SDK exceptions/rejections', async () => {
    const gameLoadingFinished = vi.fn(() => { throw new Error('portal unavailable'); });
    const gameplayStart = vi.fn().mockRejectedValue(new Error('portal unavailable'));
    const gameplayStop = vi.fn();
    stubBrowser({ PokiSDK: { init: () => Promise.resolve(), rewardedBreak: () => Promise.resolve(false), commercialBreak: () => Promise.resolve(), gameLoadingFinished, gameplayStart, gameplayStop } });
    const provider = new PokiAdProvider();
    await provider.initialize();
    expect(() => {
      provider.loadingFinished(); provider.loadingFinished();
      provider.gameplayStart(); provider.gameplayStart();
      provider.gameplayStop(); provider.gameplayStop();
    }).not.toThrow();
    expect(gameLoadingFinished).toHaveBeenCalledTimes(1);
    expect(gameplayStart).toHaveBeenCalledTimes(1);
    expect(gameplayStop).toHaveBeenCalledTimes(1);
  });
});

describe('portal completion evidence', () => {
  it('grants CrazyGames rewards only after adFinished', async () => {
    let finish: (() => void) | undefined;
    stubBrowser({ CrazyGames: { SDK: {
      init: vi.fn().mockResolvedValue(undefined),
      ad: { requestAd: vi.fn((_type, callbacks) => {
        finish = callbacks.adFinished;
        return Promise.resolve();
      }) },
    } } });
    const provider = new CrazyGamesAdProvider();
    await provider.initialize();
    const result = provider.rewardedAd('second-chance');
    expect(provider.isRewardedAvailable()).toBe(false);
    finish?.();
    await expect(result).resolves.toEqual({ success: true });
    expect(provider.isRewardedAvailable()).toBe(true);
  });

  it('fails a CrazyGames request that never completes', async () => {
    vi.useFakeTimers();
    stubBrowser({ CrazyGames: { SDK: {
      init: () => Promise.resolve(),
      ad: { requestAd: () => Promise.resolve() },
    } } });
    const provider = new CrazyGamesAdProvider();
    await provider.initialize();
    const result = provider.rewardedAd('second-chance');
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(result).resolves.toEqual({ success: false });
  });

  it('uses Poki explicit reward results and absorbs rejected commercial breaks', async () => {
    const rewardedBreak = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('no fill'));
    stubBrowser({ PokiSDK: {
      init: () => Promise.resolve(),
      rewardedBreak,
      commercialBreak: () => Promise.reject(new Error('no fill')),
    } });
    const provider = new PokiAdProvider();
    await provider.initialize();
    await expect(provider.rewardedAd('second-chance')).resolves.toEqual({ success: true });
    await expect(provider.rewardedAd('second-chance')).resolves.toEqual({ success: false });
    await expect(provider.rewardedAd('second-chance')).resolves.toEqual({ success: false });
    await expect(provider.commercialBreak('game-over')).resolves.toBeUndefined();
  });
});
