import { UI_EN } from './interface';
import { LEGAL_EN } from './legal';
export type Language='es'|'en';
const KEY='impossible-tower.language';
let language:Language='es';
try{if(typeof localStorage!=='undefined'&&localStorage.getItem(KEY)==='en')language='en';}catch{}
const listeners=new Set<()=>void>();
export const getLanguage=()=>language;
export function setLanguage(value:Language){language=value;try{localStorage.setItem(KEY,value);}catch{}if(typeof document!=='undefined')document.documentElement.lang=value;if(typeof document!=='undefined')document.querySelectorAll<HTMLElement>('[data-language]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.language===value)));listeners.forEach(fn=>fn());}
export function onLanguageChange(fn:()=>void){listeners.add(fn);return ()=>listeners.delete(fn);}
/** Spanish is the authoring key; all English copy lives in one catalog. */
export const EN:Record<string,string>={
 'Juego libre':'Free play','Practicá y participá en el ranking mensual':'Practice and enter the monthly leaderboard','Competí por premios diarios':'Compete for daily prizes',
 'Tu récord histórico Daily':'Your all-time Daily best','Historial anterior a v3':'History before v3','Sin récord Daily todavía':'No Daily best yet',
 'Continuar con Google':'Continue with Google','Recuperar cuenta Google':'Recover Google account','Jugar como invitado':'Play as guest','Cerrar sesión':'Sign out',
 'Como invitado podés practicar. Iniciá sesión con Google para competir en Daily y conservar tus monedas':'As a guest you can practice. Sign in with Google to compete in Daily and keep your coins',
 'Nombre público obligatorio':'Public name required','Elegí tu nombre':'Choose your name','Guardar nombre':'Save name','¿Cómo te llaman?':'What is your name?','Continuar':'Continue',
 'Premios desde 20 participantes válidos':'Prizes require 20 eligible players','Invitá amigos para activar los premios':'Invite friends to unlock prizes','Invitar amigos':'Invite friends','Comprar intento · 30 monedas':'Buy attempt · 30 coins','Ver anuncio · +1 intento':'Watch ad · +1 attempt',
 'Google requerido':'Google sign-in required','Sin conexión: esta práctica no participa en rankings ni acredita monedas.':'Offline: this practice run does not enter rankings or earn coins.',
 'MONEDAS':'COINS','CUENTA':'ACCOUNT','TIENDA DE AYUDAS':'AID SHOP','RANKING':'LEADERBOARD','Rankings':'Leaderboards','Ranking':'Leaderboard','Diario':'Daily','Mensual':'Monthly','Juego libre · mensual':'Free play · monthly',
 'Compras próximamente':'Purchases coming soon','Estos packs no se pueden comprar hasta que se habiliten los pagos.':'These packs cannot be purchased until payments are enabled.',
 'MISIÓN COMPLETADA':'MISSION COMPLETE','INSIGNIA DESBLOQUEADA':'BADGE UNLOCKED','CASI CONSEGUIDA':'ALMOST THERE','Progreso verificado':'Verified progress','Resultado provisional':'Provisional result','FINALIZAR PARTIDA':'FINISH RUN','Validando resultado…':'Verifying result…',
 'JUGAR DE NUEVO':'PLAY AGAIN','INICIANDO…':'STARTING…','JUGAR':'PLAY','VOLVER AL MENÚ':'BACK TO MENU','VOLVER A CONSULTAR':'REFRESH','SEGUIR JUGANDO':'RESUME','ACEPTAR DESAFÍO':'ACCEPT CHALLENGE','DESAFIAR A UN AMIGO':'CHALLENGE A FRIEND','COMPARTIR RESULTADO':'SHARE RESULT',
 'ALTURA':'HEIGHT','OBJETOS':'OBJECTS','SIGUIENTE':'NEXT','TOCÁ PARA SOLTAR':'TAP TO DROP','Tocá para soltar':'Tap to drop','Apilá todo lo que puedas':'Stack as high as you can','PERFECT DROP':'PERFECT DROP','GREAT':'GREAT','GOOD':'GOOD','RISKY':'RISKY',
 'DESAFÍO':'CHALLENGE','FREE STACK':'FREE PLAY','RÉCORD PERSONAL':'PERSONAL BEST','NUEVO RÉCORD PERSONAL':'NEW PERSONAL BEST','TU RÉCORD':'YOUR BEST','TU TORRE LLEGÓ A':'YOUR TOWER REACHED','EL CIELO PUEDE ESPERAR':'THE SKY CAN WAIT',
 'BIEN ALTO.':'HIGH UP.','BIEN HECHO.':'WELL DONE.','CASI, CASI.':'SO CLOSE.','OTRA MÁS.':'ONE MORE.','UNA MÁS. UN POCO MÁS ALTO.':'ONE MORE. A LITTLE HIGHER.','LA GRAVEDAD GANÓ ESTA VEZ':'GRAVITY WON THIS TIME',
 'Segunda oportunidad':'Second chance','SEGUNDA OPORTUNIDAD':'SECOND CHANCE','Guía 5':'Guide 5','Guía 10':'Guide 10','Vista previa':'Preview','Foco':'Focus','Cambiar pieza':'Swap piece','USAR AYUDA PREPARADA':'USE PREPARED AID',
 'Logros':'Badges','Misiones':'Missions','Ajustes':'Settings','Skins':'Styles','Insignias':'Badges','Música':'Music','Efectos de sonido':'Sound effects','Vibración':'Vibration','NOMBRE PÚBLICO':'PUBLIC NAME','OPCIONAL':'REQUIRED','PRÓXIMAS PIEZAS':'UPCOMING PIECES',
 'Primer ladrillo':'First brick','Mirador':'Lookout','Cien y contando':'One hundred and counting','Mano firme':'Steady hand','Precisión imposible':'Impossible precision','Ciencia de cohetes':'Rocket science','Entre nubes':'Among clouds','Domador del caos':'Chaos tamer','Tres amaneceres':'Three sunrises','Desafío superado':'Challenge won','Podio mensual':'Monthly podium',
 'Apilá tu primer objeto.':'Stack your first object.','Alcanzá los 50 metros.':'Reach 50 meters.','Alcanzá los 100 metros.':'Reach 100 meters.','Conseguí un combo de 5 Perfect.':'Get 5 consecutive Perfect drops.','Conseguí un combo de 10 Perfect.':'Get 10 consecutive Perfect drops.','Apilá un cohete.':'Stack a rocket.','Alcanzá los 150 metros.':'Reach 150 meters.','Alcanzá los 200 metros.':'Reach 200 meters.','Jugá el Daily Tower tres días seguidos.':'Play Daily Tower three days in a row.','Superá la altura de un desafío.':'Beat a challenge tower.','Terminá entre los tres primeros del ranking de práctica.':'Finish in the monthly practice top three.',
 'Completá 3 torres de al menos 5 objetos':'Finish 3 towers with at least 5 objects','Acumulá 8 colocaciones perfectas':'Accumulate 8 Perfect drops','Alcanzá 30 metros en una partida':'Reach 30 meters in one run',
 'Caja feliz':'Happy box','Mesa de picnic':'Picnic table','Silla limón':'Lemon chair','Sofá nube':'Cloud sofa','Heladera polar':'Polar fridge','Lavadora orbital':'Orbital washer','Bañera rosa':'Pink bathtub','Piano medianoche':'Midnight piano','Barril rodante':'Rolling barrel','Moto mandarina':'Tangerine motorbike','Auto aguamarina':'Aquamarine car','Contenedor coral':'Coral container','Estatua del equilibrio':'Balance statue','Casita celeste':'Sky-blue house','Barco banana':'Banana boat','Cohete de bolsillo':'Pocket rocket','Pelota lunar':'Moon ball','Satélite de jardín':'Garden satellite','Pila de libros':'Stack of books','Baúl viajero':'Travel trunk','Microondas menta':'Mint microwave','Tostadora coral':'Coral toaster','Televisor retro':'Retro TV','Maceta tropical':'Tropical planter','Cono mandarina':'Tangerine cone','Skate de limón':'Lemon skateboard','Tetera lunar':'Moon teapot','Acordeón lavanda':'Lavender accordion','Arcade medianoche':'Midnight arcade','Globo de bolsillo':'Pocket balloon',
 '¡Por un pelo!':'That was close!','¡Tocaste las nubes!':'You reached the clouds!','100 m. Cero miedo.':'100 m. No fear.','Entraste en modo caos':'Chaos mode unlocked','¡Hola, estratósfera!':'Hello, stratosphere!','Cinco PERFECT. Una obra de arte.':'Five PERFECT drops. A masterpiece.','¡Nuevo récord personal!':'New personal best!','La gravedad pidió revancha.':'Gravity wants a rematch.','¡Ganaste el desafío!':'You won the challenge!',
 'Privacidad':'Privacy','PRIVACIDAD':'PRIVACY','Términos':'Terms','Reglas':'Rules','Cerrar':'Close','Pausar partida':'Pause game','Volver al menú':'Back to menu','Opciones del juego':'Game options','Partida de Impossible Tower':'Impossible Tower game','Instalar':'Install',
 'A tu manera.':'Your way.','Tomate un respiro.':'Take a break.','La gravedad también puede esperar.':'Gravity can wait too.','Buen timing. Buenas preferencias.':'Good timing. Good preferences.','Un poco de estilo.':'A little style.',
 'UN DEDO. TODA LA GRAVEDAD.':'ONE FINGER. ALL THE GRAVITY.','EL CIELO':'THE SKY','ES EL':'IS THE','LÍMITE.':'LIMIT.','APILÁ LO IMPOSIBLE':'STACK THE IMPOSSIBLE','La gravedad tiene otros planes.':'Gravity has other plans.','UN TOQUE PARA SOLTAR':'ONE TAP TO DROP','ESPACIO':'SPACE','HECHO PARA CAER.':'BUILT TO FALL.','Y VOLVER A EMPEZAR.':'AND START AGAIN.','TU MEJOR VERSIÓN':'YOUR PERSONAL BEST','Siempre hay un poco más de cielo.':'There is always more sky.','Una torre nueva cada día.':'A new tower every day.','La misma secuencia para todos.':'The same sequence for everyone.','Tu timing hace la diferencia.':'Your timing makes the difference.',
 'Iniciá sesión para usar tu cuenta.':'Sign in to use your account.','La cuenta no respondió.':'The account service did not respond.','El servicio no respondió.':'The service did not respond.','Iniciá sesión con Google para jugar Daily.':'Sign in with Google to play Daily.','Te faltan monedas.':'Not enough coins.','No quedan intentos Daily.':'No Daily attempts left.','Enlace copiado.':'Link copied.','No se pudo compartir el enlace.':'Unable to share the link.',
 'Insufficient coins':'Not enough coins.','No Daily attempts left':'No Daily attempts left.','Google account required':'Google sign-in required.','Public name required':'Public name required.',
 'La cuenta online todavía no está habilitada. Tu progreso local sigue disponible.':'Online accounts are not enabled yet. Your local progress is still available.',
};
Object.assign(EN,LEGAL_EN,UI_EN);
const ES:Record<string,string>={'Insufficient coins':'Te faltan monedas.','No Daily attempts left':'No quedan intentos Daily.','Google account required':'Iniciá sesión con Google.','Public name required':'Ingresá un nombre público.','Referral expired':'La invitación venció.','Invalid replay':'No se pudo validar la partida.'};
Object.assign(ES,{'Ruleset mismatch':'El reglamento de la partida no coincide con el ticket.','Authentication required':'Iniciá sesión para usar tu cuenta.','Invalid canonical result':'No se pudo validar la partida.','Invalid loadout':'Selección de ayudas inválida.','Invalid mode':'Modo inválido.','Invalid period key':'Período inválido.','Request already used':'Esta operación ya fue procesada.','Reward expired at daily reset':'El anuncio venció al renovar el día.','Reward not found':'No se encontró la recompensa.','Unknown cosmetic':'Estilo inválido.','Unknown reward':'Recompensa inválida.','COINS':'MONEDAS','SCORE':'PUNTAJE','PERFECT DROPS':'COLOCACIONES PERFECTAS','PERFECT DROP':'PERFECTO','GREAT':'EXCELENTE','GOOD':'BIEN','RISKY':'ARRIESGADO','Access denied':'El acceso fue cancelado.','Offline':'Sin conexión.'});

ES["Daily ad limit reached"]="Límite de anuncios del día alcanzado.";EN["Daily ad limit reached"]="Daily ad limit reached.";
ES["Reward not completed"]="El anuncio no se completó.";EN["Reward not completed"]="The ad was not completed.";
ES["Another reward is pending"]="Hay un anuncio pendiente.";EN["Another reward is pending"]="Another ad is pending.";
ES["Aid unavailable"]="No tenés esa ayuda.";EN["Aid unavailable"]="Aid unavailable.";
ES["Continuation unavailable"]="La segunda chance no está disponible.";EN["Continuation unavailable"]="Second chance unavailable.";
ES["Aid limit reached"]="Máximo de dos ayudas alcanzado.";EN["Aid limit reached"]="Two-aid limit reached.";
ES["Daily rules change at next UTC day"]="El nuevo Daily comienza al renovar el día UTC.";EN["Daily rules change at next UTC day"]="The new Daily starts at the next UTC day.";
ES["Ticket expired"]="El ticket de partida venció.";EN["Ticket expired"]="Run ticket expired.";
ES["Too many requests"]="Esperá un momento para reintentar.";EN["Too many requests"]="Wait a moment before retrying.";
ES["Run not found"]="No se encontró esa partida.";EN["Run not found"]="Run not found.";
ES["Invalid period"]="Período inválido.";EN["Invalid period"]="Invalid period.";
ES["Purchases and coin ads disabled"]="Compras y anuncios de monedas deshabilitados";EN["Purchases and coin ads disabled"]="Purchases and coin ads disabled";
ES["Verification unavailable"]="Validación no disponible. Recursos compensados.";EN["Verification unavailable"]="Verification unavailable. Resources compensated.";
const patterns:[RegExp,(m:RegExpMatchArray)=>string][]=[
 [/^Historial anterior a v3 · (.+) m$/,m=>`History before v3 · ${m[1]} m`],
 [/^(\d+) coins$/,m=>`${m[1]} coins`],
 [/^(\w+)\. Altura (.+) metros\. (\d+) objetos apilados\.$/,m=>`${m[1]}. Height ${m[2]} meters. ${m[3]} objects stacked.`],
 [/^(.+) equipada\.$/,m=>`${t(m[1])} equipped.`],
 [/^Cerrar (.+)$/,m=>`Close ${t(m[1])}`],
 [/^Quedan (.+)$/,m=>`${m[1]} remaining`],
 [/^COMPRAR · (\d+) COINS$/,m=>`BUY · ${m[1]} COINS`],
 [/^(\d+) EN INVENTARIO$/,m=>`${m[1]} IN INVENTORY`],
 [/^PRÓXIMA TORRE · (\d+)\/2 AYUDAS$/,m=>`NEXT TOWER · ${m[1]}/2 AIDS`],
 [/^AYUDAS: (.+)$/,m=>`AIDS: ${m[1].split(', ').map(t).join(', ')}`],
 [/^(\d+)\/2 ayudas usadas\. Solo podés activar las ayudas preparadas para esta torre\. Una sola segunda oportunidad por partida\.$/,m=>`${m[1]}/2 aids used. Activate prepared aids or buy a second chance on the result screen. One second chance per run.`],
 [/^DAILY TOWER · (\d+) DÍAS? DE RACHA$/,m=>`DAILY TOWER · ${m[1]} DAY STREAK`],
 [/^TE FALTARON (.+) m$/,m=>`${m[1]} m TO GO`],
 [/^DESAFÍO · (.+)$/,m=>`CHALLENGE · ${m[1]}`],
 [/^Van (\d+) de 20 participantes$/,m=>`${m[1]} of 20 participants`],
 [/^(\d+) intentos gratis restantes$/,m=>`${m[1]} free attempts remaining`],
 [/^Extras: (\d+) por anuncios · (\d+) comprados$/,m=>`Extras: ${m[1]} from ads · ${m[2]} purchased`],
 [/^Renueva en (.+)$/,m=>`Renews in ${m[1]}`],
 [/^Segunda chance · (\d+) monedas$/,m=>`Second chance · ${m[1]} coins`],
 [/^Ganaste (\d+) monedas$/,m=>`You earned ${m[1]} coins`],
 [/^Referidos: (\d+) válidos · (\d+) monedas$/,m=>`Referrals: ${m[1]} qualified · ${m[2]} coins`],
 [/^Hoy: (\d+) de 10 pagos$/,m=>`Today: ${m[1]} of 10 rewards`],
 [/^AYUDAS (\d+)\/2$/,m=>`AIDS ${m[1]}/2`],
 [/^TU PUESTO$/,()=> 'YOUR POSITION'],
 [/^Cierre: (.+) UTC$/,m=>`Closes: ${m[1]} UTC`],
 [/^(\d+) PARTICIPANTES$/,m=>`${m[1]} PARTICIPANTS`],
 [/^Llegué a (.+) m en Impossible Tower\. ¿Me superás\?$/,m=>`I reached ${m[1]} m in Impossible Tower. Can you beat me?`],
 [/^(\d+) objetos · (\d+) puntos$/,m=>`${m[1]} objects · ${m[2]} points`],
];
export function t(text:string):string {const key=text.trim();if(language==='es')return ES[key]?text.replace(key,ES[key]):text.replace(/\bcoins\b/gi,value=>value==='COINS'?'MONEDAS':'monedas');if(EN[key])return text.replace(key,EN[key]);for(const [r,fn]of patterns){const m=key.match(r);if(m)return text.replace(key,fn(m));}return text;}
/** Localize legacy DOM as well as dynamically added dialogs, keeping original copy for toggles. */
export function localizeDocument(){
 const originals=new WeakMap<Text,{source:string;rendered:string}>();
 const attributes=new WeakMap<Element,Map<string,{source:string;rendered:string}>>();
 const visit=(root:Node)=>{
  if(root instanceof Text){if(root.parentElement?.closest('script,style,input,textarea,[data-user-content]'))return;const old=originals.get(root);const source=old&&root.data===old.rendered?old.source:root.data;const rendered=t(source);originals.set(root,{source,rendered});if(root.data!==rendered)root.data=rendered;return;}
  if(root instanceof Element){for(const name of ['aria-label','placeholder','title']){const value=root.getAttribute(name);if(value===null)continue;const map=attributes.get(root)??new Map();const old=map.get(name);const source=old&&value===old.rendered?old.source:value;const rendered=t(source);map.set(name,{source,rendered});attributes.set(root,map);if(value!==rendered)root.setAttribute(name,rendered);}}
  for(const child of root.childNodes)visit(child);
 };
 const observer=new MutationObserver(records=>{for(const r of records)if(r.type==='childList')r.addedNodes.forEach(visit);else visit(r.target);});
 visit(document.body);document.documentElement.lang=language;
 observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','placeholder','title']});
 onLanguageChange(()=>visit(document.body));
 return ()=>observer.disconnect();
}
