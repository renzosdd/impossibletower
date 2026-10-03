import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyConsentService } from '../../src/services/privacy';
import { connectGoogleTcfConsent, evaluateGoogleTcfConsent, TcfConsentAdapter, type TcfApi, type TcfData } from '../../src/services/privacy/tcf';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

function consentData(): TcfData {
  return {
    cmpId: 300, cmpStatus: 'loaded', eventStatus: 'useractioncomplete', gdprApplies: true,
    tcfPolicyVersion: 5, isServiceSpecific: true, tcString: 'CPtestEncodedConsent.IBAvalidDisclosure', listenerId: 17,
    purpose: { consents: { 1: true, 3: true, 4: true }, legitimateInterests: { 2: true, 7: true, 9: true, 10: true } },
    vendor: { consents: { 755: true }, legitimateInterests: { 755: true }, disclosedVendors: { 755: true } },
  };
}

function apiStub() {
  let callback: Parameters<TcfApi>[2] | undefined;
  const api = vi.fn<TcfApi>((command, _version, listener) => { if (command === 'addEventListener') callback = listener; });
  return { api, emit: (data: TcfData | undefined, success = true) => callback?.(data, success) };
}

describe('Google TCF consent evaluation', () => {
  it.each(['tcloaded', 'useractioncomplete'])('accepts completed %s with the required Google permissions', eventStatus => {
    expect(evaluateGoogleTcfConsent({ ...consentData(), eventStatus }, 300)).toBe('granted');
  });

  it.each([
    { cmpId: 301 }, { cmpStatus: 'loading' }, { cmpStatus: 'error' }, { eventStatus: 'cmpuishown' },
    { gdprApplies: undefined },
  ])('does not infer consent from unfinished or different CMP data %j', replacement => {
    expect(evaluateGoogleTcfConsent({ ...consentData(), ...replacement }, 300)).toBe('unknown');
  });

  it('permits the explicitly out-of-scope CMP result without inventing a GDPR consent string', () => {
    expect(evaluateGoogleTcfConsent({ cmpId: 300, cmpStatus: 'loaded', eventStatus: 'tcloaded', gdprApplies: false }, 300)).toBe('granted');
    expect(evaluateGoogleTcfConsent({ cmpId: 300, gdprApplies: false }, 300)).toBe('unknown');
    expect(evaluateGoogleTcfConsent({ cmpId: 300, gdprApplies: false }, 300, { cmpId: 300, cmpStatus: 'loaded', cmpLoaded: true, gdprApplies: false })).toBe('granted');
  });

  it.each([
    { tcfPolicyVersion: 4 }, { isServiceSpecific: false }, { tcString: '' },
    { tcString: 'invalid' }, { vendor: { consents: { 755: true }, legitimateInterests: { 755: true } } },
  ])('rejects incomplete or outdated transparency evidence %j', replacement => {
    expect(evaluateGoogleTcfConsent({ ...consentData(), ...replacement }, 300)).toBe('denied');
  });

  it.each([1, 3, 4])('rejects missing purpose %s consent', purpose => {
    const data = consentData(); data.purpose!.consents![purpose] = false;
    expect(evaluateGoogleTcfConsent(data, 300)).toBe('denied');
  });

  it.each([2, 7, 9, 10])('rejects missing purpose %s legitimate interest', purpose => {
    const data = consentData(); data.purpose!.legitimateInterests![purpose] = false;
    expect(evaluateGoogleTcfConsent(data, 300)).toBe('denied');
  });

  it('honors publisher restrictions for the Google vendor and legal basis', () => {
    const data = consentData();
    data.publisher = { restrictions: { 7: { 755: 1 } } };
    expect(evaluateGoogleTcfConsent(data, 300)).toBe('denied');
    data.purpose!.consents![7] = true;
    expect(evaluateGoogleTcfConsent(data, 300)).toBe('granted');
    data.publisher.restrictions![7][755] = 0;
    expect(evaluateGoogleTcfConsent(data, 300)).toBe('denied');
    data.publisher.restrictions = { 1: { 755: 2 } };
    expect(evaluateGoogleTcfConsent(data, 300)).toBe('denied');
  });

  it('requires consent and legitimate interest specifically for Google 755', () => {
    const data = consentData(); data.vendor!.consents![755] = false;
    expect(evaluateGoogleTcfConsent(data, 300)).toBe('denied');
    data.vendor!.consents![755] = true; data.vendor!.legitimateInterests![755] = false;
    expect(evaluateGoogleTcfConsent(data, 300)).toBe('denied');
  });
});

