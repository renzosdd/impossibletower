import type { Challenge, GameSnapshot, Profile, RunConfig, RunResult, UIAction } from '../types';
import { COSMETICS } from '../content/cosmetics';
import { MISSIONS, getActiveMissions } from '../content/missions';
import { ACHIEVEMENTS } from '../content/achievements';
import { LEGAL_DOCUMENTS, renderLegalBody } from '../content/legal';

type LeaderboardEntry = { name: string; height: number };
type Screen = 'menu' | 'game' | 'result';

const escape = (value: string | number): string => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const meters = (value: number): string => Math.max(0, value || 0).toFixed(1);
const icon = (name: string, className = ''): string => {
  const paths: Record<string, string> = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    play: '<path d="m9 5 11 7-11 7Z"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-11 4h2m2 3h2"/>',
    trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8"/>',
    skin: '<path d="m8 4-5 4 3 4 2-1v9h8v-9l2 1 3-4-5-4a4 4 0 0 1-8 0Z"/>',
    settings: '<path d="m9 4 1-2h4l1 2 2 1 2-.1 2 3-1 2v4l1 2-2 3-2-.1-2 1-1 2h-4l-1-2-2-1-2 .1-2-3 1-2v-4L3 8l2-3 2 .1Z"/><circle cx="12" cy="12" r="3"/>',
    pause: '<path d="M8 5v14m8-14v14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    share: '<path d="M12 15V3m-4 4 4-4 4 4M7 10H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m2-15a3 3 0 0 1 0 6m0 3a5 5 0 0 1 4 5v1"/>',
    home: '<path d="m3 10 9-7 9 7v10H3ZM9 20v-7h6v7"/>',
    bolt: '<path d="m14 2-9 12h6l-1 8 9-12h-6Z"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 8H11a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9.5M12 6v2m0 8v2"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    chart: '<path d="M4 20V9h4v11m2 0V4h4v16m2 0v-7h4v7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    sound: '<path d="M3 9h4l5-4v14l-5-4H3Zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>',
    music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    haptic: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="m4 8-2 4 2 4m16-8 2 4-2 4m-9 2h2"/>',
  };
  return `<svg class="icon ${className}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.bolt}</svg>`;
};

// Original lightweight artwork. All objects and shapes are drawn for this game.
const towerArt = (): string => `<svg class="tower-art" viewBox="0 0 380 270" fill="none" aria-hidden="true">
  <defs><pattern id="tower-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#7AABA8" opacity=".22"/></pattern></defs>
  <ellipse cx="190" cy="251" rx="115" ry="12" fill="#0A272D" opacity=".3"/>
  <path d="M37 225V137h25v-15h37v103m-69 0h326M300 225V153h32v-20h24v92" fill="#396F73" opacity=".38"/>
  <path d="M58 148h5m-5 13h5m-5 13h5m16-34h5m-5 16h5m-5 16h5m229-1h7m-7 16h7m12-31h5m-5 17h5" stroke="#75A5A2" opacity=".3" stroke-width="4"/>
  <circle cx="191" cy="130" r="112" fill="url(#tower-dots)"/>
  <path d="m80 240 16-18h190l14 18-12 10H93Z" fill="#8ABAB1"/><path d="M95 233h189v17H95Z" fill="#426D68"/>
  <g transform="translate(119 173) rotate(-3 65 25)"><path d="m0 8 13-8h116v40l-13 10H0Z" fill="#DCB066"/><path d="M0 8h116v42H0Z" fill="#E7C681"/><path d="m116 8 13-8v40l-13 10Z" fill="#B58748"/><path d="M37 8v42m43-42v42" stroke="#BE9555" stroke-width="3"/><path d="M50 8h18v12H50Z" fill="#F4DCA7"/><path d="m9 38 10-6 10 6" stroke="#A57C45" stroke-width="2"/></g>
  <g transform="translate(113 118) rotate(5 73 26)"><path d="M12 6a8 8 0 0 1 8-6h106a8 8 0 0 1 8 8v24H12Z" fill="#D46B59"/><path d="m21 5 2 28m36-28v28m36-28v28m30-28-3 28" stroke="#BA514A" stroke-width="2"/><rect x="5" y="26" width="135" height="21" rx="5" fill="#EE9077"/><rect y="16" width="15" height="31" rx="5" fill="#F7A28B"/><rect x="131" y="16" width="15" height="31" rx="5" fill="#F7A28B"/><path d="M13 46v9m119-9v9" stroke="#28464C" stroke-width="6"/></g>
  <g transform="translate(162 47) rotate(-7 29 34)"><path d="m0 8 9-8h54v65l-9 8H0Z" fill="#D7EAE5"/><path d="M0 8h54v65H0Z" fill="#BDD8D1"/><path d="M54 8 63 0v65l-9 8Z" fill="#83B3AB"/><path d="M0 32h54" stroke="#719C94" stroke-width="2"/><path d="M43 18v8m0 15v21" stroke="#456D65" stroke-width="3" stroke-linecap="round"/><rect x="9" y="13" width="17" height="9" rx="1" fill="#E5F1E8"/></g>
  <g transform="translate(195 8) rotate(10 24 19)"><path d="m0 6 7-6h41v30l-7 7H0Z" fill="#E9B844"/><path d="M0 6h41v31H0Z" fill="#FFD25D"/><path d="m41 6 7-6v30l-7 7Z" fill="#C79031"/><path d="M16 6h10v31H16Z" fill="#FFE7A7"/><path d="M9 26v-6m-3 3 3-3 3 3" stroke="#A77929" stroke-width="2"/></g>
  <path d="M225 1v-18m-7 18h14" stroke="#E8D7A9" stroke-width="3"/>
  <path d="m101 69-8 6m11 4-11 3m176-14 8-5m-5 15 9-1" stroke="#F6D768" stroke-width="2" stroke-linecap="round"/>
  <circle cx="273" cy="118" r="4" fill="#EFA18A"/><circle cx="91" cy="106" r="3" fill="#A5CFBF"/>
  <path d="m308 73 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#EEC85D"/>
</svg>`;

