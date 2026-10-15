import {chromium,type Browser,type BrowserContext,type Page} from 'playwright';
import {createHash} from 'node:crypto';
import {assert,OperatorError} from './errors.js';
import {publicUrl} from './web-tools.js';
import {accessState,loginUrl,parseProfile,platformHost,profileLink,type PageSnapshot,type SocialPlatform,type SocialProfile} from './social-model.js';

export type SocialStorage={cookies:Array<{name:string;value:string;domain:string;path:string;expires:number;httpOnly:boolean;secure:boolean;sameSite:'Strict'|'Lax'|'None'}>;
  origins:Array<{origin:string;localStorage:Array<{name:string;value:string}>}>};
export interface SocialWindow {browser:Browser;context:BrowserContext;page:Page;blockedHosts?:Set<string>}
export type SocialLoginState={ready:false;signature:null}|{ready:true;signature:string};
export const ownPlatformHost=(host:string,platform:SocialPlatform)=>host.replace(/^\./,'')===platform+'.com'||host.replace(/^\./,'').endsWith('.'+platform+'.com');
export function allowedSocialHost(host:string,platform:SocialPlatform,login=false):boolean {
  const domains=platform==='instagram'?['instagram.com','cdninstagram.com','fbcdn.net','facebook.com','facebook.net']:
    ['tiktok.com','tiktokcdn.com','tiktokcdn-us.com','tiktokcdn-eu.com','tiktokv.com','tiktokv.eu','tiktokw.eu','byteoversea.com','ibytedtos.com','ttwstatic.com','bytedance.com','musical.ly'];
  if(login)domains.push('accounts.google.com','gstatic.com','google.com','appleid.apple.com','appleid.cdn-apple.com','facebook.com','facebook.net');
  return domains.some(domain=>host===domain||host.endsWith('.'+domain));
}
export function platformStorage(state:{cookies:SocialStorage['cookies'];origins?:SocialStorage['origins']},platform:SocialPlatform):SocialStorage {
  const cookies=state.cookies.filter(cookie=>ownPlatformHost(cookie.domain,platform)&&cookie.value.length<=10000&&(cookie.expires<0||cookie.expires>Date.now()/1000));
  const origins=(state.origins??[]).filter(value=>{try{const url=new URL(value.origin);return url.protocol==='https:'&&ownPlatformHost(url.hostname,platform);}catch{return false;}});
  assert(cookies.length<=150&&origins.length<=10&&Buffer.byteLength(JSON.stringify({cookies,origins}))<=60000,'SOCIAL_SESSION_LIMIT','The platform session exceeded its storage limit.');
  return {cookies,origins};
}
export function hasLoginCookie(state:SocialStorage,platform:SocialPlatform):boolean {
  const names=platform==='instagram'?['sessionid']:['sessionid','sessionid_ss','sid_guard'];
  return state.cookies.some(cookie=>ownPlatformHost(cookie.domain,platform)&&names.includes(cookie.name)&&cookie.value.length>=12&&(cookie.expires<0||cookie.expires>Date.now()/1000));
}

export class SocialBrowser {
  constructor(private readonly headless=false){}
  async open(platform:SocialPlatform,state?:SocialStorage,login=false):Promise<SocialWindow>{
    const browser=await chromium.launch({headless:login?false:this.headless,channel:'chromium',chromiumSandbox:true});
    try{
      const context=await browser.newContext({locale:'en-US',viewport:{width:1280,height:850},acceptDownloads:false,serviceWorkers:'block',...(state?{storageState:state}:{})});
      const checked=new Map<string,number>(),blockedHosts=new Set<string>();let count=0;
      await context.route('**/*',async route=>{
        try{
          const url=new URL(route.request().url());
          if(!allowedSocialHost(url.hostname,platform,login)){if(blockedHosts.size<20)blockedHosts.add(url.hostname);await route.abort();return;}
          if(url.protocol!=='https:'||url.username||url.password||url.port||!login&&++count>1200||!login&&['media','font'].includes(route.request().resourceType())){await route.abort();return;}
          if((checked.get(url.hostname)??0)<Date.now()){await publicUrl(url.origin);checked.set(url.hostname,Date.now()+30000);}
          await route.continue();
        }catch{await route.abort().catch(()=>{});}
      });
      await context.routeWebSocket('**/*',socket=>socket.close());
      const page=await context.newPage();page.setDefaultTimeout(10000);
      if(login){
        // Return the owned window immediately; an external page's slow loading
        // must not make the connection control appear unresponsive.
        void page.goto(loginUrl(platform),{waitUntil:'domcontentloaded',timeout:25000}).catch(()=>{});
      }
      return {browser,context,page,blockedHosts};
    }catch(error){await browser.close();throw error;}
  }

