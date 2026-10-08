import { getLanguage, t } from '../services/i18n';
import { AID_CATALOG, COIN_PACKS, validLoadout, type AidId, type PackId, type RankingPeriod } from '../content/economy';
import { LEGAL_DOCUMENTS } from '../content/legal';
import { ACCOUNT_COSMETICS, COSMETICS } from '../content/cosmetics';
import { privacyConsent, type AgeGroup, type AdsConsent } from '../services/privacy';
import type { AccountRun, AccountSnapshot, RankingEntry, RankingSnapshot, PodiumNotification } from '../types/account';
import type { GameSnapshot } from '../types';
import { escapeHTML as escape, infoButton, confirmationHTML, timerHTML, refreshTimers, emptyState } from './components';
import './account.css';

export type AccountAction =
 | {type:'google';recover?:boolean} | {type:'logout'} | {type:'invite'}
 | {type:'login';email:string;mode:'link'|'sign-in'} | {type:'verify';email:string;token:string;mode:'link'|'sign-in'}
 | {type:'buyAid';id:AidId} | {type:'useAid';id:AidId} | {type:'loadout';aids:AidId[]}
 | {type:'rankings';period:RankingPeriod} | {type:'buyCoins';packId:PackId;adultConfirmed:boolean}
 | {type:'buyCosmetic';id:string} | {type:'equipCosmetic';id:string}
 | {type:'recoverPayment'}
 | {type:'ageGroup';value:AgeGroup} | {type:'guardian';authorized:boolean} | {type:'adsConsent';value:AdsConsent}
 | {type:'redeemCode';code:string} | {type:'claimBadge';id:string} | {type:'ackNotification';id:string}
 | {type:'openMissions'} | {type:'openBadges'};
export interface AccountViewState {
 localCoins:number;ownedCosmetics?:string[];selectedCosmetics?:Record<string,string>;achievements?:string[];badgeProgress?:Record<string,number>;
 snapshot:AccountSnapshot|null;email?:string;otpSent?:boolean;authMode?:'link'|'sign-in';busy?:boolean;error?:string;run?:AccountRun|null;selectedCosmetic?:string;publicName?:string;
}
export interface AccountEnabledFlags {economy:boolean;rankings:boolean;rankingPeriods:RankingPeriod[];payments:boolean;paymentMode:'disabled'|'sandbox'|'live';onlineAllowed:boolean;}
export interface AccountRunView {available:AidId[];used:AidId[];canAid:(id:AidId)=>boolean;}
type View='account'|'shop'|'leaderboard'|'run'|'privacy'|'confirm'|'info'|'podium';
type ShopTab='aids'|'styles'|'backgrounds'|'coins';
const integer=(value:number)=>Number.isFinite(value)?Math.max(0,Math.floor(value)):0;
const aidIds=Object.keys(AID_CATALOG) as AidId[];
const periods:Record<RankingPeriod,string>={daily:'Hoy',weekly:'Semana',monthly:'Juego libre · mensual','all-time':'Histórico'};
const descriptions:Record<AidId,string>={
 'guide-5':'Alineá los próximos 5 lanzamientos con una guía vertical.',
 'guide-10':'Alineá los próximos 10 lanzamientos con una guía vertical.',
 preview:'Mirá cuáles serán los próximos 3 objetos.',focus:'La grúa va a mitad de velocidad durante 3 objetos.',
 skip:'Reemplazá una pieza antes de soltarla, desde el tercer objeto.',
 'second-chance':'Recuperá una torre tras fallar, con al menos 3 objetos colocados.',
};
const aidSymbols:Record<AidId,string>={'guide-5':'↕','guide-10':'↕',preview:'◉',focus:'◎',skip:'↻','second-chance':'♡'};
const transactionLabels:Record<string,string>={starter:'Bienvenida','daily-missions':'Misión diaria',referral:'Referido','ranking-daily':'Premio Daily','ranking-weekly':'Premio semanal','daily-attempt':'Intento Daily','aid-purchase':'Compra de ayuda','aid-use':'Ayuda usada','cosmetic-purchase':'Compra de estilo','badge-reward':'Premio de insignia','promo-code':'Código promocional','payment':'Compra de monedas','purchase':'Compra de monedas','payment-reversal':'Reversión de pago','verification-timeout':'Compensación técnica','infrastructure-compensation':'Compensación técnica'};
export function canSelectAid(selected:AidId[],inventory:Partial<Record<AidId,number>>,id:AidId):boolean{return selected.includes(id)||integer(inventory[id]??0)>0&&validLoadout([...selected,id]);}
export function canBuyAid(state:AccountViewState,flags:AccountEnabledFlags,id:AidId):boolean{return flags.economy&&flags.onlineAllowed&&!state.busy&&state.snapshot?.recoverable===true&&state.snapshot.balance>=AID_CATALOG[id].price;}

