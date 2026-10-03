import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrientationController } from '../../src/ui/orientation';

interface BrowserOptions {
  coarse?: boolean;
  type?: string;
  width?: number;
  height?: number;
  withoutOrientation?: boolean;
  legacyAngle?: number;
}

function browser(options: BrowserOptions = {}) {
  const classes = new Set<string>();
  const guard = Object.assign(new EventTarget(), {
    open: false,
    showModal: vi.fn(() => { guard.open = true; }),
    close: vi.fn(() => { guard.open = false; }),
  });
  const coarse = Object.assign(new EventTarget(), { matches: options.coarse ?? true });
  const physical = Object.assign(new EventTarget(), {
    type: options.type ?? 'portrait-primary',
    lock: vi.fn().mockRejectedValue(new Error('Unsupported outside fullscreen')),
  });
  const viewport = new EventTarget();
  const window = Object.assign(new EventTarget(), {
    innerWidth: options.width ?? 393,
    innerHeight: options.height ?? 851,
    orientation: options.legacyAngle,
    visualViewport: viewport,
  });
  const document = Object.assign(new EventTarget(), {
    querySelector: () => guard,
    body: {
      classList: {
        toggle: (name: string, active: boolean) => active ? classes.add(name) : classes.delete(name),
        remove: (name: string) => classes.delete(name),
      },
    },
  });
  const screen = {
    width: options.width ?? 393,
    height: options.height ?? 851,
    orientation: options.withoutOrientation ? undefined : physical,
  };
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('screen', screen);
  vi.stubGlobal('matchMedia', () => coarse);
  return { classes, guard, coarse, physical, viewport, window, document, screen };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('mobile orientation', () => {
  it('blocks a mobile landscape immediately and shows the dialog', () => {
    const state = browser({ type: 'landscape-primary', width: 851, height: 393 });
    const onChange = vi.fn();
    const controller = new OrientationController(onChange);
    expect(controller.blocked).toBe(true);
    expect(state.classes.has('orientation-blocked')).toBe(true);
    expect(state.guard.open).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(state.physical.lock).not.toHaveBeenCalled();
  });

  it('emits one pause transition per physical rotation', () => {
    const state = browser();
    const onChange = vi.fn();
    const controller = new OrientationController(onChange);
    state.physical.type = 'landscape-secondary';
    state.physical.dispatchEvent(new Event('change'));
    state.window.dispatchEvent(new Event('resize'));
    expect(controller.blocked).toBe(true);
    state.physical.type = 'portrait-secondary';
    state.physical.dispatchEvent(new Event('change'));
    expect(controller.blocked).toBe(false);
    expect(state.guard.open).toBe(false);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps portrait usable when the virtual keyboard shrinks the viewport', () => {
    const state = browser();
    const onChange = vi.fn();
    const controller = new OrientationController(onChange);
    state.window.innerHeight = 260;
    state.window.dispatchEvent(new Event('resize'));
    state.viewport.dispatchEvent(new Event('resize'));
    expect(controller.blocked).toBe(false);
    expect(state.guard.open).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not block desktop landscape', () => {
    const state = browser({ coarse: false, type: 'landscape-primary', width: 1440, height: 1000 });
    const controller = new OrientationController(vi.fn());
    expect(controller.blocked).toBe(false);
    state.document.dispatchEvent(new Event('pointerdown'));
    expect(state.physical.lock).not.toHaveBeenCalled();
  });

  it('uses physical screen dimensions when the orientation API is absent', () => {
    const state = browser({ withoutOrientation: true });
    const controller = new OrientationController(vi.fn());
    state.window.innerHeight = 260;
    state.window.dispatchEvent(new Event('resize'));
    expect(controller.blocked).toBe(false);
    state.screen.width = 851;
    state.screen.height = 393;
    state.window.dispatchEvent(new Event('orientationchange'));
    expect(controller.blocked).toBe(true);
  });

  it('supports the legacy Safari orientation signal', () => {
    const state = browser({ withoutOrientation: true, legacyAngle: 0 });
    const controller = new OrientationController(vi.fn());
    state.window.orientation = -90;
    state.window.dispatchEvent(new Event('orientationchange'));
    expect(controller.blocked).toBe(true);
    state.window.orientation = 180;
    state.window.dispatchEvent(new Event('orientationchange'));
    expect(controller.blocked).toBe(false);
  });

  it('hides the dialog during an ad while preserving the orientation block', () => {
    const state = browser({ type: 'landscape-primary', width: 851, height: 393 });
    const onChange = vi.fn();
    const controller = new OrientationController(onChange);
    controller.setAdActive(true);
    expect(state.guard.open).toBe(false);
    expect(controller.blocked).toBe(true);
    expect(state.classes.has('orientation-blocked')).toBe(true);
    controller.setAdActive(false);
    expect(state.guard.open).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('attempts a portrait lock only after a gesture and absorbs rejection', async () => {
    const state = browser();
    new OrientationController(vi.fn());
    expect(state.physical.lock).not.toHaveBeenCalled();
    state.document.dispatchEvent(new Event('pointerdown'));
    state.document.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    expect(state.physical.lock).toHaveBeenCalledExactlyOnceWith('portrait');
  });

  it('absorbs a synchronous lock failure without entering fullscreen', () => {
    const state = browser();
    state.physical.lock.mockImplementation(() => { throw new Error('Unavailable'); });
    new OrientationController(vi.fn());
    expect(() => state.document.dispatchEvent(new Event('keydown'))).not.toThrow();
    expect(state.physical.lock).toHaveBeenCalledExactlyOnceWith('portrait');
  });

  it('prevents Escape dismissing the required orientation dialog and cleans up listeners', () => {
    const state = browser({ type: 'landscape-primary', width: 851, height: 393 });
    const onChange = vi.fn();
    const controller = new OrientationController(onChange);
    const cancel = new Event('cancel', { cancelable: true });
    state.guard.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    controller.destroy();
    expect(state.guard.open).toBe(false);
    expect(state.classes.has('orientation-blocked')).toBe(false);
    state.physical.type = 'portrait-primary';
    state.physical.dispatchEvent(new Event('change'));
    state.document.dispatchEvent(new Event('pointerdown'));
    expect(onChange).not.toHaveBeenCalled();
    expect(state.physical.lock).not.toHaveBeenCalled();
  });
});
