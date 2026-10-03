export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

export interface AnalyticsProvider {
  track(name: string, properties?: AnalyticsProperties): void;
}

/** Development transport only: no endpoint, identifier, or analytics cookie. */
export class ConsoleAnalyticsProvider implements AnalyticsProvider {
  constructor(private readonly enabled = import.meta.env.DEV) {}

  track(name: string, properties: AnalyticsProperties = {}): void {
    if (!this.enabled) return;
    const safe: AnalyticsProperties = {};
    for (const [key, value] of Object.entries(properties)) {
      if (/password|email|phone|token|secret|address|publicName|name$/i.test(key)) continue;
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      safe[key] = typeof value === 'string' ? value.slice(0, 200) : value;
    }
    try { console.debug(`[Impossible Tower] ${name}`, safe); } catch { /* Analytics never interrupts gameplay. */ }
  }
}

export function createAnalytics(): AnalyticsProvider {
  return new ConsoleAnalyticsProvider();
}
