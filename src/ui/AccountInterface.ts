import { AID_CATALOG, COIN_PACKS, ECONOMY_LIMITS, rankingPrize, validLoadout, type AidId, type PackId, type RankingPeriod } from '../content/economy';
import { LEGAL_DOCUMENTS } from '../content/legal';
import { ACCOUNT_COSMETICS } from '../content/cosmetics';
import { privacyConsent, type AgeGroup, type AdsConsent } from '../services/privacy';
import type { AccountRun, AccountSnapshot, RankingEntry, RankingSnapshot } from '../types/account';
import type { GameSnapshot } from '../types';
import './account.css';

export type AccountAction =
  | { type: 'login'; email: string; mode: 'link' | 'sign-in' }
  | { type: 'verify'; email: string; token: string; mode: 'link' | 'sign-in' }
  | { type: 'buyAid'; id: AidId }
  | { type: 'useAid'; id: AidId }
  | { type: 'loadout'; aids: AidId[] }
  | { type: 'rankings'; period: RankingPeriod }
  | { type: 'buyCoins'; packId: PackId; adultConfirmed: boolean }
  | { type: 'buyCosmetic'; id: string }
  | { type: 'equipCosmetic'; id: string }
  | { type: 'ageGroup'; value: AgeGroup }
  | { type: 'guardian'; authorized: boolean }
  | { type: 'adsConsent'; value: AdsConsent };

export interface AccountViewState {
  localCoins: number;
  snapshot: AccountSnapshot | null;
  email?: string;
  otpSent?: boolean;
  authMode?: 'link' | 'sign-in';
  busy?: boolean;
  error?: string;
  run?: AccountRun | null;
  selectedCosmetic?: string;
}

export interface AccountEnabledFlags {
  economy: boolean;
  rankings: boolean;
  rankingPeriods: RankingPeriod[];
  payments: boolean;
  paymentMode: 'disabled' | 'sandbox' | 'live';
  onlineAllowed: boolean;
}

export interface AccountRunView {
  available: AidId[];
  used: AidId[];
  canAid: (id: AidId) => boolean;
}

type View = 'account' | 'shop' | 'leaderboard' | 'run' | 'privacy';
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const integer = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const aidIds = Object.keys(AID_CATALOG) as AidId[];
const periods: Record<RankingPeriod, string> = { daily: 'Diario', weekly: 'Semanal', monthly: 'Mensual' };
const descriptions: Record<AidId, string> = {
  'guide-5': 'Una línea vertical de alineación para los primeros 5 objetos.',
  'guide-10': 'La misma guía durante los primeros 10 objetos.',
  preview: 'Mirá cuáles serán los próximos 3 objetos.',
  focus: 'La grúa va a mitad de velocidad durante 3 objetos.',
  skip: 'Reemplazá una pieza antes de soltarla. Una vez por torre.',
  'second-chance': 'Recuperá una torre tras fallar, con al menos 3 objetos colocados.',
};
const legalLinks = (): string => `<nav class="account-legal" aria-label="Información legal"><a href="${LEGAL_DOCUMENTS.privacy.path}" target="_blank" rel="noopener">Privacidad</a><a href="${LEGAL_DOCUMENTS.terms.path}" target="_blank" rel="noopener">Términos</a><a href="${LEGAL_DOCUMENTS.ranking.path}" target="_blank" rel="noopener">Reglas</a></nav>`;

export function canSelectAid(selected: AidId[], inventory: Partial<Record<AidId, number>>, id: AidId): boolean {
  return selected.includes(id) || integer(inventory[id] ?? 0) > 0 && validLoadout([...selected, id]);
}

export function canBuyAid(state: AccountViewState, flags: AccountEnabledFlags, id: AidId): boolean {
  return flags.economy && flags.onlineAllowed && !state.busy && state.snapshot?.recoverable === true && state.snapshot.balance >= AID_CATALOG[id].price;
}