describe('TCF CMP adapter', () => {
  it('checks the loaded CMP through ping when non-GDPR TCData omits event status', async () => {
    const stub = apiStub();
    stub.api.mockImplementation((command, _version, listener) => {
      if (command === 'ping') listener({ cmpId: 300, cmpStatus: 'loaded', cmpLoaded: true, gdprApplies: false });
      if (command === 'addEventListener') listener({ cmpId: 300, gdprApplies: false }, true);
    });
    const adapter = new TcfConsentAdapter({ cmpId: 300, certificationAttested: true, getApi: () => stub.api });
    const privacy = new PrivacyConsentService(undefined); privacy.setAdvertisingConsentAdapter(adapter);
    await expect(adapter.connect()).resolves.toBe(true);
    expect(stub.api).toHaveBeenCalledWith('ping', 2, expect.any(Function));
    expect(privacy.canRequestAds()).toBe(false);
    privacy.saveAgeGroup('adult'); expect(privacy.canRequestAds()).toBe(false);
    privacy.saveAdsConsent('granted'); expect(privacy.canRequestAds()).toBe(true);
    privacy.revokeAdsConsent(); expect(privacy.canRequestAds()).toBe(false);
    adapter.dispose();
  });

  it.each([
    { cmpId: 301, cmpStatus: 'loaded', cmpLoaded: true, gdprApplies: false },
    { cmpId: 300, cmpStatus: 'stub', cmpLoaded: false, gdprApplies: false },
    { cmpId: 300, cmpStatus: 'loaded', cmpLoaded: true, gdprApplies: undefined },
    { cmpId: 300, cmpStatus: 'error', cmpLoaded: true, gdprApplies: false },
  ])('blocks invalid or unknown non-GDPR readiness %j', async ping => {
    const stub = apiStub();
    stub.api.mockImplementation((command, _version, listener) => {
      if (command === 'ping') listener(ping);
      if (command === 'addEventListener') listener({ cmpId: 300, gdprApplies: false }, true);
    });
    const adapter = new TcfConsentAdapter({ cmpId: 300, certificationAttested: true, getApi: () => stub.api });
    await expect(adapter.connect()).resolves.toBe(false);
    expect(adapter.getConsent()).toBe('unknown');
    adapter.dispose();
  });

  it('ignores a stale non-GDPR ping after a new unknown or denied CMP event', async () => {
    let event: Parameters<TcfApi>[2] | undefined; let ping: Parameters<TcfApi>[2] | undefined;
    const api = vi.fn<TcfApi>((command, _version, listener) => { if (command === 'addEventListener') event = listener; if (command === 'ping') ping = listener; });
    const adapter = new TcfConsentAdapter({ cmpId: 300, certificationAttested: true, getApi: () => api });
    const connected = adapter.connect();
    event?.({ cmpId: 300, gdprApplies: false }, true);
    event?.({ ...consentData(), gdprApplies: undefined }, true);
    await expect(connected).resolves.toBe(true);
    ping?.({ cmpId: 300, cmpStatus: 'loaded', cmpLoaded: true, gdprApplies: false });
    expect(adapter.getConsent()).toBe('unknown');
    adapter.dispose();
  });

  it('subscribes through the real TCF API and applies subsequent withdrawal immediately', async () => {
    const stub = apiStub();
    const adapter = new TcfConsentAdapter({ cmpId: 300, certificationAttested: true, getApi: () => stub.api });
    const privacy = new PrivacyConsentService(undefined);
    privacy.saveAgeGroup('adult'); privacy.saveAdsConsent('granted'); privacy.setAdvertisingConsentAdapter(adapter);
    const connected = adapter.connect();
    expect(stub.api).toHaveBeenCalledWith('addEventListener', 2, expect.any(Function));
    expect(privacy.canRequestAds()).toBe(false);
    stub.emit(consentData()); await expect(connected).resolves.toBe(true);
    expect(privacy.canRequestAds()).toBe(true);
    const withdrawn = consentData(); withdrawn.vendor!.consents![755] = false;
    stub.emit(withdrawn);
    expect(privacy.canRequestAds()).toBe(false);
    adapter.dispose();
    expect(stub.api).toHaveBeenCalledWith('removeEventListener', 2, expect.any(Function), 17);
    stub.emit(consentData());
    expect(privacy.canRequestAds()).toBe(false);
  });

  it('requires operator attestation and a valid expected CMP ID', async () => {
    const stub = apiStub();
    const disabled = new TcfConsentAdapter({ cmpId: 300, certificationAttested: false, getApi: () => stub.api });
    await expect(disabled.connect()).resolves.toBe(false);
    const invalid = new TcfConsentAdapter({ cmpId: 0, certificationAttested: true, getApi: () => stub.api });
    await expect(invalid.connect()).resolves.toBe(false);
    expect(stub.api).not.toHaveBeenCalled();
  });

  it('does not trust a different CMP or an unsuccessful callback', async () => {
    const stub = apiStub();
    const adapter = new TcfConsentAdapter({ cmpId: 300, certificationAttested: true, getApi: () => stub.api });
    const connected = adapter.connect(); stub.emit({ ...consentData(), cmpId: 301 });
    await expect(connected).resolves.toBe(false);
    expect(adapter.isConfigured()).toBe(false);
    stub.emit(consentData(), false);
    expect(adapter.getConsent()).toBe('unknown');
    adapter.dispose();
  });

  it('polls for a late CMP but stops polling at its bounded timeout', async () => {
    vi.useFakeTimers();
    const stub = apiStub();
    let available = false;
    const adapter = new TcfConsentAdapter({ cmpId: 300, certificationAttested: true, getApi: () => available ? stub.api : undefined, pollMs: 100, timeoutMs: 500 });
    const connected = adapter.connect();
    await vi.advanceTimersByTimeAsync(100); available = true;
    await vi.advanceTimersByTimeAsync(100); stub.emit(consentData());
    await expect(connected).resolves.toBe(true);
    adapter.dispose();
    const missingApi = vi.fn(() => undefined);
    const missing = new TcfConsentAdapter({ cmpId: 300, certificationAttested: true, getApi: missingApi, pollMs: 100, timeoutMs: 500 });
    const unavailable = missing.connect(); await vi.advanceTimersByTimeAsync(500);
    await expect(unavailable).resolves.toBe(false);
    const count = missingApi.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(missingApi).toHaveBeenCalledTimes(count);
    expect(missing.getConsent()).toBe('unknown');
    missing.dispose();
  });

  it('keeps the environment hook disabled without attested CMP configuration', () => {
    const stub = apiStub(); vi.stubGlobal('window', { __tcfapi: stub.api });
    const privacy = new PrivacyConsentService(undefined);
    vi.stubEnv('VITE_GOOGLE_CMP_ID', '300'); vi.stubEnv('VITE_GOOGLE_CMP_CONFIGURED', 'false');
    expect(connectGoogleTcfConsent(privacy)).toBeNull();
    expect(stub.api).not.toHaveBeenCalled();
    vi.stubEnv('VITE_GOOGLE_CMP_CONFIGURED', 'true');
    const adapter = connectGoogleTcfConsent(privacy);
    expect(adapter).toBeInstanceOf(TcfConsentAdapter);
    expect(connectGoogleTcfConsent(privacy)).toBe(adapter);
    expect(stub.api).toHaveBeenCalledTimes(1);
    stub.emit(consentData());
    expect(adapter?.getConsent()).toBe('granted');
    adapter?.dispose();
  });

  it('retries after the initial polling window if the adult loads a CMP later', async () => {
    vi.useFakeTimers();
    const stub = apiStub();
    let api: TcfApi | undefined;
    const adapter = new TcfConsentAdapter({ cmpId: 300, certificationAttested: true, getApi: () => api, timeoutMs: 100 });
    const first = adapter.connect(); await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBe(false);
    api = stub.api;
    const second = adapter.connect(); stub.emit(consentData());
    await expect(second).resolves.toBe(true);
    expect(adapter.getConsent()).toBe('granted');
    adapter.dispose();
  });
});
