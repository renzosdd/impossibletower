import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdProvider, GoogleH5AdProvider, MockAdProvider } from '../../src/services/ads';
import { type GoogleAdPlacement } from '../../src/services/ads/googleH5';
import { PrivacyConsentService } from '../../src/services/privacy';

const CLIENT = 'ca-pub-1234567890123456';

function allowedPrivacy() {
  const privacy = new PrivacyConsentService(undefined);
  privacy.saveAgeGroup('adult');
  privacy.saveAdsConsent('granted');
  privacy.setAdvertisingConsentAdapter({ isConfigured: () => true, getConsent: () => 'granted', subscribe: () => () => {} });
  return privacy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function browser() {
  let ready: (() => void) | undefined;
  let placement: GoogleAdPlacement | undefined;
  const script = {
    src: '', async: false, crossOrigin: '',
    setAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), remove: vi.fn(),
  };
  const sdk = {
    adConfig: vi.fn((config: { onReady: () => void }) => { ready = config.onReady; }),
    adBreak: vi.fn((value: GoogleAdPlacement) => { placement = value; }),
  };
  const appendChild = vi.fn();
  vi.stubGlobal('window', sdk);
  vi.stubGlobal('document', { querySelector: () => null, createElement: () => script, head: { appendChild } });
  return { sdk, script, appendChild, ready: () => ready?.(), placement: () => placement! };
}

async function initialized() {
  const stub = browser();
  const provider = new GoogleH5AdProvider({ client: CLIENT, channel: '1234', privacy: allowedPrivacy() });
  const initialization = provider.initialize();
  stub.ready();
  await initialization;
  return { ...stub, provider };
}

function viewed(placement: GoogleAdPlacement, status = 'viewed') {
  placement.beforeReward(() => placement.beforeAd());
  placement.adViewed();
  placement.afterAd();
  placement.adBreakDone({ breakStatus: status });
}