export class AccountInterface {
 private state:AccountViewState={localCoins:0,snapshot:null};
 private flags:AccountEnabledFlags={economy:false,rankings:false,rankingPeriods:['daily','weekly','all-time','monthly'],payments:false,paymentMode:'disabled',onlineAllowed:false};
 private readonly dialog=document.createElement('dialog');
 private view:View|null=null;private previous:View='account';private tab:ShopTab='aids';
 private privacyDestination:'account'|'shop'|'google'='account';private privacyGoogleRecover=false;
 private ranking:RankingSnapshot|null=null;private period:RankingPeriod='daily';private rankingError='';
 private snapshot:GameSnapshot|null=null;private runView:AccountRunView={available:[],used:[],canAid:()=>false};private runSignature='';
 private pendingPurchase:AccountAction|null=null;private purchaseName='';private purchasePrice=0;
 private information={title:'Información',copy:''};private notification:PodiumNotification|null=null;
 private opener:HTMLElement|null=null;private openerSelector='';private promoDraft='';private dialogActive=false;
 constructor(private readonly root:HTMLElement,private readonly options:{onAction:(action:AccountAction)=>void;onDialogChange?:(open:boolean)=>void}){
  this.dialog.className='account-dialog';this.dialog.setAttribute('aria-labelledby','account-dialog-title');root.append(this.dialog);
  root.addEventListener('click',event=>this.handleClick(event));
  this.dialog.addEventListener('pointerdown',event=>event.stopPropagation());
  this.dialog.addEventListener('submit',event=>this.handleSubmit(event));
  this.dialog.addEventListener('input',()=>{this.promoDraft=this.dialog.querySelector<HTMLInputElement>('#promo-code')?.value??this.promoDraft;});
  this.dialog.addEventListener('change',event=>this.handleChange(event));
  this.dialog.addEventListener('cancel',event=>{if(this.view==='podium'&&this.notification){event.preventDefault();const id=this.notification.id;this.closeDialog();this.options.onAction({type:'ackNotification',id});return;}if(this.view==='confirm'||this.view==='info'){event.preventDefault();this.pendingPurchase=null;this.open(this.previous);}});
  this.dialog.addEventListener('close',()=>{if(this.dialog.open)return;this.view=null;this.pendingPurchase=null;if(this.dialogActive){this.dialogActive=false;options.onDialogChange?.(false);}if(this.opener?.isConnected)this.opener.focus();else if(this.openerSelector)this.root.querySelector<HTMLElement>(this.openerSelector)?.focus();});
  privacyConsent.subscribe(()=>{if(this.view==='privacy')this.renderActive();});
  window.setInterval(()=>refreshTimers(this.dialog),1000);
 }
 setState(state:Partial<AccountViewState>):void{this.state={...this.state,...state};this.renderActive();this.renderMenu();}
 setEnabledFlags(flags:Partial<AccountEnabledFlags>):void{this.flags={...this.flags,...flags};this.renderActive();this.renderMenu();}
 renderMenu():void{
  const header=this.root.querySelector('.game-header');
  if(header&&this.snapshot&&this.flags.economy&&this.flags.onlineAllowed&&!header.querySelector('.account-hud-button')){
   const button=document.createElement('button');button.type='button';button.className='account-hud-button';button.dataset.accountAction='run-aids';header.querySelector('.pause-button')?.before(button);
  }
  const hud=header?.querySelector<HTMLButtonElement>('.account-hud-button');if(hud){hud.textContent=t(`AYUDAS ${this.runView.used.length}/2`);hud.disabled=!!this.state.busy;}
  const result=this.root.querySelector('.result-screen');if(!result)return;
  const owned=this.state.snapshot?.inventory['second-chance']??0;
  const available=this.state.snapshot?.recoverable&&this.flags.economy&&this.flags.onlineAllowed&&(owned>0||(this.state.snapshot?.balance??0)>=90)&&this.runView.canAid('second-chance')&&!this.runView.used.includes('second-chance')&&this.runView.used.length<2;
  let revive=result.querySelector<HTMLButtonElement>('.account-revive-result');
  if(!available){revive?.remove();return;}
  if(!revive){revive=document.createElement('button');revive.type='button';revive.className='account-revive-result reward-button';revive.dataset.accountAction='use-aid';revive.dataset.aid='second-chance';(result.querySelector('.reward-actions')??result.querySelector('.result-actions'))?.append(revive);}
  revive.textContent=t(owned>0?'Usar segunda chance':'Segunda chance · 90 monedas');revive.disabled=!!this.state.busy;
 }
 showAccount(state?:Partial<AccountViewState>):void{if(state)this.state={...this.state,...state};this.privacyDestination='account';this.open(privacyConsent.canUseOnlineServices()?'account':'privacy');}
 showShop(state?:Partial<AccountViewState>,tab?:ShopTab):void{if(state)this.state={...this.state,...state};if(tab)this.tab=tab;this.privacyDestination='shop';this.open(privacyConsent.canUseOnlineServices()?'shop':'privacy');}
 showCoins():void{this.showShop(undefined,'coins');}
 showPrivacySetup(google?:{recover?:boolean}):void{this.privacyDestination=google?'google':'account';this.privacyGoogleRecover=!!google?.recover;this.open('privacy');}
 showLeaderboard(data:RankingSnapshot|null,period:RankingPeriod=data?.period??this.period,error=''):void{this.ranking=data;this.period=period;this.rankingError=error;this.open('leaderboard');}
 showPodium(notification:PodiumNotification):boolean{if(this.dialog.open||this.snapshot&&this.snapshot.state!=='over')return false;this.notification=notification;this.open('podium');return true;}
 setRun(snapshot:GameSnapshot|null,view?:Partial<AccountRunView>):void{
  this.snapshot=snapshot;if(view)this.runView={...this.runView,...view};else if(!snapshot)this.runView={available:[],used:[],canAid:()=>false};
  const signature=snapshot?`${snapshot.state}:${snapshot.objectsPlaced}:${this.runView.used.join(',')}:${this.runView.available.map(id=>`${id}:${this.runView.canAid(id)}`).join(',')}`:'';
  if(signature!==this.runSignature){this.runSignature=signature;if(this.view==='run')this.renderActive();}this.renderMenu();
 }
 getLoadout():AidId[]{return [];}
 clearLoadout():void{}
 closeDialog():void{if(this.dialog.open)this.dialog.close();this.view=null;this.pendingPurchase=null;if(this.dialogActive){this.dialogActive=false;this.options.onDialogChange?.(false);}}
 private open(view:View):void{
  if(!this.dialog.open){this.opener=document.activeElement as HTMLElement;const action=this.opener?.dataset.accountAction;this.openerSelector=action?`[data-account-action="${CSS.escape(action)}"]`:'';}
  const changed=this.view!==view;
  this.view=view;this.renderActive();if(!this.dialog.open){this.dialog.showModal();this.dialogActive=true;this.options.onDialogChange?.(true);}
  if(changed){const focus=this.dialog.querySelector<HTMLElement>(view==='confirm'?'[data-account-action="cancel-purchase"]':'#account-dialog-title');if(focus){focus.tabIndex=focus.tagName==='H2'?-1:0;focus.focus();}}
 }
 private renderActive():void{
  if(!this.view)return;
  const focused=document.activeElement as HTMLElement|null;
  const focusId=focused?.id;const action=focused?.dataset.accountAction;const aid=focused?.dataset.aid;
  const titles:Record<View,string>={account:'Tu cuenta. Tu torre.',shop:'A tu estilo.',leaderboard:'Ranking.',run:'Una ayuda a tiempo.',privacy:'Antes de conectar.',confirm:'Confirmar compra',info:this.information.title,podium:'¡Llegaste al podio!'};
  const content=this.view==='account'?this.accountContent():this.view==='shop'?this.shopContent():this.view==='leaderboard'?this.rankingContent():this.view==='run'?this.runContent():this.view==='privacy'?this.privacyContent():this.view==='confirm'?this.confirmContent():this.view==='info'?`<p class="account-copy">${escape(this.information.copy)}</p><button class="account-secondary" data-account-action="back" type="button">Volver</button>`:this.podiumContent();
  this.dialog.setAttribute('aria-busy',String(!!this.state.busy));
  this.dialog.innerHTML=`<header class="account-dialog-header"><span class="account-eyebrow">IMPOSSIBLE TOWER</span><button type="button" class="account-close" data-account-action="close" aria-label="Cerrar">×</button><h2 id="account-dialog-title">${escape(titles[this.view])}</h2></header><div class="account-dialog-body">${this.state.error?`<p class="account-notice account-error" role="alert">${escape(this.state.error)}</p>`:''}${content}</div>`;
  this.dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{if(this.state.busy&&b.dataset.accountAction!=='close')b.disabled=true;});
  refreshTimers(this.dialog);
  const target=focusId?this.dialog.querySelector<HTMLElement>(`#${CSS.escape(focusId)}`):action?this.dialog.querySelector<HTMLElement>(`[data-account-action="${CSS.escape(action)}"]${aid?`[data-aid="${CSS.escape(aid)}"]`:''}`):null;
  if(target&&this.dialog.open)target.focus();
 }
 private balance():number{return this.state.snapshot?.recoverable&&Number.isFinite(this.state.snapshot.balance)?Math.floor(this.state.snapshot.balance):0;}
 private accountContent():string{
  const s=this.state.snapshot,inventory=s?.inventory??{},owned=[...new Set([...(this.state.ownedCosmetics??[]),...(s?.onlineCosmetics??[])])];
  const auth=s?.recoverable?'Cuenta Google vinculada':'Jugás como invitado';
  return `<section class="account-panel"><div class="profile-identity"><span class="profile-avatar" aria-hidden="true">${escape((this.state.publicName||'IT').slice(0,2).toUpperCase())}</span><div><strong data-user-content>${escape(this.state.publicName||'Impossible Tower')}</strong><small>${auth}</small></div></div>${!s?.recoverable?'<button class="account-primary" type="button" data-account-action="google">Continuar con Google</button>':''}<button class="account-secondary" type="button" data-account-action="coins">${this.balance()} monedas</button></section><section class="account-panel"><div class="section-heading"><h3>Inventario</h3>${infoButton('Inventario','Elegí tus ayudas dentro de la partida. Podés usar hasta dos distintas por torre.',true)}</div><div class="inventory-grid">${aidIds.map(id=>`<div class="inventory-item"><span>${AID_CATALOG[id].name}</span><b>${integer(inventory[id]??0)}</b></div>`).join('')}</div><button class="account-secondary" type="button" data-account-action="shop">Visitar tienda</button><details><summary>Mis estilos</summary><div class="inventory-grid">${[...COSMETICS,...ACCOUNT_COSMETICS].filter(c=>owned.includes(c.id)).map(c=>`<div class="inventory-item"><span>${escape(c.name)}</span><span aria-hidden="true" style="color:${escape(c.color)}">●</span></div>`).join('')}</div></details></section><section class="account-panel"><div class="section-heading"><h3>Jugá con amigos</h3>${infoButton('Referidos','Ganás 5 monedas por una nueva cuenta Google invitada que complete un Daily de 5 objetos en 7 días. Máximo 10 pagos diarios.',true)}</div><button class="account-primary" type="button" data-account-action="invite">Invitar amigos</button>${s?.referral?`<p>${t('Referidos')}: ${s.referral.qualified} · +${s.referral.earnedCoins} ${t('monedas')}</p>`:''}</section>${s?.transactions.length?`<section class="account-panel"><h3>Actividad reciente</h3>${s.transactions.slice(0,8).map(x=>`<div class="transaction-row"><span>${escape(transactionLabels[x.source]??x.source)}</span><strong>${x.coins>0?'+':''}${x.coins}${this.itemLabel(x.items)?` · ${escape(this.itemLabel(x.items))}`:''}</strong></div>`).join('')}</section>`:''}<section class="account-panel profile-secondary"><button type="button" data-account-action="privacy">Edad y privacidad</button>${s?.recoverable?'<button class="signout-button" type="button" data-account-action="logout">Cerrar sesión</button>':''}<nav class="account-legal"><a href="${getLanguage()==='en'?'/en/privacidad/':LEGAL_DOCUMENTS.privacy.path}" target="_blank" rel="noopener">Privacidad</a><a href="${getLanguage()==='en'?'/en/terminos/':LEGAL_DOCUMENTS.terms.path}" target="_blank" rel="noopener">Términos</a></nav></section>`;
 }
 private shopContent():string{
  const tabs:Record<ShopTab,string>={aids:'Ayudas',styles:'Estilos',backgrounds:'Fondos',coins:'Monedas'};
  const nav=`<nav class="account-tabs shop-tabs" aria-label="Tienda">${(Object.keys(tabs) as ShopTab[]).map(tab=>`<button type="button" data-account-action="shop-tab" data-tab="${tab}" aria-pressed="${tab===this.tab}">${tabs[tab]}</button>`).join('')}</nav>`;
  const heading=`<div class="shop-heading-row"><strong>${this.balance()} ${t('monedas')}</strong>${infoButton('Tienda','Confirmá cada compra antes de gastar. Los estilos solo cambian el look. Las ayudas se permiten en los rankings.',true)}</div>`;
  const disabled=!this.flags.economy||!this.flags.onlineAllowed||!this.state.snapshot?.recoverable;
  const notice=disabled?'<div class="account-notice">Iniciá sesión con Google para guardar tus compras. <button class="account-inline" type="button" data-account-action="account">Abrir cuenta</button></div>':'';
  const body=this.tab==='coins'?this.coinsContent():this.tab==='aids'?`<div class="shop-tab-grid">${aidIds.map(id=>`<article class="account-aid"><span class="aid-symbol" aria-hidden="true">${aidSymbols[id]}</span><div class="account-aid-heading"><h3>${AID_CATALOG[id].name}</h3>${infoButton(AID_CATALOG[id].name,descriptions[id],true)}</div><span class="aid-stock">${integer(this.state.snapshot?.inventory[id]??0)} ${t('EN INVENTARIO')}</span><button type="button" class="account-secondary" data-account-action="buy-aid" data-aid="${id}" ${canBuyAid(this.state,this.flags,id)?'':'disabled'}>${AID_CATALOG[id].price} ${t('monedas')}</button></article>`).join('')}</div>`:this.cosmeticsContent();
  return `${nav}${heading}${notice}${body}`;
 }
 private cosmeticsContent():string{
  const owned=[...(this.state.snapshot?.onlineCosmetics??[]),...(this.state.ownedCosmetics??[])];
  const allowed=this.flags.economy&&this.flags.onlineAllowed&&this.state.snapshot?.recoverable&&!this.state.busy;
  return `<div class="shop-tab-grid">${[...COSMETICS,...ACCOUNT_COSMETICS].filter(c=>this.tab==='backgrounds'?c.category==='background':c.category!=='background').map(c=>{
   const purchased=c.price===0||owned.includes(c.id),equipped=this.state.selectedCosmetics?.[c.category]===c.id;
   const art=c.category==='crane'?'<svg viewBox="0 0 80 60" aria-hidden="true"><path d="M12 50V10h50M22 10v40M12 20h50M55 10v30m-5 0h10M7 52h22"/></svg>':c.category==='background'?'':c.category==='trail'?'⌁':'✦';
   return `<article class="account-cosmetic"><span class="account-cosmetic-preview ${c.category==='background'?'is-background':''}" style="--account-cosmetic:${escape(c.color)}" aria-hidden="true">${art}</span><strong>${escape(c.name)}</strong><button type="button" class="account-secondary" data-account-action="${purchased?'equip-cosmetic':'buy-cosmetic'}" data-cosmetic="${escape(c.id)}" ${purchased?!equipped?'':'disabled':allowed&&this.balance()>=c.price?'':'disabled'}>${equipped?'EQUIPADO ✓':purchased?'EQUIPAR':`${c.price} ${t('monedas')}`}</button></article>`;
  }).join('')}</div>`;
 }
 private coinsContent():string{
  const available=this.flags.payments&&this.flags.paymentMode!=='disabled'&&this.flags.onlineAllowed&&this.state.snapshot?.recoverable;
  let pendingPayment=false;try{pendingPayment=!!localStorage.getItem('impossible-tower.pending-payment');}catch{}
  return `${pendingPayment&&this.state.snapshot?.recoverable?'<section class="account-panel"><button class="account-secondary" data-account-action="retry-payment" type="button">Reintentar pago</button></section>':''}<section class="account-panel"><h3>Ganás jugando</h3><div class="coin-paths"><button type="button" data-account-action="missions">Misiones</button><button type="button" data-account-action="ranking" data-period="weekly">Premios semanales</button><button type="button" data-account-action="badges">Insignias</button><button type="button" data-account-action="account">Invitar amigos</button></div></section><section class="account-panel"><form class="promo-form" data-account-form="promo"><label for="promo-code">Código promocional</label><input id="promo-code" name="code" value="${escape(this.promoDraft)}" maxlength="64" autocapitalize="characters" autocomplete="off" required placeholder="Ingresá tu código"><button class="account-primary" type="submit" ${this.state.snapshot?.recoverable&&!this.state.busy?'':'disabled'}>Canjear código</button></form></section><section class="account-panel"><div class="section-heading"><h3>Comprar monedas</h3>${infoButton('Comprar monedas','La compra la realiza una persona adulta. El precio es en USD. Las monedas se entregan cuando PayPal confirma el pago; no se transfieren ni se canjean por dinero.',true)}</div>${!available?'<p class="account-notice">Compras próximamente</p>':''}<div class="account-pack-grid">${(Object.keys(COIN_PACKS) as PackId[]).map(id=>{const pack=COIN_PACKS[id];return `<button type="button" class="account-pack" data-account-action="buy-coins" data-pack="${id}" ${available&&!this.state.busy?'':'disabled'}><strong>${pack.coins}</strong><span>MONEDAS</span><small>USD ${pack.amount}</small></button>`;}).join('')}</div>${this.flags.paymentMode==='sandbox'?'<p class="account-fine">Pagos de prueba · Sandbox</p>':''}</section>`;
 }
 private rankingContent():string{
  const tabs=`<nav class="account-tabs ranking-tabs" aria-label="Ranking">${(['daily','weekly','all-time','monthly'] as RankingPeriod[]).map(period=>`<button type="button" data-account-action="ranking" data-period="${period}" aria-pressed="${period===this.period}">${periods[period]}</button>`).join('')}</nav>`;
  const info=infoButton('Ranking','Daily: mejor torre del día. Semana: puntos de tus tres mejores días; desempates por victorias, altura y recepción. Los premios requieren 20 cuentas Google con Daily válido de al menos 5 objetos. Las ayudas están permitidas. Histórico: mejor Daily. Juego libre: mejor torre del mes.',true);
  if(!this.flags.rankings)return `${tabs}${emptyState('El ranking todavía no está habilitado.')}`;
  if(!this.ranking)return `${tabs}${emptyState(this.rankingError||'Cargando resultados…')}<button class="account-secondary" type="button" data-account-action="ranking" data-period="${this.period}">VOLVER A CONSULTAR</button>`;
  const d=this.ranking,minimum=d.minimumParticipants??20,eligible=d.participants>=minimum;
  const state=d.rewardState??(d.status==='settled'?(eligible?'paid':'no-minimum'):eligible?'eligible':'locked');
  const states={locked:'Premios desde 20 jugadores',eligible:'Premios habilitados',settling:'Liquidando',paid:'Pagado','no-minimum':'Sin mínimo de participantes',none:'Sin premios de monedas'};
  return `${tabs}<section class="ranking-overview"><div><strong>${periods[this.period]}</strong>${info}</div><div><span>${d.participants} ${t('PARTICIPANTES')}</span>${d.ownEntry?`<strong>${t('TU PUESTO')} #${d.ownEntry.rank}</strong>`:''}</div>${this.period!=='all-time'?timerHTML(d.startUTC,d.endUTC,'Cierra en'):''}</section>${this.period==='weekly'?`<section class="ranking-prizes ${eligible?'is-enabled':''}"><strong>${states[state]}</strong>${!eligible?`<progress max="${minimum}" value="${d.participants}" aria-label="Participantes para premios"></progress><span>${d.participants} / ${minimum}</span>`:''}<span>${t(d.status==='settled'?'Premio recibido':'Premio potencial')}: ${d.ownEntry?.coins??0} ${t('monedas')}</span>${state==='settling'?timerHTML(d.endUTC,d.settlesAt,'Pago en'):''}</section>`:''}${d.entries.length?`<ol class="account-ranking-list">${d.entries.map(row=>this.rankingRow(row)).join('')}</ol>`:emptyState('Sé el primero.','Jugá una partida y dejá tu marca.')}<a class="account-fine" href="${getLanguage()==='en'?'/en/reglas-ranking/':LEGAL_DOCUMENTS.ranking.path}" target="_blank" rel="noopener">Reglas del ranking</a>`;
 }
 private rankingRow(row:RankingEntry):string{
  const self=this.ranking?.ownEntry?.rank===row.rank;
  return `<li class="account-ranking-row ${row.rank<=3?'is-podium':''} ${self?'is-self':''}"><span class="account-rank">${row.rank<=3?['🥇','🥈','🥉'][row.rank-1]:row.rank}</span><div><strong data-user-content>${escape(row.name)}</strong><small>${this.period==='weekly'?`${row.points} ${t('puntos')}`:`${row.height.toFixed(1)} m`}</small>${row.aidsUsed.length?`<span class="account-assisted">${t('Ayudas')} ${row.aidsUsed.length}</span>`:''}</div>${this.period==='weekly'?`<strong class="account-rank-prize">${row.coins?`+${row.coins}`:'—'}</strong>`:''}</li>`;
 }
 private itemLabel(items:Partial<Record<AidId,number>>):string{return aidIds.filter(id=>integer(items[id]??0)>0).map(id=>`${integer(items[id]!)} ${t(AID_CATALOG[id].name)}`).join(' + ');}
 private runContent():string{
  return `<div class="section-heading"><strong>${this.runView.used.length}/2 ${t('ayudas usadas')}</strong>${infoButton('Ayudas','Elegí cualquier ayuda de tu inventario antes de lanzar. Máximo dos distintas; las dos guías no se combinan.',true)}</div><div class="account-aid-list">${aidIds.map(id=>{
   const owned=integer(this.state.snapshot?.inventory[id]??0),used=this.runView.used.includes(id),can=owned>0&&this.runView.available.includes(id)&&this.runView.canAid(id)&&!used&&this.runView.used.length<2;
   return `<article class="account-aid"><div class="account-aid-heading"><h3>${AID_CATALOG[id].name}</h3>${infoButton(AID_CATALOG[id].name,descriptions[id],true)}</div><span class="aid-stock">${owned} ${t('EN INVENTARIO')}</span><button class="account-primary" type="button" data-account-action="use-aid" data-aid="${id}" ${can&&!this.state.busy?'':'disabled'}>${used?'YA USADA':owned===0?'SIN INVENTARIO':can?'USAR AYUDA':'NO DISPONIBLE AHORA'}</button></article>`;
  }).join('')}</div>`;
 }
 private confirmContent():string{
  if(this.pendingPurchase?.type==='buyCoins'){
   const pack=COIN_PACKS[this.pendingPurchase.packId];return `<div class="purchase-confirmation"><h3>${pack.coins} ${t('monedas')}</h3><strong>USD ${pack.amount}</strong><label class="account-check"><input type="checkbox" data-account-adult> Soy la persona adulta responsable y autorizo esta compra con mi medio de pago.</label><div class="account-button-row"><button class="account-secondary" type="button" data-account-action="cancel-purchase">Cancelar</button><button class="account-primary" type="button" data-account-action="confirm-purchase" disabled>Continuar a PayPal</button></div></div>`;
  }
  return confirmationHTML(this.purchaseName,this.purchasePrice,this.balance());
 }
 private confirm(action:AccountAction,name:string,price:number):void{this.previous=this.view&&this.view!=='confirm'&&this.view!=='info'?this.view:'account';this.pendingPurchase=action;this.purchaseName=name;this.purchasePrice=price;this.open('confirm');}
 private podiumContent():string{
  const n=this.notification;if(!n)return '';
  return `<div class="podium-card"><span class="podium-cup" aria-hidden="true">🏆</span><h3>${n.final?'¡Podio definitivo!':'¡Estás en el top 3!'}</h3><strong>${periods[n.period]} · #${n.rank}</strong>${n.final?`<span class="podium-prize">+${n.coins} ${t('monedas')}</span>${n.period==='weekly'&&!n.minimumMet?'<p>Sin mínimo de participantes</p>':''}`:'<p>Tu última torre te dejó entre los mejores.</p>'}<button class="account-primary" type="button" data-account-action="ack-podium">Seguir jugando</button></div>`;
 }
  private privacyContent(): string {
    const state = privacyConsent.load();
    return `<p class="account-copy">Impossible Tower está dirigido a personas desde los 13 años. Elegí tu grupo de edad; no guardamos tu fecha de nacimiento.</p><fieldset class="account-age-options"><legend>GRUPO DE EDAD</legend>${([['under13', 'Menos de 13 años'], ['teen', 'Entre 13 y 17 años'], ['adult', '18 años o más']] as const).map(([value, label]) => `<label><input type="radio" name="account-age" value="${value}" ${state.ageGroup === value ? 'checked' : ''}> ${label}</label>`).join('')}</fieldset>${state.ageGroup === 'under13' ? '<p class="account-notice">El juego no está disponible para menores de 13 años.</p>' : state.ageGroup === 'teen' ? `<p class="account-copy">Para activar cuenta y rankings debe intervenir tu padre, madre o tutor. No hay anuncios para menores.</p><label class="account-check"><input type="checkbox" data-account-guardian ${state.guardianAuthorized ? 'checked' : ''}> Soy la persona adulta responsable y autorizo las funciones online. Vincularé mi cuenta Google como responsable.</label>` : state.ageGroup === 'adult' ? `<fieldset class="account-age-options"><legend>ANUNCIOS OPCIONALES</legend><label><input type="radio" name="account-ads-consent" value="granted" ${state.adsConsent === 'granted' ? 'checked' : ''}> Permitir anuncios opcionales</label><label><input type="radio" name="account-ads-consent" value="denied" ${state.adsConsent === 'denied' ? 'checked' : ''}> No permitir anuncios</label></fieldset><p class="account-fine">Esta preferencia se puede cambiar acá. Los anuncios solo estarán disponibles al habilitarse el proveedor y confirmarse el consentimiento requerido.</p>` : ''}<button class="account-primary" type="button" data-account-action="privacy-continue" ${privacyConsent.canUseOnlineServices() ? '' : 'disabled'}>CONTINUAR</button>`;
  }

 private handleClick(event:MouseEvent):void{
  const button=(event.target as Element|null)?.closest<HTMLButtonElement>('[data-account-action]');if(!button||button.disabled)return;event.stopPropagation();
  const action=button.dataset.accountAction;
  if(action==='close'){if(this.view==='confirm'||this.view==='info'){this.pendingPurchase=null;this.open(this.previous);}else{if(this.view==='podium'&&this.notification)this.options.onAction({type:'ackNotification',id:this.notification.id});this.closeDialog();}return;}
  if(action==='back'||action==='cancel-purchase'){this.pendingPurchase=null;this.open(this.previous);return;}
  if(action==='info'){this.previous=this.view??'account';this.information={title:button.dataset.infoTitle??'Información',copy:button.dataset.info??''};this.open('info');return;}
  if(action==='confirm-purchase'){const pending=this.pendingPurchase;if(!pending||this.state.busy)return;this.pendingPurchase=null;button.disabled=true;this.open(this.previous);if(pending.type==='useAid')this.closeDialog();this.options.onAction(pending);return;}
  if(action==='account'){this.showAccount();return;}if(action==='shop'){this.showShop();return;}if(action==='coins'){this.showCoins();return;}
  if(action==='privacy'){this.showPrivacySetup();return;}
  if(action==='privacy-continue'){if(privacyConsent.canUseOnlineServices()){if(this.privacyDestination==='google'){this.closeDialog();this.options.onAction({type:'google',recover:this.privacyGoogleRecover});}else this.open(this.privacyDestination);}return;}
  if(action==='shop-tab'){const tab=button.dataset.tab as ShopTab;if(['aids','styles','backgrounds','coins'].includes(tab)){this.tab=tab;this.renderActive();}return;}
  if(action==='run-aids'){this.open('run');return;}
  if(action==='missions'||action==='badges'){this.closeDialog();this.options.onAction({type:action==='missions'?'openMissions':'openBadges'});return;}
  if(action==='ranking'){const period=button.dataset.period as RankingPeriod;if(['daily','weekly','monthly','all-time'].includes(period)){this.showLeaderboard(null,period);this.options.onAction({type:'rankings',period});}return;}
  if(action==='google'||action==='google-recover'){this.options.onAction({type:'google',recover:action==='google-recover'});return;}
  if(action==='logout'||action==='invite'){this.options.onAction({type:action});return;}
  const id=button.dataset.aid as AidId;
  if(action==='buy-aid'&&aidIds.includes(id)&&canBuyAid(this.state,this.flags,id)){this.confirm({type:'buyAid',id},AID_CATALOG[id].name,AID_CATALOG[id].price);return;}
  if(action==='use-aid'&&aidIds.includes(id)&&this.runView.canAid(id)&&!this.runView.used.includes(id)&&this.runView.used.length<2){
   if(id==='second-chance'&&(this.state.snapshot?.inventory[id]??0)===0){if(this.state.snapshot?.recoverable&&this.balance()>=90)this.confirm({type:'useAid',id},AID_CATALOG[id].name,90);}
   else if((this.state.snapshot?.inventory[id]??0)>0&&this.runView.available.includes(id)){this.closeDialog();this.options.onAction({type:'useAid',id});}return;
  }
  if(action==='buy-cosmetic'||action==='equip-cosmetic'){
   const c=[...COSMETICS,...ACCOUNT_COSMETICS].find(item=>item.id===button.dataset.cosmetic);if(!c||this.state.busy)return;
   const owned=c.price===0||this.state.snapshot?.onlineCosmetics.includes(c.id)||this.state.ownedCosmetics?.includes(c.id);
   if(action==='equip-cosmetic'&&owned){this.options.onAction({type:'equipCosmetic',id:c.id});return;}
   if(action==='buy-cosmetic'&&this.flags.onlineAllowed&&this.state.snapshot?.recoverable&&!owned&&this.balance()>=c.price)this.confirm({type:'buyCosmetic',id:c.id},c.name,c.price);return;
  }
  if(action==='buy-coins'){
   const packId=button.dataset.pack as PackId;if(Object.hasOwn(COIN_PACKS,packId)&&this.flags.payments&&this.state.snapshot?.recoverable)this.confirm({type:'buyCoins',packId,adultConfirmed:true},`${COIN_PACKS[packId].coins} monedas`,0);return;
  }
  if(action==='ack-podium'&&this.notification){const id=this.notification.id;this.closeDialog();this.options.onAction({type:'ackNotification',id});}
  if(action==='retry-payment')this.options.onAction({type:'recoverPayment'});
 }
 private handleSubmit(event:Event):void{
  event.preventDefault();const form=event.target as HTMLFormElement;if(this.state.busy||!this.flags.economy||!this.flags.onlineAllowed||!form.reportValidity())return;
  const values=new FormData(form);if(form.dataset.accountForm==='promo')this.options.onAction({type:'redeemCode',code:String(values.get('code')??'').trim().toUpperCase()});
 }
 private handleChange(event:Event):void{
  const input=event.target as HTMLInputElement;
  if(input.name==='account-age')this.options.onAction({type:'ageGroup',value:input.value as AgeGroup});
  if(input.hasAttribute('data-account-guardian'))this.options.onAction({type:'guardian',authorized:input.checked});
  if(input.name==='account-ads-consent')this.options.onAction({type:'adsConsent',value:input.value as AdsConsent});
  if(input.hasAttribute('data-account-adult')){const confirm=this.dialog.querySelector<HTMLButtonElement>('[data-account-action="confirm-purchase"]');if(confirm)confirm.disabled=!input.checked||!!this.state.busy;}
 }
}
