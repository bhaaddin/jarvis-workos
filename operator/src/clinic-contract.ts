import {DateTime} from 'luxon';
import type {ObjectValue} from './contracts.js';
import {assert} from './errors.js';
import {fingerprint} from './privacy.js';
import {json} from './store-context.js';

export interface ClinicContract {
  reachable:boolean;healthy:boolean;verified:boolean;profile:'booking-day'|'registration'|'unknown';
  protectedReads:boolean;routes:string[];actions:string[];contractHash:string|null;message:string;
}

export function classifyClinicSchema(value:unknown,protectedReads:boolean):ClinicContract {
  const paths=value&&typeof value==='object'&&'paths'in value?(value as {paths:unknown}).paths:null;
  assert(paths&&typeof paths==='object'&&!Array.isArray(paths),'CLINIC_CONTRACT_INVALID','The clinic OpenAPI contract is invalid.',502);
  const routes=[...new Set(Object.entries(paths).filter(([,definition])=>definition&&typeof definition==='object'&&'get'in definition).map(([route])=>route.toLowerCase()))].sort();
  const has=(route:string)=>routes.includes(route);
  const profile=has('/api/day')&&has('/api/day/summary')?'booking-day':has('/api/scheduling/appointments')?'registration':'unknown';
  const actions=['connection','capabilities'];
  for(const [action,route]of [['appointments','/api/scheduling/appointments'],['invoices','/api/billing/invoices'],['prices','/api/services'],
    ['calendars','/api/calendars'],['activities','/api/activities'],['patients','/api/patients'],['dashboard','/api/dashboard/stats'],['upcoming','/api/dashboard/upcoming']])
    if(has(route!))actions.push(action!);
  if(profile!=='unknown')actions.push('day','summary');
  return {reachable:true,healthy:true,verified:protectedReads&&profile!=='unknown',profile,protectedReads,routes,actions,
    contractHash:fingerprint(json(value)),message:!protectedReads?'The clinic exposes an expected protected route without authentication; assistant access is blocked.'
      :profile==='unknown'?'The running clinic contract is not a reviewed assistant profile.':'Running clinic API contract detected.'};
}

export function clinicDay(selection:unknown,now=Date.now(),zone='Europe/Prague'):{date:string;from:string;to:string}{
  const current=DateTime.fromMillis(now,{zone});
  const requested=String(selection??'today');
  const day=requested==='today'?current.startOf('day'):requested==='tomorrow'?current.plus({days:1}).startOf('day'):DateTime.fromISO(requested,{zone}).startOf('day');
  assert(day.isValid&&(['today','tomorrow'].includes(requested)||/^\d{4}-\d{2}-\d{2}$/.test(requested)&&day.toISODate()===requested),
    'CLINIC_DATE_INVALID','Choose today, tomorrow or a valid YYYY-MM-DD clinic date.');
  return {date:day.toISODate()!,from:day.toUTC().toISO()!,to:day.plus({days:1}).toUTC().toISO()!};
}

export function agendaProjection(value:unknown,range:{from:string;to:string},summary:boolean):ObjectValue {
  assert(Array.isArray(value),'CLINIC_CONTRACT_INVALID','The appointment list did not match the running contract.',502);
  const instant=(item:unknown)=>typeof item==='string'&&/(?:[zZ]|[+-]\d\d:\d\d)$/.test(item)?Date.parse(item):Number.NaN;
  assert(value.every(item=>item&&typeof item==='object'&&Number.isFinite(instant(item.startTime))),
    'CLINIC_CONTRACT_INVALID','Appointment timestamps are missing or incompatible; no count was inferred.',502);
  const entries=value.filter(item=>item&&typeof item==='object'&&Number.isFinite(instant(item.startTime))
    &&instant(item.startTime)>=Date.parse(range.from)&&instant(item.startTime)<Date.parse(range.to)) as ObjectValue[];
  entries.sort((a,b)=>instant(a.startTime)-instant(b.startTime));
  const omitted=value.length-entries.length;
  const statusCounts:ObjectValue={};for(const entry of entries){const state=String(entry.status??'unspecified');statusCounts[state]=Number(statusCounts[state]??0)+1;}
  return summary?{recordCount:entries.length,statusCounts,firstStartUtc:entries.length?new Date(instant(entries[0]!.startTime)).toISOString():null,
    lastStartUtc:entries.length?new Date(instant(entries.at(-1)!.startTime)).toISOString():null,
    totalValue:null,valueStatus:'Appointment values are not provided by this API; no price was inferred.',
    scope:'Date-filtered appointment records visible to the authenticated API account.',outsideRangeOrInvalidRows:omitted}
    :{appointments:entries.slice(0,200),count:entries.length,truncated:entries.length>200,outsideRangeOrInvalidRows:omitted};
}
