import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyConsentService, PRIVACY_STORAGE_KEY, type AgeGroup, type PrivacyStorage } from '../../src/services/privacy';

afterEach(() => { vi.unstubAllGlobals(); });

function storage(): PrivacyStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

function cmp(granted = true) {
  return { isConfigured: () => true, getConsent: () => granted ? 'granted' as const : 'denied' as const, subscribe: () => () => {} };
}

describe('Privacy consent', () => {
  it('updates permission when another tab withdraws stored consent', () => {
    const memory = storage();
    let storageChanged: ((event: { key: string; storageArea: PrivacyStorage }) => void) | undefined;
    vi.stubGlobal('window', { addEventListener: (_event: string, listener: typeof storageChanged) => { storageChanged = listener; } });
    const privacy = new PrivacyConsentService(memory);
    privacy.saveAgeGroup('adult'); privacy.saveAdsConsent('granted'); privacy.setAdvertisingConsentAdapter(cmp());
    expect(privacy.canRequestAds()).toBe(true);
    const fromAnotherTab = { ...privacy.load(), adsConsent: 'denied' };
    memory.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(fromAnotherTab));
    storageChanged?.({ key: PRIVACY_STORAGE_KEY, storageArea: memory });
    expect(privacy.canRequestAds()).toBe(false);
    expect(privacy.load().adsConsent).toBe('denied');
  });

  it.each(['unknown', 'under13', 'teen'] as AgeGroup[])('never allows ads for %s despite CMP permission', age => {
    const privacy = new PrivacyConsentService(storage());
    privacy.saveAgeGroup(age);
    privacy.saveGuardianAuthorization(true);
    privacy.saveAdsConsent('granted');
    privacy.setAdvertisingConsentAdapter(cmp());
    expect(privacy.canRequestAds()).toBe(false);
  });

  it('requires both adult opt-in and a configured CMP', () => {
    const privacy = new PrivacyConsentService(storage());
    privacy.saveAgeGroup('adult');
    privacy.saveAdsConsent('granted');
    expect(privacy.canRequestAds()).toBe(false);
    privacy.setAdvertisingConsentAdapter(cmp());
    expect(privacy.canRequestAds()).toBe(true);
    privacy.setAdvertisingConsentAdapter({ ...cmp(), isConfigured: () => false });
    expect(privacy.canRequestAds()).toBe(false);
    privacy.setAdvertisingConsentAdapter(cmp(false));
    expect(privacy.canRequestAds()).toBe(false);
  });

  it('requires guardian authorization for teen online features and resets on age change', () => {
    const privacy = new PrivacyConsentService(storage());
    expect(privacy.canUseOnlineServices()).toBe(false);
    privacy.saveAgeGroup('under13');
    privacy.saveGuardianAuthorization(true);
    expect(privacy.canUseOnlineServices()).toBe(false);
    privacy.saveAgeGroup('teen');
    expect(privacy.canUseOnlineServices()).toBe(false);
    privacy.saveGuardianAuthorization(true);
    expect(privacy.canUseOnlineServices()).toBe(true);
    privacy.saveAgeGroup('adult');
    expect(privacy.load().guardianAuthorized).toBe(false);
    privacy.saveAgeGroup('teen');
    expect(privacy.canUseOnlineServices()).toBe(false);
  });

  it('persists withdrawal and does not inherit consent across age groups', () => {
    const memory = storage();
    const privacy = new PrivacyConsentService(memory);
    privacy.saveAgeGroup('adult'); privacy.saveAdsConsent('granted');
    privacy.revokeAdsConsent();
    expect(new PrivacyConsentService(memory).load().adsConsent).toBe('denied');
    privacy.saveAgeGroup('teen'); privacy.saveAgeGroup('adult');
    expect(privacy.load().adsConsent).toBe('unknown');
  });

  it('ignores malformed or unversioned persistence and works when storage throws', () => {
    const memory = storage();
    memory.setItem(PRIVACY_STORAGE_KEY, '{"ageGroup":"adult","adsConsent":"granted"}');
    expect(new PrivacyConsentService(memory).load().ageGroup).toBe('unknown');
    memory.setItem(PRIVACY_STORAGE_KEY, '{broken');
    expect(new PrivacyConsentService(memory).canRequestAds()).toBe(false);
    const throwing: PrivacyStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const privacy = new PrivacyConsentService(throwing);
    privacy.saveAgeGroup('adult');
    expect(privacy.canUseOnlineServices()).toBe(true);
  });

  it('fails closed when CMP throws and notifies on CMP updates', () => {
    const privacy = new PrivacyConsentService(storage());
    privacy.saveAgeGroup('adult'); privacy.saveAdsConsent('granted');
    const listener = vi.fn();
    privacy.subscribe(listener);
    let update: (() => void) | undefined;
    privacy.setAdvertisingConsentAdapter({ isConfigured: () => true, getConsent: () => { throw new Error('CMP failed'); }, subscribe: value => { update = value; return () => {}; } });
    expect(privacy.canRequestAds()).toBe(false);
    update?.();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