  async loginStatus(window:SocialWindow,platform:SocialPlatform):Promise<SocialLoginState>{
    const waiting:SocialLoginState={ready:false,signature:null};
    const page=window.context.pages().filter(value=>!value.isClosed()&&ownPlatformHost(new URL(value.url()).hostname,platform)).at(-1);
    if(!page)return waiting;
    const url=new URL(page.url());
    const authPath=(value:string)=>/\/(?:accounts\/(?:login|signup|password|two_factor_login)|login|signup|passport|challenge|checkpoint|verify)(?:\/|$)/i.test(value);
    if(url.protocol!=='https:'||authPath(url.pathname))return waiting;
    const state=platformStorage({cookies:await window.context.cookies('https://'+platformHost(platform))},platform);
    if(!hasLoginCookie(state,platform))return waiting;
    // Read only readiness flags: never inspect entered passwords/codes, feed
    // text, messages or profile contents to decide whether login has finished.
    const gate=await page.evaluate(()=>{
      const visible=(element:Element)=>{const rect=element.getBoundingClientRect(),style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';};
      return {loaded:document.readyState!=='loading'&&Boolean(document.body?.childElementCount),
        loginVisible:Array.from(document.querySelectorAll('input[type="password"],input[name="username"],input[autocomplete="one-time-code"],input[name*="verification" i]')).some(visible),
        challengeVisible:Array.from(document.querySelectorAll('#captcha_container,[data-e2e*="captcha"],iframe[src*="captcha"][title*="challenge" i]')).some(visible)};
    });
    const final=new URL(page.url());
    if(!gate.loaded||gate.loginVisible||gate.challengeVisible||final.protocol!=='https:'||!ownPlatformHost(final.hostname,platform)||authPath(final.pathname))return waiting;
    const names=platform==='instagram'?['sessionid']:['sessionid','sessionid_ss','sid_guard'];
    const signature=createHash('sha256').update(JSON.stringify(state.cookies.filter(value=>names.includes(value.name)).map(value=>[value.name,value.value]).sort())).digest('hex');
    return {ready:true,signature};
  }

  async snapshot(page:Page,platform:SocialPlatform):Promise<PageSnapshot>{
    return page.evaluate(platform=>{
      const visible=(element:Element)=>{const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0;};
      const selector=platform==='tiktok'?'[data-e2e="user-bio"]':'main header';
      const root=document.querySelector(selector);
      const bio=root&&visible(root)?(root as HTMLElement).innerText:'';
      const linkNodes=platform==='tiktok'?[...Array.from(root?.querySelectorAll('a[href]')??[]),...Array.from(document.querySelectorAll('a[data-e2e="user-link"]'))]:Array.from(root?.querySelectorAll('a[href]')??[]);
      return {url:location.href,title:document.title.slice(0,300),description:document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.slice(0,5000)??'',
        bio:bio.slice(0,5000),body:document.body.innerText.slice(0,20000),loginVisible:Array.from(document.querySelectorAll('input[type="password"], input[name="username"]')).some(visible),
        followers:document.querySelector('[data-e2e="followers-count"]')?.textContent?.slice(0,80)??'',
        links:linkNodes.filter(visible).slice(0,30)
          .map(link=>({text:(link.textContent??'').trim().slice(0,100),url:(link as HTMLAnchorElement).href}))};
    },platform);
  }

  async discover(window:SocialWindow,platform:SocialPlatform,query:string,limit:number,signal:AbortSignal):Promise<{urls:string[];state:string}> {
    const {page}=window;
    const abort=()=>{void window.browser.close();};signal.addEventListener('abort',abort,{once:true});
    try{
      signal.throwIfAborted();
      if(platform==='tiktok'){
        const response=await page.goto('https://www.tiktok.com/search/user?q='+encodeURIComponent(query),{waitUntil:'domcontentloaded',timeout:20000});
        if(!response?.ok())return {urls:[],state:response?.status()===429?'rate_limited':'platform_unavailable'};
      }
      else{
        const response=await page.goto('https://www.instagram.com/',{waitUntil:'domcontentloaded',timeout:20000});
        if(!response?.ok())return {urls:[],state:response?.status()===429?'rate_limited':'platform_unavailable'};
        const search=page.getByRole('link',{name:/^(?:Search(?: Search)?|Hledat(?: Hledat)?)$/i}).or(page.getByRole('button',{name:/^(?:Search|Hledat)$/i})).first();
        await search.or(page.locator('input[type="password"]:visible, input[name="username"]:visible')).first().waitFor({state:'visible',timeout:12000}).catch(()=>{});
        const initial=await this.snapshot(page,platform),gate=accessState(initial);if(gate)return {urls:[],state:gate};
        await search.click({timeout:10000});
        const input=page.locator('input[placeholder*="Search" i]:visible, input[placeholder*="Hledat" i]:visible').first();await input.fill(query);
      }
      await page.waitForFunction(()=>document.body.innerText.trim().length>0,null,{timeout:10000}).catch(()=>{});
      const snapshot=await this.snapshot(page,platform),gate=accessState(snapshot);if(gate)return {urls:[],state:gate};
      if(!snapshot.body.trim())return {urls:[],state:'browser_not_ready'};
      const urls=new Set<string>(),deadline=Date.now()+12000;
      while(Date.now()<deadline&&urls.size<limit){
        signal.throwIfAborted();
        const links=await page.locator(platform==='tiktok'?'main a[href], [data-e2e="search-user-container"] a[href]':'[role="dialog"] a[href], main a[href], a[href]').evaluateAll(nodes=>nodes.filter(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;})
          .filter(node=>!(node.getAttribute('aria-label')??node.textContent??'').trim().match(/^(?:profile|home|messages|search|explore|reels)$/i))
          .map(node=>(node as HTMLAnchorElement).href).slice(0,150));
        for(const link of links){const profile=profileLink(link);if(profile?.platform===platform)urls.add(profile.url);if(urls.size>=limit)break;}
        if(urls.size>=limit)break;
        if(platform==='tiktok')await page.mouse.wheel(0,650);
        await page.waitForTimeout(600);
      }
      const final=await this.snapshot(page,platform);
      return {urls:[...urls].slice(0,limit),state:urls.size?'candidates_found':accessState(final)??(/something (?:went )?wrong[\s\S]{0,180}(?:server|try again)/i.test(final.body)?'platform_error':'no_visible_results')};
    }finally{signal.removeEventListener('abort',abort);}
  }

  async inspect(window:SocialWindow,url:string,signal:AbortSignal):Promise<SocialProfile>{
    const target=profileLink(url);assert(target,'SOCIAL_PROFILE_INVALID','Choose a social profile URL.');
    const abort=()=>{void window.browser.close();};signal.addEventListener('abort',abort,{once:true});
    try{
      signal.throwIfAborted();
      const response=await window.page.goto(target.url,{waitUntil:'domcontentloaded',timeout:15000});
      if(!response?.ok())throw new OperatorError('SOCIAL_PROFILE_UNAVAILABLE','The platform did not return the profile.',502);
      await window.page.locator(target.platform==='tiktok'?'[data-e2e="user-bio"], [data-e2e="user-title"], input[type="password"]':'main header, input[name="username"], input[type="password"]')
        .first().waitFor({state:'visible',timeout:5000}).catch(()=>{});
      return parseProfile(target.url,await this.snapshot(window.page,target.platform));
    }finally{signal.removeEventListener('abort',abort);}
  }
}