export class Interface {
  private root: HTMLElement;
  private onAction: (action: UIAction) => void;
  private profile!: Profile;
  private config?: RunConfig;
  private result?: RunResult;
  private screen: Screen = 'menu';
  private challenge?: Challenge;
  private backendAvailable = false;
  private installAvailable = false;
  private rewardAvailable = false;
  private canSecondChance = false;
  private canDoubleCoins = true;
  private bonusRemaining = 0;
  private trialAvailable = false;
  private paused = false;
  private dialog?: HTMLDialogElement;
  private adDialogSuspended = false;
  private toastTimer?: number;
  private momentTimer?: number;
  private lastHeight = '';
  private lastScore = '';
  private lastObjects = 0;
  private tutorialForRun = false;
  private desktop: HTMLElement;
  private debug = new URLSearchParams(location.search).get('debug') === '1';

  constructor(root: HTMLElement, onAction: (action: UIAction) => void) {
    this.root = root;
    this.onAction = onAction;
    root.classList.add('ui-root');
    new ResizeObserver(entries => {
      const size = entries[0]?.contentRect;
      if (size) root.style.setProperty('--ui-scale', String(Math.min(size.width / 420, size.height / 746)));
    }).observe(root);
    root.innerHTML = '<div class="screen-host"></div><div class="moment-host" aria-live="polite"></div><div class="toast-host" role="status"></div>';
    this.desktop = document.createElement('aside');
    this.desktop.className = 'desktop-context';
    this.desktop.setAttribute('aria-label', 'Impossible Tower');
    this.desktop.innerHTML = `<section class="desktop-left"><a class="desktop-wordmark" href="${escape(location.pathname)}" aria-label="Impossible Tower, inicio"><span class="brand-mark">${icon('bolt')}</span> IMPOSSIBLE TOWER<span class="edition-badge">VOL. 01</span></a><div class="desktop-editorial"><span class="eyebrow"><span class="status-dot"></span> UN DEDO. TODA LA GRAVEDAD.</span><h1>EL CIELO<br>ES EL<br><span>LÍMITE.</span><span class="editorial-star" aria-hidden="true"><svg width="59" height="59" viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M30 6v48M6 30h48M13 13l34 34M13 47l34-34"/></svg></span></h1><p>Una caja, un sofá, un cohete.<br>Apilá lo imposible. Desafiá a tus amigos.</p><div class="editorial-controls"><span>${icon('target')} UN TOQUE PARA SOLTAR</span><span class="keyboard-key">ESPACIO</span></div></div><div class="desktop-bottom"><span>HECHO PARA CAER.<br><strong>Y VOLVER A EMPEZAR.</strong></span><span class="tiny-arrow">${icon('arrow')}</span></div></section><section class="desktop-right"><div class="side-heading"><span class="eyebrow">TU MEJOR VERSIÓN</span><span class="side-counter">01 / ∞</span></div><div class="desktop-record"><span class="record-label">RÉCORD PERSONAL</span><div><span data-desktop-best>0.0</span><small>m</small></div><p>Siempre hay un poco más de cielo.</p></div><div class="object-gallery"><div class="gallery-label"><span>EL ORDEN, IMPROVISADO.</span><span>↓</span></div><div class="gallery-object gallery-box"><svg viewBox="0 0 140 95" aria-hidden="true"><path d="m27 30 23-14h61v47L88 79H27Z" fill="#B18548"/><path d="M27 30h61v49H27Z" fill="#E7BC74"/><path d="m27 30 23-14h61L88 30Z" fill="#F5D497"/><path d="M54 30h13v49H54Z" fill="#FBE4B8"/><path d="m54 30 23-14h13L67 30Z" fill="#FFEDD0"/></svg><span>01 — LA CAJA</span><span class="object-tag">FÁCIL</span></div><div class="gallery-object gallery-rocket"><svg viewBox="0 0 140 130" aria-hidden="true"><path d="m61 34 17-24 16 24v51H61Z" fill="#EFF0D9"/><path d="m61 34 17-24v75H61Z" fill="#C7D8CA"/><path d="m61 65-16 23v15l16-9m33-29 16 23v15-16-9" fill="#DF715A"/><circle cx="78" cy="44" r="9" fill="#3D727A"/><circle cx="78" cy="44" r="5" fill="#92BAB5"/><path d="M69 85h17v12H69Z" fill="#3B5A58"/><path d="m70 101 8 20 8-20" fill="#EDC656"/></svg><span>18 — EL COHETE</span><span class="object-tag">ABSURDO</span></div></div><div class="daily-note">${icon('calendar')}<p><strong>Una torre nueva cada día.</strong><br>La misma secuencia para todos.<br>Tu timing hace la diferencia.</p></div><div class="desktop-legal"><button type="button" data-legal="privacy">Privacidad</button><span>·</span><button type="button" data-legal="terms">Términos</button><span class="desktop-version">V1.0 / PHYSICS ARCADE</span></div></section>`;
    (document.querySelector('#app') || document.body).append(this.desktop);
    root.addEventListener('click', event => this.handleClick(event));
    this.desktop.addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLButtonElement>('[data-legal]');
      if (target) this.openLegal(target.dataset.legal === 'privacy' ? 'privacy' : 'terms');
    });
    if (this.debug) this.createDebugPanel();
  }

  showMenu(profile: Profile, challenge?: Challenge): void {
    this.closeDialog();
    this.profile = profile;
    this.challenge = challenge;
    this.screen = 'menu';
    this.paused = false;
    this.result = undefined;
    this.root.dataset.screen = 'menu';
    this.renderMenu();
    this.updateDesktop();
  }

  showGame(config: RunConfig, profile: Profile): void {
    this.closeDialog();
    this.profile = profile;
    this.config = config;
    this.screen = 'game';
    this.paused = false;
    this.lastHeight = '';
    this.lastScore = '';
    this.lastObjects = 0;
    this.tutorialForRun = !profile.tutorialComplete;
    this.root.dataset.screen = 'game';
    const mode = config.mode === 'daily' ? 'DAILY TOWER' : config.mode === 'challenge' ? 'DESAFÍO' : 'FREE STACK';
    this.host.innerHTML = `<section class="game-screen" aria-label="Partida de Impossible Tower"><header class="game-header"><div class="mode-label"><span class="status-dot"></span>${mode}</div><button class="icon-button pause-button" type="button" data-action="pause" aria-label="Pausar partida">${icon('pause')}</button></header><div class="height-hud"><span class="hud-caption">ALTURA</span><div class="height-value"><span data-hud="height">0.0</span><small>m</small></div><div class="score-hud"><span>SCORE <b data-hud="score">0</b></span><span class="hud-divider"></span><span><b data-hud="objects">0</b> OBJETOS</span></div></div>${config.challenge ? `<div class="challenge-target">${icon('target')} OBJETIVO <strong>${meters(config.challenge.height)} m</strong></div>` : ''}<div class="combo-hud" data-hud="combo"></div><div class="next-object-hud"><span>SIGUIENTE</span><strong data-hud="next">…</strong><span class="object-material">↓</span></div><div class="tap-hint" data-hud="hint">${icon('target')} ${profile.tutorialComplete ? 'TOCÁ PARA SOLTAR' : 'Tocá para soltar'}<span class="tap-hint-line"></span></div><div class="game-bottom-mark">IMPOSSIBLE<span> TOWER</span></div><span class="sr-only" data-hud="status" aria-live="polite"></span></section>`;
  }

  update(snapshot: GameSnapshot): void {
    if (this.screen !== 'game') return;
    const value = meters(snapshot.height);
    const heightNode = this.root.querySelector<HTMLElement>('[data-hud="height"]');
    if (heightNode && value !== this.lastHeight) {
      heightNode.textContent = value;
      this.lastHeight = value;
    }
    const scoreValue = String(snapshot.score);
    const scoreNode = this.root.querySelector<HTMLElement>('[data-hud="score"]');
    if (scoreNode && scoreValue !== this.lastScore) {
      scoreNode.textContent = scoreValue;
      scoreNode.classList.remove('score-pop');
      void scoreNode.offsetWidth;
      scoreNode.classList.add('score-pop');
      this.lastScore = scoreValue;
    }
    this.setText('[data-hud="objects"]', snapshot.objectsPlaced);
    this.setText('[data-hud="next"]', snapshot.nextObject);
    if (snapshot.objectsPlaced > this.lastObjects && snapshot.accuracy && !this.root.querySelector('.moment-host')?.classList.contains('visible')) {
      let feedback = this.root.querySelector<HTMLElement>('.accuracy-feedback');
      if (!feedback) {
        feedback = document.createElement('div');
        feedback.className = 'accuracy-feedback';
        this.root.querySelector('.game-screen')?.append(feedback);
      }
      feedback.dataset.accuracy = snapshot.accuracy;
      feedback.textContent = snapshot.accuracy === 'PERFECT' ? 'PERFECT DROP' : snapshot.accuracy;
      feedback.classList.remove('visible');
      void feedback.offsetWidth;
      feedback.classList.add('visible');
      this.setText('[data-hud="status"]', `${snapshot.accuracy}. Altura ${value} metros. ${snapshot.objectsPlaced} objetos apilados.`);
    }
    this.lastObjects = snapshot.objectsPlaced;
    const combo = this.root.querySelector<HTMLElement>('[data-hud="combo"]');
    if (combo) {
      const comboLabel = snapshot.combo > 1 ? `COMBO ×${snapshot.combo}` : '';
      if (combo.textContent !== comboLabel) combo.textContent = comboLabel;
      combo.classList.toggle('visible', snapshot.combo > 1);
    }
    const hint = this.root.querySelector<HTMLElement>('[data-hud="hint"]');
    if (hint) {
      const ready = snapshot.state === 'ready';
      hint.classList.toggle('is-hidden', !ready || snapshot.objectsPlaced > 2);
      if (this.tutorialForRun && snapshot.objectsPlaced === 1 && ready) hint.innerHTML = `${icon('target')} Apilá todo lo que puedas<span class="tap-hint-line"></span>`;
    }
    if (this.debug) this.setText('[data-debug-fps]', `${Math.round(snapshot.fps)} FPS · ${snapshot.objectsPlaced} cuerpos`);
  }

  showResult(result: RunResult, profile: Profile): void {
    this.closeDialog();
    this.result = result;
    this.profile = profile;
    this.screen = 'result';
    this.paused = false;
    this.root.dataset.screen = 'result';
    this.renderResult();
    this.updateDesktop();
  }

  setProfile(profile: Profile): void {
    this.profile = profile;
    this.updateDesktop();
    if (this.screen === 'menu' && this.profile) this.renderMenu();
    if (this.screen === 'result') this.renderResult();
    if (this.dialog?.open && this.dialog.dataset.kind === 'skins') this.renderSkinsBody();
  }

  toast(message: string): void {
    clearTimeout(this.toastTimer);
    this.root.querySelectorAll('.toast-host.visible,.dialog-toast.visible').forEach(node => node.classList.remove('visible'));
    let target = this.root.querySelector<HTMLElement>('.toast-host')!;
    if (this.dialog?.open) {
      let notification = this.dialog.querySelector<HTMLElement>('.dialog-toast');
      if (!notification) {
        notification = document.createElement('div');
        notification.className = 'dialog-toast';
        notification.setAttribute('role', 'status');
        this.dialog.append(notification);
      }
      target = notification;
    }
    target.textContent = message;
    target.classList.add('visible');
    this.toastTimer = window.setTimeout(() => target.classList.remove('visible'), 3300);
  }

  showMoment(message: string): void {
    clearTimeout(this.momentTimer);
    this.root.querySelector('.accuracy-feedback')?.classList.remove('visible');
    const target = this.root.querySelector<HTMLElement>('.moment-host')!;
    target.innerHTML = `<span class="moment-star">✦</span><span>${escape(message)}</span>`;
    target.classList.remove('visible');
    void target.offsetWidth;
    target.classList.add('visible');
    this.momentTimer = window.setTimeout(() => target.classList.remove('visible'), 2300);
  }

  showShareLink(url: string): void {
    this.openDialog('share-link', 'La revancha empieza acá.', `<p class="dialog-description">Mandale este enlace a un amigo. Va a jugar exactamente la misma secuencia que vos.</p><label class="share-link-label" for="challenge-link">TU ENLACE DE DESAFÍO</label><textarea id="challenge-link" class="share-link-input" readonly rows="4" spellcheck="false">${escape(url)}</textarea><button class="primary-button" type="button" data-action="copy-share">COPIAR ENLACE ${icon('share')}</button><p class="fine-print">También podés seleccionar el enlace y copiarlo manualmente.</p>`);
    const input = this.dialog?.querySelector<HTMLTextAreaElement>('#challenge-link');
    input?.addEventListener('click', () => input.select());
  }

  setRewardAvailability(available: boolean, canSecondChance: boolean, canDoubleCoins = true): void {
    this.rewardAvailable = available;
    this.canSecondChance = canSecondChance;
    this.canDoubleCoins = canDoubleCoins;
    if (this.screen === 'result') this.renderResult();
    if (this.dialog?.open && this.dialog.dataset.kind === 'skins') this.renderSkinsBody();
  }

  setShopRewards(bonusRemaining: number, trialAvailable: boolean): void {
    this.bonusRemaining = bonusRemaining;
    this.trialAvailable = trialAvailable;
    if (this.dialog?.open && this.dialog.dataset.kind === 'skins') this.renderSkinsBody();
  }

  setAdActive(active: boolean): void {
    if (active) {
      this.adDialogSuspended = this.dialog?.open ?? false;
      if (this.adDialogSuspended) this.dialog?.close();
    } else if (this.adDialogSuspended) {
      this.adDialogSuspended = false;
      if (this.dialog?.isConnected && !this.dialog.open) this.dialog.showModal();
    }
  }

  showLeaderboard(entries: LeaderboardEntry[], kind: 'today' | 'all-time'): void {
    if (!this.backendAvailable) return;
    const rows = entries.map((entry, index) => `<li><span class="leaderboard-place">${String(index + 1).padStart(2, '0')}</span><strong>${escape(entry.name || 'Anónimo')}</strong><span>${meters(entry.height)} <small>m</small></span></li>`).join('');
    this.openDialog('ranking', 'Ranking', `<div class="dialog-tabs"><button type="button" class="${kind === 'today' ? 'active' : ''}" data-action="ranking-today">HOY</button><button type="button" class="${kind === 'all-time' ? 'active' : ''}" data-action="ranking-all-time">SIEMPRE</button></div><p class="dialog-description">${kind === 'today' ? 'La misma torre. Los mejores timings de hoy.' : 'Las torres más altas de todos los tiempos.'}</p>${rows ? `<ol class="leaderboard-list">${rows}</ol>` : `<div class="empty-state">${icon('trophy')}<strong>Sé el primero.</strong><p>Jugá una partida y dejá tu marca.</p></div>`}<p class="fine-print">Tu nombre público es opcional. Podés editarlo en Ajustes.</p>`);
  }

  setBackendAvailable(available: boolean): void {
    this.backendAvailable = available;
    if (this.screen === 'menu' && this.profile) this.renderMenu();
  }

  showInstallAvailable(available: boolean): void {
    this.installAvailable = available;
    if (this.screen === 'menu' && this.profile) this.renderMenu();
  }

  private get host(): HTMLElement { return this.root.querySelector<HTMLElement>('.screen-host')!; }

  private renderMenu(): void {
    const today = new Date().toISOString().slice(0, 10);
    const daily = this.profile.daily[today];
    this.host.innerHTML = `<section class="menu-screen"><div class="menu-background"><div class="menu-orbit"></div><span class="background-cross cross-one">+</span><span class="background-cross cross-two">+</span></div><header class="menu-header"><span class="mini-wordmark"><span class="brand-mark">${icon('bolt')}</span> IT.</span><span class="coin-balance">${icon('coin')} <b>${this.profile.coins}</b></span></header><div class="menu-title"><div class="menu-eyebrow"><span class="status-dot"></span> APILÁ LO IMPOSIBLE</div><h1>IMPOSSIBLE<br><span>TOWER</span><span class="title-dot">+</span></h1><p>La gravedad tiene otros planes.</p></div><div class="menu-art">${towerArt()}<div class="best-sticker"><span>${icon('trophy')} TU RÉCORD</span><strong>${meters(this.profile.personalBest)}<small> m</small></strong></div><span class="art-caption">UN POCO DE TIMING.<br>UN POCO DE CAOS.</span></div>${this.challenge ? `<div class="challenge-invite"><span>${icon('users')} DESAFÍO RECIBIDO</span><p><strong>${escape(this.challenge.name || 'Un amigo')}</strong> llegó a <strong>${meters(this.challenge.height)} m</strong>.<br>¿Podés superarlo?</p></div>` : ''}<div class="menu-actions"><button type="button" class="primary-button play-button" data-action="${this.challenge ? 'challenge' : 'play'}"><span>${this.challenge ? 'ACEPTAR DESAFÍO' : 'JUGAR'}</span>${icon('arrow')}</button><button type="button" class="daily-button" data-action="daily"><span class="daily-icon">${icon('calendar')}</span><span><strong>DAILY TOWER</strong><small>${daily ? `HOY: ${meters(daily.best)} m · ${daily.attempts} INTENTO${daily.attempts === 1 ? '' : 'S'}${this.profile.dailyStreak ? ` · RACHA ${this.profile.dailyStreak}` : ''}` : 'LA MISMA TORRE. UN NUEVO DESAFÍO.'}</small></span>${icon('arrow')}</button></div><nav class="menu-nav" aria-label="Opciones del juego"><button type="button" data-action="skins">${icon('skin')}<span>Skins</span></button><button type="button" data-action="achievements">${icon('trophy')}<span>Logros</span></button><button type="button" data-action="missions">${icon('target')}<span>Misiones</span></button><button type="button" data-action="settings">${icon('settings')}<span>Ajustes</span></button>${this.backendAvailable ? `<button type="button" data-action="ranking-today">${icon('chart')}<span>Ranking</span></button>` : ''}</nav><footer class="menu-footer"><span>UN TOQUE PARA SOLTAR. NADA MÁS.</span>${this.installAvailable ? `<button type="button" data-action="install" class="install-link">${icon('download')} Instalar</button>` : '<span class="menu-version">V1.0</span>'}</footer></section>`;
  }

  private renderResult(): void {
    const result = this.result!;
    const challengeMessage = result.mode === 'challenge' && this.config?.challenge
      ? (result.challengeWon ? 'GANASTE EL DESAFÍO' : `TE FALTARON ${meters(Math.max(0, this.config.challenge.height - result.height))} m`)
      : result.personalBest ? 'NUEVO RÉCORD PERSONAL' : result.reason === 'collapse' ? 'LA GRAVEDAD GANÓ ESTA VEZ' : 'UNA MÁS. UN POCO MÁS ALTO.';
    this.host.innerHTML = `<section class="result-screen"><div class="result-grid"></div><header class="result-header"><span class="mini-wordmark"><span class="brand-mark">${icon('bolt')}</span> IT.</span><button class="icon-button" type="button" data-action="menu" aria-label="Volver al menú">${icon('home')}</button></header><div class="result-heading"><span class="result-eyebrow ${result.personalBest || result.challengeWon ? 'is-record' : ''}">${result.personalBest || result.challengeWon ? icon('trophy') : icon('bolt')}${escape(challengeMessage)}</span><h1>${result.height > 0 ? 'BIEN ALTO.<br><span>BIEN HECHO.</span>' : 'CASI, CASI.<br><span>OTRA MÁS.</span>'}</h1></div><div class="result-height"><span class="result-height-label">TU TORRE LLEGÓ A</span><div><strong>${meters(result.height)}</strong><span>m</span></div><span class="height-rule"><i></i><span>EL CIELO PUEDE ESPERAR</span><i></i></span></div><div class="result-stats"><div><strong>${result.objectsPlaced}</strong><span>OBJETOS</span></div><div><strong>${result.perfectDrops}</strong><span>PERFECT DROPS</span></div><div><strong>${result.score}</strong><span>SCORE</span></div></div><div class="result-record"><span>${icon('trophy')} RÉCORD PERSONAL <strong>${meters(this.profile.personalBest)} m</strong></span><span class="result-coins">${icon('coin')} +${result.coins}</span></div><div class="result-actions"><button class="primary-button" type="button" data-action="restart"><span>JUGAR DE NUEVO</span>${icon('arrow')}</button><button class="challenge-button" type="button" data-action="challenge-share">${icon('users')}<span>DESAFIAR A UN AMIGO</span>${icon('arrow')}</button><button class="share-button" type="button" data-action="share">${icon('share')} COMPARTIR RESULTADO</button></div><div class="reward-actions">${this.rewardAvailable && this.canSecondChance ? `<button class="reward-button" type="button" data-action="second-chance">${icon('bolt')} Segunda oportunidad <span>VER ANUNCIO</span></button>` : ''}${this.rewardAvailable && this.canDoubleCoins && result.coins > 0 ? `<button class="reward-button" type="button" data-action="double-coins">${icon('coin')} Duplicar coins <span>VER ANUNCIO</span></button>` : ''}</div><footer class="result-footer">${result.mode === 'daily' ? `${icon('calendar')} DAILY TOWER · ${this.profile.dailyStreak} DÍA${this.profile.dailyStreak === 1 ? '' : 'S'} DE RACHA` : 'DE UNA CAJA A UN COHETE. VOLVÉ A INTENTAR.'}</footer></section>`;
  }

  private handleClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!button || button.hasAttribute('disabled')) return;
    const action = button.dataset.action;
    if (action === 'close') {
      this.closeDialog();
      if (this.paused && this.screen === 'game') {
        this.paused = false;
        this.onAction({ type: 'pause', paused: false });
      }
      return;
    }
    if (action === 'play' || action === 'daily' || action === 'challenge') { this.onAction({ type: 'play', mode: action === 'play' ? 'casual' : action === 'daily' ? 'daily' : 'challenge' }); return; }
    if (action === 'restart' || action === 'menu') { this.closeDialog(); this.onAction({ type: action }); return; }
    if (action === 'pause') { this.paused = true; this.onAction({ type: 'pause', paused: true }); this.openPause(); return; }
    if (action === 'resume') { this.paused = false; this.closeDialog(); this.onAction({ type: 'pause', paused: false }); return; }
    if (action === 'share' || action === 'challenge-share') { this.onAction({ type: 'share', image: action === 'share' }); return; }
    if (action === 'copy-share') {
      const input = this.dialog?.querySelector<HTMLTextAreaElement>('#challenge-link');
      if (input) void this.copyShareLink(input);
      return;
    }
    if (action === 'settings') { this.openSettings(); return; }
    if (action === 'skins') { this.openSkins(); return; }
    if (action === 'achievements') { this.openAchievements(); return; }
    if (action === 'missions') { this.openMissions(); return; }
    if (action === 'install') { this.onAction({ type: 'install' }); return; }
    if (action === 'privacy' || action === 'terms') { this.openLegal(action); return; }
    if (action === 'ranking-today' || action === 'ranking-all-time') { this.onAction({ type: 'leaderboard', kind: action === 'ranking-today' ? 'today' : 'all-time' }); return; }
    if (action === 'cosmetic') { this.onAction({ type: 'cosmetic', id: button.dataset.id! }); return; }
    if (action === 'second-chance' || action === 'double-coins' || action === 'cosmetic-trial' || action === 'coin-bonus') {
      this.onAction({ type: 'reward', reward: action }); return;
    }
    if (action === 'toggle') {
      const setting = button.dataset.setting as 'music' | 'sfx' | 'haptics';
      const settings = { ...this.profile.settings, [setting]: !this.profile.settings[setting] };
      this.profile = { ...this.profile, settings };
      button.setAttribute('aria-checked', String(settings[setting]));
      button.classList.toggle('is-on', settings[setting]);
      button.querySelector('.toggle-state')!.textContent = settings[setting] ? 'ON' : 'OFF';
      this.onAction({ type: 'settings', settings });
      return;
    }
    if (action === 'save-name') {
      const input = this.dialog?.querySelector<HTMLInputElement>('#public-name');
      if (input) { this.onAction({ type: 'name', name: input.value.slice(0, 24).trim() }); this.toast('Nombre público guardado'); }
    }
  }

  private openDialog(kind: string, title: string, body: string): void {
    const focused = document.activeElement as HTMLElement;
    this.closeDialog();
    const dialog = document.createElement('dialog');
    dialog.className = 'ui-dialog';
    dialog.dataset.kind = kind;
    dialog.innerHTML = `<header class="dialog-header"><div><span class="dialog-eyebrow">IMPOSSIBLE TOWER</span><h2>${escape(title)}</h2></div><button class="icon-button" type="button" data-action="close" aria-label="Cerrar ${escape(title)}">${icon('close')}</button></header><div class="dialog-body">${body}</div>`;
    dialog.setAttribute('aria-label', title);
    dialog.addEventListener('cancel', event => {
      if (this.paused && this.screen === 'game') {
        event.preventDefault();
        this.paused = false;
        this.closeDialog();
        this.onAction({ type: 'pause', paused: false });
      }
    });
    dialog.addEventListener('close', () => { if (focused?.isConnected) focused.focus(); });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          if (this.paused) { this.paused = false; this.onAction({ type: 'pause', paused: false }); }
          this.closeDialog();
        }
      }
    });
    this.root.append(dialog);
    this.dialog = dialog;
    dialog.showModal();
  }

  private closeDialog(): void {
    if (this.dialog) {
      this.dialog.close();
      this.dialog.remove();
      this.dialog = undefined;
    }
  }

  private openPause(): void {
    this.openDialog('pause', 'Tomate un respiro.', `<div class="pause-art">${icon('pause')}</div><p class="dialog-description centered">La gravedad también puede esperar.</p><button class="primary-button" type="button" data-action="resume">SEGUIR JUGANDO ${icon('play')}</button><button class="plain-button" type="button" data-action="menu">${icon('home')} VOLVER AL MENÚ</button>`);
    const close = this.dialog?.querySelector<HTMLButtonElement>('[data-action="close"]');
    if (close) close.dataset.action = 'resume';
    if (this.dialog) {
      this.dialog.tabIndex = -1;
      this.dialog.focus();
    }
  }

  private openSettings(): void {
    const switches = ([['music', 'Música', 'music'], ['sfx', 'Efectos de sonido', 'sound'], ['haptics', 'Vibración', 'haptic']] as const).map(([setting, label, symbol]) => `<div class="setting-row"><span>${icon(symbol)}${label}</span><button type="button" class="toggle ${this.profile.settings[setting] ? 'is-on' : ''}" role="switch" aria-checked="${this.profile.settings[setting]}" aria-label="${label}" data-action="toggle" data-setting="${setting}"><span class="toggle-state">${this.profile.settings[setting] ? 'ON' : 'OFF'}</span><i></i></button></div>`).join('');
    this.openDialog('settings', 'A tu manera.', `<p class="dialog-description">Buen timing. Buenas preferencias.</p><div class="settings-list">${switches}</div><div class="name-setting"><label for="public-name">NOMBRE PÚBLICO <span>OPCIONAL</span></label><p>Aparece en tus desafíos${this.backendAvailable ? ' y en el ranking' : ''}.</p><div class="name-input-row"><input id="public-name" type="text" value="${escape(this.profile.publicName)}" maxlength="24" placeholder="¿Cómo te llaman?" autocomplete="nickname"><button type="button" data-action="save-name" aria-label="Guardar nombre">${icon('check')}</button></div></div><p class="fine-print">Tu progreso se guarda en este dispositivo. Las coins solo se usan dentro del juego.</p><div class="dialog-legal"><button type="button" data-action="privacy">Privacidad</button><span>·</span><button type="button" data-action="terms">Términos</button></div>`);
  }

  private openSkins(): void {
    this.onAction({ type: 'reward-options' });
    this.openDialog('skins', 'Un poco de estilo.', '');
    this.renderSkinsBody();
  }

  private renderSkinsBody(): void {
    const body = this.dialog?.querySelector('.dialog-body');
    if (!body) return;
    const categoryNames = { crane: 'GRÚAS', background: 'CIELOS', trail: 'ESTELAS', effect: 'ATERRIZAJES' };
    const categories = (Object.keys(categoryNames) as (keyof typeof categoryNames)[]).map(category => `<section class="cosmetic-category"><h3>${categoryNames[category]}</h3><div class="cosmetic-grid">${COSMETICS.filter(cosmetic => cosmetic.category === category).map(cosmetic => {
      const owned = this.profile.unlockedCosmetics.includes(cosmetic.id) || cosmetic.price === 0;
      const selected = this.profile.selectedCosmetics[category] === cosmetic.id;
      return `<button type="button" class="cosmetic-card ${selected ? 'selected' : ''} ${owned ? 'owned' : ''}" data-action="cosmetic" data-id="${escape(cosmetic.id)}" aria-pressed="${selected}" ${!owned && this.profile.coins < cosmetic.price ? 'disabled' : ''}><span class="cosmetic-preview cosmetic-${category}" style="--cosmetic-color:${escape(cosmetic.color)}">${category === 'crane' ? '<svg viewBox="0 0 80 48" aria-hidden="true"><path d="M13 35V8h40m-33 0v27M13 15h40m-31 0 10-7 10 7m-10 0 10-7 10 7M49 9v20m-5 0h10m-5 0v5"/><path d="M7 37h19"/></svg>' : category === 'background' ? '<i class="preview-sun"></i><i class="preview-hill"></i>' : category === 'trail' ? '<i class="preview-trail"></i><i class="preview-trail second"></i><i class="preview-trail third"></i>' : '<span class="preview-spark">✦</span>'}${selected ? `<i class="selected-check">${icon('check')}</i>` : ''}</span><strong>${escape(cosmetic.name)}</strong><small>${selected ? 'EQUIPADO' : owned ? 'EQUIPAR' : `${icon('coin')} ${cosmetic.price}`}</small></button>`;
    }).join('')}</div></section>`).join('');
    body.innerHTML = `<div class="shop-heading"><p>Solo cambia el look.<br>La gravedad sigue igual.</p><span class="shop-coins">${icon('coin')} ${this.profile.coins}</span></div>${categories}${this.rewardAvailable ? `<section class="shop-rewards" aria-label="Recompensas opcionales"><h3>UN EXTRA OPCIONAL</h3><p>Elegí una recompensa y mirá un anuncio.</p><button type="button" class="reward-button" data-action="coin-bonus" ${this.bonusRemaining === 0 ? 'disabled' : ''}>${icon('coin')} +25 coins <span>${this.bonusRemaining > 0 ? `VER ANUNCIO · ${this.bonusRemaining}/3 HOY` : 'LÍMITE DE HOY ALCANZADO'}</span></button>${this.trialAvailable ? `<button type="button" class="reward-button" data-action="cosmetic-trial">${icon('skin')} Probar Confeti <span>PRÓXIMA TORRE · VER ANUNCIO</span></button>` : ''}</section>` : ''}`;
  }

  private openAchievements(): void {
    const earned = this.profile.achievements.length;
    this.openDialog('achievements', 'Pequeñas grandes hazañas.', `<div class="achievement-progress"><strong>${earned}<span> / ${ACHIEVEMENTS.length}</span></strong><span>LOGROS DESBLOQUEADOS</span></div><div class="collection-list">${ACHIEVEMENTS.map(achievement => {
      const unlocked = this.profile.achievements.includes(achievement.id);
      return `<div class="achievement-row ${unlocked ? 'unlocked' : ''}"><span class="achievement-symbol">${icon(unlocked ? 'trophy' : 'lock')}</span><div><strong>${escape(achievement.name)}</strong><p>${escape(achievement.description)}</p></div>${unlocked ? icon('check') : '<span class="achievement-dot"></span>'}</div>`;
    }).join('')}</div>`);
  }

  private openMissions(): void {
    const active = typeof getActiveMissions === 'function' ? getActiveMissions(this.profile) : MISSIONS.slice(0, 3);
    this.openDialog('missions', 'Algo por lo que apilar.', `<p class="dialog-description">Tres objetivos. Un montón de posibilidades.<br>Las recompensas se suman al completarlos.</p><div class="mission-list">${active.map(mission => {
      const state = this.profile.missions[mission.id] || { progress: 0, claimed: false };
      const progress = Math.min(mission.target, state.progress);
      return `<div class="mission-card"><div class="mission-top"><span class="mission-icon">${icon(state.claimed ? 'check' : 'target')}</span><span class="mission-reward">${icon('coin')} +${mission.reward}</span></div><h3>${escape(mission.name)}</h3><div class="mission-progress"><span style="width:${Math.min(100, Math.max(0, progress / mission.target * 100))}%"></span></div><div class="mission-meta"><span>${progress} / ${mission.target}</span><span>${state.claimed ? 'COMPLETADA' : 'EN PROGRESO'}</span></div></div>`;
    }).join('')}</div><p class="fine-print">Los objetivos rotan a medida que jugás y completás misiones.</p>`);
  }

  private openLegal(kind: 'privacy' | 'terms'): void {
    const document = LEGAL_DOCUMENTS[kind];
    this.openDialog(kind, document.title, `${renderLegalBody(document)}<div class="dialog-legal"><a href="${document.path}" target="_blank" rel="noopener">Abrir página pública</a><span>·</span><a href="${LEGAL_DOCUMENTS.ranking.path}" target="_blank" rel="noopener">Reglas del ranking</a></div>`);
  }

  private createDebugPanel(): void {
    const panel = document.createElement('details');
    panel.className = 'debug-panel';
    panel.innerHTML = `<summary>DEBUG <span data-debug-fps>— FPS</span></summary><div class="debug-controls"><label>Seed<input data-debug-value="seed" placeholder="mi-seed"></label><button type="button" data-debug-command="seed">Usar seed</button><label>Objeto<input data-debug-value="force-object" placeholder="box"></label><button type="button" data-debug-command="force-object">Forzar objeto</button><label>Coins<input type="number" data-debug-value="coins" value="1000"></label><button type="button" data-debug-command="coins">Agregar coins</button><label>Altura<input type="number" data-debug-value="height" value="100"></label><button type="button" data-debug-command="height">Saltar altura</button><button type="button" data-debug-command="bodies">Cuerpos + centro de masa</button><button type="button" data-debug-command="ad-success">Ad success</button><button type="button" data-debug-command="ad-error">Ad error</button><button type="button" data-debug-command="end-run">Game over</button><button type="button" data-debug-command="auto-stack">Auto stack</button><button type="button" data-debug-command="reset">Reset local storage</button></div>`;
    panel.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-debug-command]');
      if (!button) return;
      const command = button.dataset.debugCommand!;
      const input = panel.querySelector<HTMLInputElement>(`[data-debug-value="${command}"]`);
      this.onAction({ type: 'debug', command, value: input?.value });
    });
    this.root.append(panel);
  }

  private updateDesktop(): void {
    this.desktop.querySelector<HTMLElement>('[data-desktop-best]')!.textContent = meters(this.profile?.personalBest || 0);
  }

  private async copyShareLink(input: HTMLTextAreaElement): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(input.value);
        this.toast('Enlace copiado. ¡Desafiá a alguien!');
        return;
      }
    } catch { /* Selection remains available when browser permissions deny copying. */ }
    input.focus();
    input.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Manual selection is the final fallback. */ }
    this.toast(copied ? 'Enlace copiado. ¡Desafiá a alguien!' : 'El enlace está seleccionado. Copialo para compartir.');
  }

  private setText(selector: string, value: string | number): void {
    const node = this.root.querySelector<HTMLElement>(selector);
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }
}
