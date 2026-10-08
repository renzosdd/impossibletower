#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const [action,argument,option]=process.argv.slice(2);
const usage='Usage: node scripts/promotions.mjs create campaign.json [--dry-run] | list | pause CODE | resume CODE';
if(!['create','list','pause','resume'].includes(action))throw new Error(usage);
let payload={};
if(action==='create'){
 payload=JSON.parse(await readFile(argument,'utf8'));
 if(typeof payload.company!=='string'||!payload.company.trim()||!/^[-A-Z0-9]{3,64}$/.test(payload.code??'')||!Number.isInteger(payload.coins)||payload.coins<1||payload.coins>10000||!Number.isInteger(payload.maxRedemptions)||payload.maxRedemptions<1||!Number.isFinite(Date.parse(payload.startsAt))||!Number.isFinite(Date.parse(payload.expiresAt))||Date.parse(payload.expiresAt)<=Date.parse(payload.startsAt))throw new Error('Invalid campaign: company, uppercase code, coins (1–10000), positive quota and valid start/expiry are required.');
 if(option==='--dry-run'){console.log(JSON.stringify({...payload,maximumCoinEmission:payload.coins*payload.maxRedemptions},null,2));process.exit(0);}
}else if(action!=='list')payload={code:String(argument??'').toUpperCase()};
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Load SUPABASE_URL and the administrative key through a private environment. Never put secrets in a campaign file.');
const headers={'Content-Type':'application/json',apikey:key};
if(key.startsWith('eyJ'))headers.Authorization=`Bearer ${key}`;
const response=await fetch(new URL('/rest/v1/rpc/tower_promo_admin',url),{method:'POST',headers,body:JSON.stringify({p_action:action,p_data:payload}),signal:AbortSignal.timeout(10000)});
const data=await response.json();
if(!response.ok)throw new Error(data.message||'Campaign operation failed.');
console.log(JSON.stringify(data,null,2));