export class AccountInterface {
  private state: AccountViewState = { localCoins: 0, snapshot: null };
  private flags: AccountEnabledFlags = { economy: false, rankings: false, rankingPeriods: ['daily'], payments: false, paymentMode: 'disabled', onlineAllowed: false };
  private readonly dialog = document.createElement('dialog');
  private view: View | null = null;
  private privacyDestination: 'account' | 'shop' = 'account';
  private selected: AidId[] = [];
  private ranking: RankingSnapshot | null = null;
  private period: RankingPeriod = 'daily';
  private rankingError = '';
  private snapshot: GameSnapshot | null = null;
  private runView: AccountRunView = { available: [], used: [], canAid: () => false };
  private runSignature = '';
  private purchaseAdultConfirmed = false;
  private dialogActive = false;

  constructor(private readonly root: HTMLElement, private readonly options: { onAction: (action: AccountAction) => void; onDialogChange?: (open: boolean) => void }) {
    this.dialog.className = 'account-dialog';
    this.dialog.setAttribute('aria-labelledby', 'account-dialog-title');
    root.append(this.dialog);
    root.addEventListener('click', event => this.handleClick(event));
    this.dialog.addEventListener('pointerdown', event => event.stopPropagation());
    this.dialog.addEventListener('submit', event => this.handleSubmit(event));
    this.dialog.addEventListener('change', event => this.handleChange(event));
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return;
      this.view = null;
      this.purchaseAdultConfirmed = false;
      if (this.dialogActive) { this.dialogActive = false; options.onDialogChange?.(false); }
    });
    privacyConsent.subscribe(() => {
      if (this.view === 'privacy') this.renderActive();
    });
  }

  setState(state: Partial<AccountViewState>): void {
    this.state = { ...this.state, ...state };
    const inventory = this.state.snapshot?.inventory;
    if (inventory && !this.snapshot) this.selected = this.selected.filter(id => integer(inventory[id] ?? 0) > 0);
    this.renderActive();
  }

  setEnabledFlags(flags: Partial<AccountEnabledFlags>): void {
    this.flags = { ...this.flags, ...flags };
    this.renderActive();
    this.renderMenu();
  }

  renderMenu(): void {
    const menu = this.root.querySelector<HTMLElement>('.menu-screen');
    if (menu && !menu.querySelector('.account-menu-controls')) {
      const controls = document.createElement('nav');
      controls.className = 'account-menu-controls';
      controls.setAttribute('aria-label', 'Cuenta y ayudas');
      controls.innerHTML = '<button type="button" data-account-action="account"><span aria-hidden="true">◎</span>CUENTA</button><button type="button" data-account-action="shop"><span aria-hidden="true">＋</span>TIENDA DE AYUDAS</button><button type="button" data-account-action="ranking" data-period="daily"><span aria-hidden="true">↗</span>RANKINGS</button>';
      menu.querySelector('.menu-footer')?.before(controls);
    }
    const header = this.root.querySelector<HTMLElement>('.game-header');
    if (header && this.snapshot && this.flags.economy && this.flags.onlineAllowed && !header.querySelector('.account-hud-button')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account-hud-button';
      button.dataset.accountAction = 'run-aids';
      header.querySelector('.pause-button')?.before(button);
    }
    const button = header?.querySelector<HTMLButtonElement>('.account-hud-button');
    if (button) {
      button.textContent = `AYUDAS ${this.runView.used.length}/2`;
      button.disabled = !!this.state.busy;
    }
    const result = this.root.querySelector<HTMLElement>('.result-screen');
    if (result) {
      const available = this.flags.economy && this.flags.onlineAllowed && this.runView.available.includes('second-chance') && !this.runView.used.includes('second-chance') && this.runView.used.length < 2 && this.runView.canAid('second-chance');
      let revive = result.querySelector<HTMLButtonElement>('.account-revive-result');
      if (!available) revive?.remove();
      else {
        if (!revive) {
          revive = document.createElement('button');
          revive.type = 'button';
          revive.className = 'account-revive-result reward-button';
          revive.dataset.accountAction = 'use-aid';
          revive.dataset.aid = 'second-chance';
          revive.innerHTML = 'SEGUNDA OPORTUNIDAD <span>USAR AYUDA PREPARADA</span>';
          (result.querySelector('.reward-actions') ?? result.querySelector('.result-actions'))?.append(revive);
        }
        revive.disabled = !!this.state.busy;
      }
    }
  }

  showAccount(state?: Partial<AccountViewState>): void {
    if (state) this.state = { ...this.state, ...state };
    this.privacyDestination = 'account';
    this.open(privacyConsent.canUseOnlineServices() ? 'account' : 'privacy');
  }

  showShop(state?: Partial<AccountViewState>): void {
    if (state) this.state = { ...this.state, ...state };
    this.privacyDestination = 'shop';
    this.open(privacyConsent.canUseOnlineServices() ? 'shop' : 'privacy');
  }

  showPrivacySetup(): void { this.open('privacy'); }

  showLeaderboard(data: RankingSnapshot | null, period: RankingPeriod = data?.period ?? this.period, error = ''): void {
    this.ranking = data;
    this.period = period;
    this.rankingError = error;
    this.open('leaderboard');
  }

  setRun(snapshot: GameSnapshot | null, view?: Partial<AccountRunView>): void {
    this.snapshot = snapshot;
    if (view) this.runView = { ...this.runView, ...view };
    else if (!snapshot) this.runView = { available: [], used: [], canAid: () => false };
    const signature = snapshot ? `${snapshot.state}:${snapshot.objectsPlaced}:${this.runView.used.join(',')}:${this.runView.available.map(id => `${id}:${this.runView.canAid(id)}`).join(',')}` : '';
    if (signature !== this.runSignature) {
      this.runSignature = signature;
      if (this.view === 'run') this.renderActive();
    }
    this.renderMenu();
  }

  getLoadout(): AidId[] { return [...this.selected]; }
  clearLoadout(): void { this.selected = []; this.renderActive(); }
  closeDialog(): void {
    if (!this.dialog.open) return;
    this.dialog.close();
    this.view = null;
    this.purchaseAdultConfirmed = false;
    if (this.dialogActive) { this.dialogActive = false; this.options.onDialogChange?.(false); }
  }

  private open(view: View): void {
    this.view = view;
    this.renderActive();
    if (!this.dialog.open) {
      this.dialog.showModal();
      this.dialogActive = true;
      this.options.onDialogChange?.(true);
    }
  }

  private renderActive(): void {
    if (!this.view) return;
    const headings: Record<View, string> = { account: 'Tu cuenta. Tu torre.', shop: 'Un poco de ayuda.', leaderboard: 'El cielo tiene puestos.', run: 'Una ayuda a tiempo.', privacy: 'Antes de conectar.' };
    const content = this.view === 'account' ? this.accountContent() : this.view === 'shop' ? this.shopContent() : this.view === 'leaderboard' ? this.rankingContent() : this.view === 'run' ? this.runContent() : this.privacyContent();
    this.dialog.innerHTML = `<header class="account-dialog-header"><span class="account-eyebrow">IMPOSSIBLE TOWER</span><button type="button" class="account-close" data-account-action="close" aria-label="Cerrar">×</button><h2 id="account-dialog-title">${headings[this.view]}</h2></header><div class="account-dialog-body">${this.state.error ? `<p class="account-notice account-error" role="alert">${escape(this.state.error)}</p>` : ''}${content}${legalLinks()}</div>`;
  }

  private balances(): string {
    return `<div class="account-balances"><div><span>COINS LOCALES</span><strong>${integer(this.state.localCoins)}</strong><small>Para tus cosméticos actuales.</small></div><div><span>COINS DE CUENTA</span><strong>${this.state.snapshot ? integer(this.state.snapshot.balance) : '—'}</strong><small>${this.state.snapshot ? 'Para ayudas y compras online.' : 'Se muestran al conectar.'}</small></div></div>`;
  }

  private accountContent(): string {
    const state = this.state;
    if (!this.flags.economy) return `${this.balances()}<p class="account-notice">La cuenta online todavía no está habilitada. Podés seguir jugando y usando tus coins locales.</p><button class="account-secondary" type="button" data-account-action="privacy">Edad y privacidad</button>`;
    const authMode = state.authMode ?? 'link';
    const auth = state.snapshot?.recoverable ? `<p class="account-notice">Cuenta vinculada${state.email ? ` a ${escape(state.email)}` : ''}. Tu saldo e inventario de cuenta se pueden recuperar al iniciar sesión.</p>` : `<p class="account-copy">Vinculá un email para conservar tus coins de cuenta e inventario. Si tenés entre 13 y 17 años, este paso lo debe hacer tu responsable.</p><form class="account-form" data-account-form="login"><label for="account-email">EMAIL</label><input class="account-input" id="account-email" name="email" type="email" value="${escape(state.email)}" autocomplete="email" required maxlength="254" placeholder="tu@email.com" ${state.busy ? 'disabled' : ''}><fieldset class="account-auth-mode"><legend>Elegí cómo entrar</legend><label><input type="radio" name="mode" value="link" ${authMode === 'link' ? 'checked' : ''}> Vincular este progreso</label><label><input type="radio" name="mode" value="sign-in" ${authMode === 'sign-in' ? 'checked' : ''}> Recuperar mi cuenta</label></fieldset><button class="account-primary" type="submit" ${state.busy || !this.flags.onlineAllowed ? 'disabled' : ''}>${state.busy ? 'ENVIANDO…' : 'ENVIAR CÓDIGO'}</button></form>${state.otpSent ? `<form class="account-form" data-account-form="verify"><label for="account-otp">CÓDIGO RECIBIDO POR EMAIL</label><input class="account-input" id="account-otp" name="token" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6,10}" minlength="6" maxlength="10" placeholder="Código" ${state.busy ? 'disabled' : ''}><button class="account-primary" type="submit" ${state.busy ? 'disabled' : ''}>CONFIRMAR CÓDIGO</button></form>` : ''}`;
    return `${this.balances()}${auth}<p class="account-copy">El saldo local se conserva por separado. Vincularlo no lo convierte en coins de cuenta. La bienvenida de cuenta es de ${ECONOMY_LIMITS.starter} coins, una sola vez.</p>${this.pendingRun()}${state.snapshot ? `<dl class="account-limits"><div><dt>Partidas hoy</dt><dd>${integer(state.snapshot.gameplayEarned)} / ${ECONOMY_LIMITS.gameplayDaily}</dd></div><div><dt>Misiones hoy</dt><dd>${integer(state.snapshot.missionEarned)} / ${ECONOMY_LIMITS.missionsDaily}</dd></div><div><dt>Bonos de anuncio hoy</dt><dd>${integer(state.snapshot.adBonusClaims)} / ${ECONOMY_LIMITS.adCount}</dd></div></dl>` : ''}<div class="account-button-row"><button class="account-secondary" type="button" data-account-action="shop">TIENDA DE AYUDAS</button><button class="account-secondary" type="button" data-account-action="privacy">PRIVACIDAD</button></div>${state.snapshot?.transactions.length ? `<details class="account-details"><summary>Últimos movimientos</summary><ul class="account-transactions">${state.snapshot.transactions.slice(0, 8).map(item => `<li><span>${escape(item.source)}</span><strong>${item.coins >= 0 ? '+' : ''}${Math.trunc(item.coins)}</strong></li>`).join('')}</ul></details>` : ''}`;
  }

  private shopContent(): string {
    const inventory = this.state.snapshot?.inventory ?? {};
    const cards = aidIds.map(id => {
      const aid = AID_CATALOG[id], owned = integer(inventory[id] ?? 0), selected = this.selected.includes(id);
      return `<article class="account-aid"><div class="account-aid-heading"><h3>${aid.name}</h3><span>${owned} EN INVENTARIO</span></div><p>${descriptions[id]}</p><div class="account-button-row"><button class="account-secondary" type="button" data-account-action="buy-aid" data-aid="${id}" ${canBuyAid(this.state, this.flags, id) ? '' : 'disabled'}>COMPRAR · ${aid.price} COINS</button><button class="account-equip ${selected ? 'account-selected' : ''}" type="button" data-account-action="select-aid" data-aid="${id}" aria-pressed="${selected}" ${this.flags.economy && this.flags.onlineAllowed && !this.state.busy && canSelectAid(this.selected, inventory, id) ? '' : 'disabled'}>${selected ? 'PREPARADA ✓' : 'PREPARAR'}</button></div></article>`;
    }).join('');
    return `${this.balances()}${!this.flags.economy ? '<p class="account-notice">Las ayudas online todavía no están habilitadas.</p>' : !this.state.snapshot?.recoverable ? '<p class="account-notice">Vinculá tu cuenta para comprar y guardar ayudas. <button type="button" class="account-inline" data-account-action="account">Abrir cuenta</button></p>' : ''}<p class="account-copy">Prepará hasta 2 ayudas para tu próxima torre. Se consumen al activarse. Guía 5 y Guía 10 no se combinan. Las guías, vista previa y foco se activan al comenzar; cambiar pieza y segunda oportunidad cuando las necesitás.</p><p class="account-notice account-fairness">Las ayudas se permiten en los rankings y aparecen identificadas. Comprar coins puede dar una ventaja. Los intentos competitivos siguen siendo gratuitos e ilimitados.</p><div class="account-loadout" role="status">PRÓXIMA TORRE · ${this.selected.length}/2 AYUDAS${this.selected.length ? `<span>${this.selected.map(id => AID_CATALOG[id].name).join(' · ')}</span>` : '<span>Sin ayudas preparadas.</span>'}</div><div class="account-aid-list">${cards}</div>${this.cosmeticsContent()}${this.packsContent()}`;
  }

  private cosmeticsContent(): string {
    const owned = this.state.snapshot?.onlineCosmetics ?? [];
    const allowed = this.flags.economy && this.flags.onlineAllowed && this.state.snapshot?.recoverable && !this.state.busy;
    return `<section class="account-packs"><h3>ESTILOS DE CUENTA</h3><p>Se compran con coins de cuenta. Solo cambian el look.</p><div class="account-cosmetic-grid">${ACCOUNT_COSMETICS.map(cosmetic => {
      const purchased = owned.includes(cosmetic.id), equipped = this.state.selectedCosmetic === cosmetic.id;
      return `<article class="account-cosmetic"><span class="account-cosmetic-preview" style="--account-cosmetic:${escape(cosmetic.color)}" aria-hidden="true">⌁</span><strong>${escape(cosmetic.name)}</strong><small>${purchased ? 'EN TU CUENTA' : `${cosmetic.price} COINS`}</small><button class="account-secondary" type="button" data-account-action="${purchased ? 'equip-cosmetic' : 'buy-cosmetic'}" data-cosmetic="${escape(cosmetic.id)}" ${allowed && (purchased || this.state.snapshot!.balance >= cosmetic.price) ? '' : 'disabled'}>${equipped ? 'EQUIPADO ✓' : purchased ? 'EQUIPAR' : 'COMPRAR'}</button></article>`;
    }).join('')}</div></section>`;
  }

  private packsContent(): string {
    const available = this.flags.payments && this.flags.paymentMode !== 'disabled' && this.flags.onlineAllowed && this.state.snapshot?.recoverable;
    const title = this.flags.paymentMode === 'sandbox' ? 'PAGO DE PRUEBA · SIN CARGO REAL' : available ? 'COINS CON PAYPAL' : 'COMPRAS TODAVÍA NO DISPONIBLES';
    return `<section class="account-packs"><h3>${title}</h3><p>Las compras las realiza una persona de 18 años o más. Las coins no se pueden transferir ni canjear por dinero.</p>${available ? `<label class="account-check"><input type="checkbox" data-account-adult ${this.purchaseAdultConfirmed ? 'checked' : ''}> Soy la persona adulta responsable y autorizo esta compra con mi medio de pago.</label>` : ''}<div class="account-pack-grid">${(Object.keys(COIN_PACKS) as PackId[]).map(id => { const pack = COIN_PACKS[id]; return `<button type="button" class="account-pack" data-account-action="buy-coins" data-pack="${id}" ${available && this.purchaseAdultConfirmed && !this.state.busy ? '' : 'disabled'}><strong>${pack.coins}</strong><span>COINS</span><small>${pack.currency} ${pack.amount}</small></button>`; }).join('')}</div><p class="account-fine">${this.flags.paymentMode === 'sandbox' ? 'Este entorno solo procesa pagos de prueba.' : available ? 'Verás el total en PayPal antes de confirmar. Las coins se acreditan después de confirmar el pago.' : 'Estos packs no se pueden comprar hasta que se habiliten los pagos.'}</p></section>`;
  }

  private pendingRun(): string {
    const run = this.state.run;
    if (!run || run.status === 'started') return '';
    const copy: Record<Exclude<AccountRun['status'], 'started'>, string> = { pending: 'Resultado pendiente de verificación. Las coins y el puesto se mostrarán cuando se acepte.', validating: 'Estamos verificando tu resultado. Todavía no cuenta para premios.', accepted: 'Resultado verificado. Tu cuenta ya recibió las coins correspondientes.', rejected: 'Este resultado no fue aceptado en el ranking.', verification_timeout: 'La verificación no terminó a tiempo. Este resultado no cuenta para premios.' };
    return `<p class="account-notice" role="status">${copy[run.status]}${run.error ? `<br>${escape(run.error)}` : ''}</p>`;
  }

  private rankingContent(): string {
    const tabs = `<nav class="account-tabs" aria-label="Período del ranking">${(Object.keys(periods) as RankingPeriod[]).map(period => `<button type="button" data-account-action="ranking" data-period="${period}" aria-pressed="${period === this.period}" class="${period === this.period ? 'account-selected' : ''}" ${this.flags.rankings && !this.flags.rankingPeriods.includes(period) ? 'disabled' : ''}>${periods[period]}</button>`).join('')}</nav>`;
    if (!this.flags.rankings) return `${tabs}<p class="account-notice">Los rankings con premios todavía no están habilitados.</p>`;
    if (!this.flags.rankingPeriods.includes(this.period)) return `${tabs}<p class="account-notice">Este período se habilitará en una próxima etapa.</p>`;
    if (!this.ranking) return `${tabs}<p class="account-notice" role="status">${this.rankingError ? escape(this.rankingError) : 'Cargando resultados reales…'}</p><button class="account-secondary" type="button" data-account-action="ranking" data-period="${this.period}">VOLVER A CONSULTAR</button>`;
    const data = this.ranking;
    const rows = data.entries.map(row => this.rankingRow(row)).join('');
    return `${tabs}<div class="account-ranking-heading"><span>${escape(data.periodId)}</span><strong>${data.participants} PARTICIPANTES</strong></div><p class="account-copy">${data.status === 'settled' ? 'Período cerrado y premios liquidados.' : `Cierre: ${this.utcDate(data.endUTC)} UTC. Los puestos y premios son provisionales hasta la liquidación.`}</p>${this.pendingRun()}${data.ownEntry ? `<p class="account-own-place">TU PUESTO <strong>#${data.ownEntry.rank}</strong> · ${data.period === 'daily' ? `${data.ownEntry.height.toFixed(1)} m` : `${data.ownEntry.points} puntos`}</p>` : ''}${data.entries.length ? `<ol class="account-ranking-list" aria-label="Clasificación ${periods[this.period]}">${rows}</ol>` : '<p class="account-notice">Todavía no hay resultados aceptados en este período.</p>'}<details class="account-details"><summary>Cómo se calcula y qué se gana</summary><p class="account-copy">Diario: mejor altura, con desempate por score. Semanal: los mejores 5 días, con al menos 3 días válidos. Mensual: los mejores 20 días, con al menos 10 días válidos. Los puntos diarios van de 10 a 100 según el puesto.</p><p class="account-copy">Todos los períodos usan UTC. Se requiere una torre verificada de al menos 5 objetos para ser participante válido. Menos de 5 participantes: sin premios. De 5 a 9: primer puesto. De 10 a 24: primeros 3. De 25 a 99: primeros 10. Desde 100: primeros 25.</p><table class="account-prize-table"><thead><tr><th>Puesto</th><th>Coins</th><th>Ayudas</th></tr></thead><tbody>${[1, 2, 3, 4, 11].map(rank => { const prize = rankingPrize(this.period, rank, 100); return `<tr><td>${rank === 4 ? '4–10' : rank === 11 ? '11–25' : rank}</td><td>${prize.coins}</td><td>${this.itemLabel(prize.items) || '—'}</td></tr>`; }).join('')}</tbody></table><p class="account-copy">Los premios se entregan una sola vez a la cuenta. Las ayudas están permitidas, con un máximo de 2 por partida y una sola segunda oportunidad. No hay premios en dinero.</p></details>`;
  }

  private rankingRow(row: RankingEntry): string {
    return `<li class="account-ranking-row"><span class="account-rank">${row.rank}</span><div><strong>${escape(row.name)}</strong><small>${this.period === 'daily' ? `${row.height.toFixed(1)} m · ${row.score} score` : `${row.points} puntos · ${row.wins} victorias`}</small>${row.aidsUsed.length ? `<span class="account-assisted">AYUDAS: ${row.aidsUsed.filter(id => id in AID_CATALOG).map(id => AID_CATALOG[id].name).join(', ')}</span>` : ''}</div><span class="account-rank-prize">${row.coins ? `${row.coins} coins` : '—'}${Object.keys(row.items).length ? `<small>${this.itemLabel(row.items)}</small>` : ''}</span></li>`;
  }

  private itemLabel(items: Partial<Record<AidId, number>>): string {
    return aidIds.filter(id => integer(items[id] ?? 0) > 0).map(id => `${integer(items[id]!)} ${AID_CATALOG[id].name}`).join(' + ');
  }

  private utcDate(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-UY', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date) : 'fecha pendiente';
  }

  private runContent(): string {
    return `<p class="account-copy">${this.runView.used.length}/2 ayudas usadas. Solo podés activar las ayudas preparadas para esta torre. Una sola segunda oportunidad por partida.</p>${this.runView.available.length ? `<div class="account-aid-list">${this.runView.available.map(id => `<article class="account-aid"><div class="account-aid-heading"><h3>${AID_CATALOG[id].name}</h3><span>${this.runView.used.includes(id) ? 'USADA' : 'PREPARADA'}</span></div><p>${descriptions[id]}</p><button class="account-primary" type="button" data-account-action="use-aid" data-aid="${id}" ${this.runView.canAid(id) && !this.state.busy && !this.runView.used.includes(id) && this.runView.used.length < 2 ? '' : 'disabled'}>${this.runView.used.includes(id) ? 'YA USADA' : 'USAR AYUDA'}</button></article>`).join('')}</div>` : '<p class="account-notice">Esta torre empezó sin ayudas preparadas. Podés elegirlas en la tienda antes de la próxima partida.</p>'}`;
  }

  private privacyContent(): string {
    const state = privacyConsent.load();
    return `<p class="account-copy">Impossible Tower está dirigido a personas desde los 13 años. Elegí tu grupo de edad; no guardamos tu fecha de nacimiento.</p><fieldset class="account-age-options"><legend>GRUPO DE EDAD</legend>${([['under13', 'Menos de 13 años'], ['teen', 'Entre 13 y 17 años'], ['adult', '18 años o más']] as const).map(([value, label]) => `<label><input type="radio" name="account-age" value="${value}" ${state.ageGroup === value ? 'checked' : ''}> ${label}</label>`).join('')}</fieldset>${state.ageGroup === 'under13' ? '<p class="account-notice">El juego no está disponible para menores de 13 años.</p>' : state.ageGroup === 'teen' ? `<p class="account-copy">Para activar cuenta y rankings debe intervenir tu padre, madre o tutor. No hay anuncios para menores.</p><label class="account-check"><input type="checkbox" data-account-guardian ${state.guardianAuthorized ? 'checked' : ''}> Soy la persona adulta responsable y autorizo las funciones online. Vincularé mi email como responsable.</label>` : state.ageGroup === 'adult' ? `<fieldset class="account-age-options"><legend>ANUNCIOS OPCIONALES</legend><label><input type="radio" name="account-ads-consent" value="granted" ${state.adsConsent === 'granted' ? 'checked' : ''}> Permitir anuncios opcionales</label><label><input type="radio" name="account-ads-consent" value="denied" ${state.adsConsent === 'denied' ? 'checked' : ''}> No permitir anuncios</label></fieldset><p class="account-fine">Esta preferencia se puede cambiar acá. Los anuncios solo estarán disponibles al habilitarse el proveedor y confirmarse el consentimiento requerido.</p>` : ''}<button class="account-primary" type="button" data-account-action="privacy-continue" ${privacyConsent.canUseOnlineServices() ? '' : 'disabled'}>CONTINUAR</button>`;
  }

  private handleClick(event: MouseEvent): void {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-account-action]');
    if (!button || button.disabled) return;
    event.stopPropagation();
    const action = button.dataset.accountAction;
    if (action === 'close') { this.closeDialog(); return; }
    if (action === 'account') { this.showAccount(); return; }
    if (action === 'shop') { this.showShop(); return; }
    if (action === 'privacy') { this.showPrivacySetup(); return; }
    if (action === 'privacy-continue') { if (privacyConsent.canUseOnlineServices()) this.open(this.privacyDestination); return; }
    if (action === 'run-aids') { this.open('run'); return; }
    if (action === 'ranking') {
      const period = button.dataset.period as RankingPeriod;
      if (!Object.hasOwn(periods, period) || this.flags.rankings && !this.flags.rankingPeriods.includes(period)) return;
      this.showLeaderboard(null, period);
      if (this.flags.rankings) this.options.onAction({ type: 'rankings', period });
      return;
    }
    const id = button.dataset.aid as AidId;
    if (action === 'buy-aid' && aidIds.includes(id) && canBuyAid(this.state, this.flags, id)) this.options.onAction({ type: 'buyAid', id });
    if (action === 'select-aid' && aidIds.includes(id) && canSelectAid(this.selected, this.state.snapshot?.inventory ?? {}, id)) {
      this.selected = this.selected.includes(id) ? this.selected.filter(aid => aid !== id) : [...this.selected, id];
      this.options.onAction({ type: 'loadout', aids: this.getLoadout() });
      this.renderActive();
    }
    if (action === 'use-aid' && this.runView.available.includes(id) && this.runView.canAid(id) && !this.runView.used.includes(id) && this.runView.used.length < 2) {
      this.closeDialog();
      this.options.onAction({ type: 'useAid', id });
    }
    if (action === 'buy-coins') {
      const packId = button.dataset.pack as PackId;
      if (Object.hasOwn(COIN_PACKS, packId) && this.flags.payments && this.flags.onlineAllowed && this.purchaseAdultConfirmed && this.state.snapshot?.recoverable && !this.state.busy && this.flags.paymentMode !== 'disabled') this.options.onAction({ type: 'buyCoins', packId, adultConfirmed: true });
    }
    if (action === 'buy-cosmetic' || action === 'equip-cosmetic') {
      const cosmetic = ACCOUNT_COSMETICS.find(item => item.id === button.dataset.cosmetic);
      if (!cosmetic || !this.flags.economy || !this.flags.onlineAllowed || this.state.busy || !this.state.snapshot?.recoverable) return;
      const owned = this.state.snapshot.onlineCosmetics.includes(cosmetic.id);
      if (action === 'equip-cosmetic' && owned) this.options.onAction({ type: 'equipCosmetic', id: cosmetic.id });
      if (action === 'buy-cosmetic' && !owned && this.state.snapshot.balance >= cosmetic.price) this.options.onAction({ type: 'buyCosmetic', id: cosmetic.id });
    }
  }

  private handleSubmit(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (this.state.busy || !this.flags.economy || !this.flags.onlineAllowed || !privacyConsent.canUseOnlineServices() || !form.reportValidity()) return;
    const values = new FormData(form);
    if (form.dataset.accountForm === 'login') this.options.onAction({ type: 'login', email: String(values.get('email') ?? '').trim(), mode: values.get('mode') === 'sign-in' ? 'sign-in' : 'link' });
    if (form.dataset.accountForm === 'verify') this.options.onAction({ type: 'verify', email: this.state.email ?? '', token: String(values.get('token') ?? '').trim(), mode: this.state.authMode ?? 'link' });
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.name === 'account-age') this.options.onAction({ type: 'ageGroup', value: input.value as AgeGroup });
    if (input.hasAttribute('data-account-guardian')) this.options.onAction({ type: 'guardian', authorized: input.checked });
    if (input.name === 'account-ads-consent') this.options.onAction({ type: 'adsConsent', value: input.value as AdsConsent });
    if (input.hasAttribute('data-account-adult')) { this.purchaseAdultConfirmed = input.checked; this.renderActive(); }
  }
}
