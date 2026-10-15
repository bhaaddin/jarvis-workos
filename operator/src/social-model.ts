import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {assert} from './errors.js';
import type {ObjectValue} from './contracts.js';

export type SocialPlatform='instagram'|'tiktok';
export type ContactStage='new'|'shortlisted'|'contacted'|'dismissed';
export interface SocialBrief {query:string;location:string;languages:string;purpose:string;platforms:SocialPlatform[];limit:number}
export interface PageSnapshot {url:string;title:string;description:string;bio:string;body:string;followers:string;loginVisible?:boolean;links:Array<{text:string;url:string}>}
export interface SocialProfile {
  id:string;platform:SocialPlatform;handle:string;url:string;displayName:string;bio:string;followers:string|null;
  emails:string[];phones:string[];websites:string[];sourceText:string;observedAt:string;
  sourceState:'profile_read'|'limited_profile'|'login_required'|'challenge_required'|'unavailable';
}

export const platformHost=(platform:SocialPlatform)=>platform==='instagram'?'www.instagram.com':'www.tiktok.com';
export const loginUrl=(platform:SocialPlatform)=>'https://'+platformHost(platform)+(platform==='instagram'?'/accounts/login/':'/login');
export function socialPlatform(value:unknown):SocialPlatform {
  assert(value==='instagram'||value==='tiktok','SOCIAL_PLATFORM_INVALID','Choose Instagram or TikTok.');return value;
}
export function profileLink(value:string):{platform:SocialPlatform;handle:string;url:string}|null {
  try{
    const parsed=new URL(value);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port)return null;
    const host=parsed.hostname.toLowerCase();
    if(['instagram.com','www.instagram.com'].includes(host)){
      const parts=parsed.pathname.split('/').filter(Boolean),handle=parts[0]?.toLowerCase();
      if(parts.length!==1||!handle||!/^[a-z0-9._]{1,30}$/.test(handle)||['p','reel','reels','explore','accounts','direct','stories','about','legal','developer','web','challenge','popular','privacy','terms','locations','emails','settings','your_activity'].includes(handle))return null;
      return {platform:'instagram',handle,url:'https://www.instagram.com/'+handle+'/'};
    }
    if(['tiktok.com','www.tiktok.com','m.tiktok.com'].includes(host)){
      const match=/^\/@([a-z0-9._]{1,30})(?:\/video\/\d+)?\/?$/i.exec(parsed.pathname);
      if(!match)return null;
      const handle=match[1]!.toLowerCase();return {platform:'tiktok',handle,url:'https://www.tiktok.com/@'+handle};
    }
  }catch{}
  return null;
}
export const contactId=(platform:SocialPlatform,handle:string)=>platform+'-'+createHash('sha256').update(handle.toLowerCase()).digest('hex').slice(0,24);
export const normalizedQuote=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim();
export function accessState(snapshot:Pick<PageSnapshot,'url'|'title'|'body'|'loginVisible'>):'login_required'|'challenge_required'|null {
  const route=new URL(snapshot.url).pathname;
  if(/\/(?:challenge|checkpoint|captcha|verify)(?:\/|$)/i.test(route)||/verify (?:that )?you(?:'re| are) human|complete the captcha|security verification/i.test(snapshot.body))return 'challenge_required';
  if(snapshot.loginVisible||/\/(?:accounts\/login|login|signup|passport)(?:\/|$)/i.test(route)||/log in to (?:continue|see)|sign in to continue/i.test(snapshot.body))return 'login_required';
  return null;
}
export function parseProfile(requested:string,snapshot:PageSnapshot,observedAt=new Date().toISOString()):SocialProfile {
  const target=profileLink(requested);assert(target,'SOCIAL_PROFILE_INVALID','Use an Instagram or TikTok profile URL.');
  const landed=profileLink(snapshot.url),gate=accessState(snapshot);
  const same=landed?.url===target.url;
  const sourceState=gate??(!same?'unavailable':snapshot.bio.trim()?'profile_read':snapshot.description.trim()?'limited_profile':'unavailable');
  const available=sourceState==='profile_read'||sourceState==='limited_profile';
  const sourceText=available?(snapshot.bio.trim()||snapshot.description.trim()).slice(0,5000):'';
  const emails=new Map<string,string>(),phones=new Set<string>(),websites=new Set<string>();
  if(available){
    for(const email of sourceText.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi)??[])emails.set(email.toLowerCase(),email);
    for(const link of snapshot.links){
      try{
        const url=new URL(link.url);
        if(url.protocol==='mailto:'){
          const email=decodeURIComponent(url.pathname).trim();if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254)emails.set(email.toLowerCase(),email);
        }else if(url.protocol==='tel:'){
          const phone=decodeURIComponent(url.pathname).trim();if(/^\+?[0-9 ()-]{6,30}$/.test(phone))phones.add(phone);
        }else if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.hostname.includes('.')&&!isIP(url.hostname.replace(/^\[|\]$/g,''))&&!url.hostname.endsWith('.local')&&!url.hostname.endsWith('.internal')&&!/(?:^|\.)(?:instagram|tiktok|facebook)\.com$/.test(url.hostname)){
          websites.add(url.href.slice(0,1000));
        }
      }catch{}
    }
  }
  return {...target,id:contactId(target.platform,target.handle),displayName:available?snapshot.title.slice(0,200):target.handle,
    bio:sourceText.slice(0,2000),followers:available&&snapshot.followers.trim()?snapshot.followers.trim().slice(0,80):null,
    emails:[...emails.values()].slice(0,5),phones:[...phones].slice(0,3),websites:[...websites].slice(0,5),sourceText,observedAt,sourceState};
}

export function validateBrief(input:ObjectValue):SocialBrief {
  assert(typeof input.query==='string'&&['location','languages','purpose'].every(key=>input[key]===undefined||typeof input[key]==='string'),'SOCIAL_BRIEF_INVALID','Search criteria must be text.');
  const query=String(input.query??'').trim(),location=String(input.location??'').trim(),languages=String(input.languages??'').trim(),purpose=String(input.purpose??'').trim();
  assert(query.length>0&&query.length<=200&&location.length<=100&&languages.length<=100&&purpose.length<=500,'SOCIAL_BRIEF_INVALID','Enter bounded search criteria.');
  assert(Array.isArray(input.platforms)&&input.platforms.length>0&&input.platforms.length<=2,'SOCIAL_PLATFORMS_REQUIRED','Select at least one platform.');
  const platforms=[...new Set(input.platforms.map(socialPlatform))];
  const limit=input.limit??20;assert(typeof limit==='number'&&Number.isInteger(limit)&&limit>=1&&limit<=20,'SOCIAL_LIMIT_INVALID','Search for 1–20 profiles at a time.');
  return {query,location,languages,purpose,platforms,limit};
}

export function contactCsv(rows:ObjectValue[]):string {
  const cell=(value:unknown)=>{let text=typeof value==='string'?value:Array.isArray(value)?value.join('; '):value==null?'':String(value);if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const columns=['platform','handle','url','displayName','bio','followers','emails','phones','websites','stage','matchReason','draft','notes','observedAt','sourceState'];
  return '\uFEFF'+[columns.map(cell).join(','),...rows.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\r\n');
}