describe('Google H5 readiness', () => {
  it.each(['unknown', 'under13', 'teen'] as const)('does not load scripts for age group %s', async ageGroup => {
    const stub = browser();
    const privacy = allowedPrivacy();
    privacy.saveAgeGroup(ageGroup);
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy });
    await provider.initialize();
    expect(stub.appendChild).not.toHaveBeenCalled();
    expect(stub.sdk.adConfig).not.toHaveBeenCalled();
  });

  it('does not initialize for adult opt-in without a CMP, and retries after its configuration', async () => {
    const stub = browser();
    const privacy = new PrivacyConsentService(undefined);
    privacy.saveAgeGroup('adult'); privacy.saveAdsConsent('granted');
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy });
    await provider.initialize();
    expect(stub.appendChild).not.toHaveBeenCalled();
    privacy.setAdvertisingConsentAdapter({ isConfigured: () => true, getConsent: () => 'granted', subscribe: () => () => {} });
    const next = provider.initialize();
    stub.ready(); await next;
    expect(provider.isRewardedAvailable()).toBe(true);
  });

  it('blocks test mode in production rather than loading live advertisements', async () => {
    const stub = browser();
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy: allowedPrivacy(), testMode: true, deploymentContext: 'production' });
    await provider.initialize();
    expect(stub.appendChild).not.toHaveBeenCalled();
    expect(stub.sdk.adConfig).not.toHaveBeenCalled();
  });

  it('can initialize again immediately after withdrawal without reusing the cancelled attempt', async () => {
    const stub = browser();
    const privacy = allowedPrivacy();
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy });
    const first = provider.initialize();
    privacy.revokeAdsConsent(); privacy.saveAdsConsent('granted');
    const second = provider.initialize();
    expect(second).not.toBe(first);
    await first;
    expect(provider.initialize()).toBe(second);
    stub.ready(); await second;
    expect(provider.isRewardedAvailable()).toBe(true);
    expect(stub.appendChild).toHaveBeenCalledTimes(2);
  });

  it('never awards coins from a completed Google test placement', async () => {
    const stub = browser();
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy: allowedPrivacy(), testMode: true, deploymentContext: 'preview' });
    const init = provider.initialize(); stub.ready(); await init;
    expect(stub.script.setAttribute).toHaveBeenCalledWith('data-adbreak-test', 'on');
    const result = provider.rewardedAd('bonus'); viewed(stub.placement());
    await expect(result).resolves.toEqual({ success: false, evidence: 'simulation' });
  });

  it('requires provider selection and a valid publisher for standalone builds', async () => {
    const stub = browser();
    vi.stubEnv('VITE_PLATFORM', 'standalone');
    vi.stubEnv('VITE_AD_PROVIDER', 'none');
    vi.stubEnv('VITE_GOOGLE_ADSENSE_CLIENT', CLIENT);
    expect(createAdProvider()).toBeInstanceOf(MockAdProvider);
    vi.stubEnv('VITE_AD_PROVIDER', 'google-h5');
    vi.stubEnv('VITE_GOOGLE_ADSENSE_CLIENT', 'ca-pub-123');
    expect(createAdProvider()).toBeInstanceOf(MockAdProvider);
    vi.stubEnv('VITE_GOOGLE_ADSENSE_CLIENT', CLIENT);
    expect(createAdProvider()).toBeInstanceOf(GoogleH5AdProvider);
    vi.stubEnv('VITE_PLATFORM', 'unknown');
    expect(createAdProvider()).toBeInstanceOf(MockAdProvider);
    expect(stub.appendChild).not.toHaveBeenCalled();
  });

  it.each(['', 'pub-1234567890123456', 'ca-pub-123456789012345', 'ca-pub-12345678901234567', 'ca-pub-abcdefghijklmnop'])('loads nothing for invalid publisher %s', async (client) => {
    const stub = browser();
    const provider = new GoogleH5AdProvider({ client });
    await provider.initialize();
    expect(stub.appendChild).not.toHaveBeenCalled();
    expect(provider.isRewardedAvailable()).toBe(false);
    await expect(provider.rewardedAd('bonus')).resolves.toEqual({ success: false });
  });

  it('confirms readiness only through onReady after requesting preloading', async () => {
    const stub = browser();
    const provider = new GoogleH5AdProvider({ client: CLIENT, channel: '1234', privacy: allowedPrivacy() });
    const first = provider.initialize();
    expect(provider.initialize()).toBe(first);
    expect(provider.isRewardedAvailable()).toBe(false);
    expect(stub.sdk.adConfig).toHaveBeenCalledWith(expect.objectContaining({ preloadAdBreaks: 'on', onReady: expect.any(Function) }));
    expect(stub.appendChild).toHaveBeenCalledTimes(1);
    expect(stub.script.src).toBe(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`);
    expect(stub.script.setAttribute).toHaveBeenCalledWith('data-ad-channel', '1234');
    stub.ready();
    await first;
    expect(provider.isRewardedAvailable()).toBe(true);
  });

  it('initializes the Google command queue when globals are absent', async () => {
    const stub = browser();
    const sdk: { adsbygoogle?: Array<{ onReady?: () => void }> } = {};
    vi.stubGlobal('window', sdk);
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy: allowedPrivacy() });
    const initialization = provider.initialize();
    expect(stub.appendChild).toHaveBeenCalledTimes(1);
    expect(provider.isRewardedAvailable()).toBe(false);
    sdk.adsbygoogle?.[0].onReady?.();
    await initialization;
    expect(provider.isRewardedAvailable()).toBe(true);
  });

  it('ignores onReady after initialization timeout', async () => {
    vi.useFakeTimers();
    const stub = browser();
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy: allowedPrivacy() });
    const initialization = provider.initialize();
    await vi.advanceTimersByTimeAsync(8_000);
    await initialization;
    stub.ready();
    expect(provider.isRewardedAvailable()).toBe(false);
    expect(stub.script.remove).toHaveBeenCalledTimes(1);
  });

  it('absorbs blocked script loading', async () => {
    const stub = browser();
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy: allowedPrivacy() });
    const initialization = provider.initialize();
    const errorHandler = stub.script.addEventListener.mock.calls.find((args) => args[0] === 'error')?.[1] as (() => void);
    errorHandler();
    await initialization;
    expect(provider.isRewardedAvailable()).toBe(false);
  });

  it('falls back outside a browser', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    const provider = new GoogleH5AdProvider({ client: CLIENT });
    await provider.initialize();
    expect(provider.isRewardedAvailable()).toBe(false);
  });
});

describe('Google H5 reward evidence', () => {
  it('withdraws consent during an ad and ignores late completed callbacks', async () => {
    const stub = browser();
    const privacy = allowedPrivacy();
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy });
    const init = provider.initialize(); stub.ready(); await init;
    const result = provider.rewardedAd('bonus');
    const ad = stub.placement();
    ad.beforeReward(() => ad.beforeAd());
    privacy.revokeAdsConsent();
    viewed(ad);
    await expect(result).resolves.toEqual({ success: false });
    expect(provider.isRewardedAvailable()).toBe(false);
    expect(stub.script.remove).toHaveBeenCalledTimes(1);
    await expect(provider.rewardedAd('bonus')).resolves.toEqual({ success: false });
  });

  it('cancels initialization on withdrawal and ignores a late ready callback', async () => {
    const stub = browser();
    const privacy = allowedPrivacy();
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy });
    const init = provider.initialize();
    privacy.revokeAdsConsent(); stub.ready(); await init;
    expect(provider.isRewardedAvailable()).toBe(false);
  });

  it('rechecks CMP consent at completion even if the CMP misses its update event', async () => {
    const stub = browser();
    const privacy = allowedPrivacy();
    let granted = true;
    privacy.setAdvertisingConsentAdapter({ isConfigured: () => true, getConsent: () => granted ? 'granted' : 'denied', subscribe: () => () => {} });
    const provider = new GoogleH5AdProvider({ client: CLIENT, privacy });
    const init = provider.initialize(); stub.ready(); await init;
    const result = provider.rewardedAd('bonus');
    granted = false;
    viewed(stub.placement());
    await expect(result).resolves.toEqual({ success: false });
  });

  it('waits for viewed confirmation, ad closure, and the final placement status', async () => {
    const { provider, placement } = await initialized();
    const result = provider.rewardedAd('second-chance');
    const settled = vi.fn();
    void result.then(settled);
    const ad = placement();
    ad.beforeReward(() => ad.beforeAd());
    ad.adViewed();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    ad.afterAd();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    ad.adBreakDone({ breakStatus: 'viewed' });
    await expect(result).resolves.toEqual({ success: true, evidence: 'browser-callback' });
    expect(provider.isRewardedAvailable()).toBe(true);
  });

  it.each(['notReady', 'timeout', 'error', 'noAdPreloaded', 'frequencyCapped', 'ignored', 'other', 'dismissed'])('fails closed on placement status %s', async (status) => {
    const { provider, placement } = await initialized();
    const result = provider.rewardedAd('bonus');
    viewed(placement(), status);
    await expect(result).resolves.toEqual({ success: false });
  });

  it.each(['offered', 'started', 'viewed', 'completed'])('rejects completion without %s evidence', async (omitted) => {
    const { provider, placement } = await initialized();
    const result = provider.rewardedAd('bonus');
    const ad = placement();
    if (omitted !== 'offered') ad.beforeReward(() => {});
    if (omitted !== 'started') ad.beforeAd();
    if (omitted !== 'viewed') ad.adViewed();
    if (omitted !== 'completed') ad.afterAd();
    ad.adBreakDone({ breakStatus: 'viewed' });
    await expect(result).resolves.toEqual({ success: false });
  });

  it('never rewards cancellation followed by contradictory callbacks', async () => {
    const { provider, placement } = await initialized();
    const result = provider.rewardedAd('bonus');
    const ad = placement();
    ad.beforeReward(() => ad.beforeAd());
    ad.adDismissed();
    ad.adViewed();
    ad.afterAd();
    ad.adBreakDone({ breakStatus: 'viewed' });
    await expect(result).resolves.toEqual({ success: false });
  });

  it('rejects viewed confirmation arriving after ad closure', async () => {
    const { provider, placement } = await initialized();
    const result = provider.rewardedAd('bonus');
    const ad = placement();
    ad.beforeReward(() => ad.beforeAd());
    ad.afterAd();
    ad.adViewed();
    ad.adBreakDone({ breakStatus: 'viewed' });
    await expect(result).resolves.toEqual({ success: false });
  });

  it('rejects simultaneous requests and opens each offer only once', async () => {
    const { provider, placement, sdk } = await initialized();
    const first = provider.rewardedAd('bonus');
    await expect(provider.rewardedAd('confetti')).resolves.toEqual({ success: false });
    const ad = placement();
    const show = vi.fn(() => ad.beforeAd());
    ad.beforeReward(show);
    ad.beforeReward(show);
    expect(show).toHaveBeenCalledTimes(1);
    ad.adViewed(); ad.afterAd(); ad.adBreakDone({ breakStatus: 'viewed' });
    await expect(first).resolves.toEqual({ success: true, evidence: 'browser-callback' });
    expect(sdk.adBreak).toHaveBeenCalledTimes(1);
  });

  it('ignores all callbacks after timeout and blocks subsequent requests for the session', async () => {
    vi.useFakeTimers();
    const { provider, placement, sdk } = await initialized();
    const result = provider.rewardedAd('bonus');
    const ad = placement();
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(result).resolves.toEqual({ success: false });
    const show = vi.fn();
    ad.beforeReward(show);
    viewed(ad);
    expect(show).not.toHaveBeenCalled();
    await expect(provider.rewardedAd('bonus')).resolves.toEqual({ success: false });
    expect(sdk.adBreak).toHaveBeenCalledTimes(1);
  });

  it('absorbs SDK and display exceptions', async () => {
    const { provider, placement, sdk } = await initialized();
    const result = provider.rewardedAd('bonus');
    placement().beforeReward(() => { throw new Error('blocked'); });
    await expect(result).resolves.toEqual({ success: false });
    sdk.adBreak.mockImplementationOnce(() => { throw new Error('blocked'); });
    await expect(provider.rewardedAd('bonus')).resolves.toEqual({ success: false });
  });

  it('never requests automatic commercial ads', async () => {
    const { provider, sdk } = await initialized();
    await provider.commercialBreak('menu');
    expect(sdk.adBreak).not.toHaveBeenCalled();
  });
});
