import { t } from '../services/i18n';
export const escapeHTML=(value:unknown):string=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const infoButton=(title:string,copy:string,account=false)=>`<button type="button" class="info-button" ${account?'data-account-action':'data-action'}="info" data-info-title="${escapeHTML(title)}" data-info="${escapeHTML(copy)}" aria-label="${escapeHTML(t('Información')+' · '+t(title))}">i</button>`;
function remainingTime(end:number,now:number):string {
 const seconds=Math.max(0,Math.ceil((end-now)/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
 return Number.isFinite(end)?`${hours>=24?`${Math.floor(hours/24)}d `:''}${hours%24}h ${minutes}m`:t('Actualizando…');
}
export function timerHTML(start:string,end:string,label='Renueva en'):string {
 const from=Date.parse(start),until=Date.parse(end),now=Date.now();
 const progress=Number.isFinite(from)&&until>from?Math.min(100,Math.max(0,(now-from)/(until-from)*100)):0;
 return `<div class="renewal-timer" data-timer-start="${escapeHTML(start)}" data-timer-end="${escapeHTML(end)}" data-timer-label="${escapeHTML(label)}"><div><span>${escapeHTML(t(label))}</span><strong data-timer-copy>${remainingTime(until,now)}</strong></div><progress max="100" value="${progress}" aria-label="${escapeHTML(t(label))}"></progress></div>`;
}
export function refreshTimers(root:ParentNode=document,now=Date.now()):void {
 root.querySelectorAll<HTMLElement>('[data-timer-end]').forEach(el=>{
  const end=Date.parse(el.dataset.timerEnd??''),start=Date.parse(el.dataset.timerStart??'');
  const text=remainingTime(end,now);
  const copy=el.querySelector('[data-timer-copy]');if(copy&&copy.textContent!==text)copy.textContent=text;
  const bar=el.querySelector('progress');if(bar)bar.value=Number.isFinite(start)&&end>start?Math.min(100,Math.max(0,(now-start)/(end-start)*100)):0;
 });
}
export const dayTimer=(end?:string)=>{const until=end??new Date(Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z')+86400000).toISOString();return timerHTML(new Date(Date.parse(until)-86400000).toISOString(),until);};
export const emptyState=(title:string,copy='')=>`<div class="empty-state"><span class="empty-symbol" aria-hidden="true">✦</span><strong>${escapeHTML(title)}</strong>${copy?`<p>${escapeHTML(copy)}</p>`:''}</div>`;
export const confirmationHTML=(name:string,price:number,balance:number,actionAttribute='data-account-action',unit='monedas')=>`<div class="purchase-confirmation"><span class="confirmation-symbol" aria-hidden="true">✦</span><h3>${escapeHTML(name)}</h3><div class="confirmation-total"><span>${t('Precio')}</span><strong>${price} ${t(unit)}</strong></div><div class="confirmation-total"><span>${t('Saldo después')}</span><strong>${Math.max(0,balance-price)} ${t('monedas')}</strong></div><div class="account-button-row"><button type="button" class="account-secondary" ${actionAttribute}="cancel-purchase">${t('Cancelar')}</button><button type="button" class="account-primary" ${actionAttribute}="confirm-purchase">${t('Confirmar')}</button></div></div>`;
