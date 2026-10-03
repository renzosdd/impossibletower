type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'portrait') => Promise<void> };

export class OrientationController {
  private isBlocked = false;
  private adActive = false;
  private lockAttempted = false;
  private readonly coarse = matchMedia('(pointer: coarse)');
  private readonly guard = document.querySelector<HTMLDialogElement>('#orientation-guard');
  private readonly physicalOrientation = screen.orientation as LockableOrientation | undefined;

  constructor(private readonly onChange: (blocked: boolean) => void) {
    this.isBlocked = this.isMobileLandscape();
    this.render();
    window.addEventListener('resize', this.update);
    window.addEventListener('orientationchange', this.update);
    this.physicalOrientation?.addEventListener('change', this.update);
    this.coarse.addEventListener('change', this.update);
    window.visualViewport?.addEventListener('resize', this.update);
    document.addEventListener('pointerdown', this.requestPortrait);
    document.addEventListener('keydown', this.requestPortrait);
    this.guard?.addEventListener('cancel', this.preventCancel);
  }

  get blocked(): boolean {
    return this.isBlocked;
  }

  setAdActive(active: boolean): void {
    this.adActive = active;
    this.render();
  }

  destroy(): void {
    window.removeEventListener('resize', this.update);
    window.removeEventListener('orientationchange', this.update);
    this.physicalOrientation?.removeEventListener('change', this.update);
    this.coarse.removeEventListener('change', this.update);
    window.visualViewport?.removeEventListener('resize', this.update);
    document.removeEventListener('pointerdown', this.requestPortrait);
    document.removeEventListener('keydown', this.requestPortrait);
    this.guard?.removeEventListener('cancel', this.preventCancel);
    this.guard?.close();
    document.body.classList.remove('orientation-blocked');
  }

  private isMobile(): boolean {
    return this.coarse.matches && Math.min(screen.width, screen.height) <= 900;
  }

  private isMobileLandscape(): boolean {
    if (!this.isMobile()) return false;
    const type = this.physicalOrientation?.type;
    if (type?.startsWith('portrait')) return false;
    if (type?.startsWith('landscape')) return true;
    const angle = (window as Window & { orientation?: number }).orientation;
    if (typeof angle === 'number') return Math.abs(angle) % 180 === 90;
    return screen.width > screen.height;
  }

  private readonly update = (): void => {
    const blocked = this.isMobileLandscape();
    if (blocked === this.isBlocked) return;
    this.isBlocked = blocked;
    this.render();
    this.onChange(blocked);
  };

  private readonly requestPortrait = (): void => {
    if (this.lockAttempted || !this.isMobile() || !this.physicalOrientation?.lock) return;
    this.lockAttempted = true;
    try {
      void Promise.resolve(this.physicalOrientation.lock('portrait')).catch(() => {});
    } catch {}
  };

  private readonly preventCancel = (event: Event): void => {
    event.preventDefault();
  };

  private render(): void {
    document.body.classList.toggle('orientation-blocked', this.isBlocked);
    if (!this.guard) return;
    if (this.isBlocked && !this.adActive) {
      if (!this.guard.open) this.guard.showModal();
    } else if (this.guard.open) {
      this.guard.close();
    }
  }
}
