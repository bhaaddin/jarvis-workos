import {randomUUID} from 'node:crypto';
import type {Actor,ObjectValue} from './contracts.js';
import {assert,OperatorError} from './errors.js';
import {Store} from './store.js';
import {json,object} from './store-context.js';
import {SocialBrowser,hasLoginCookie,platformStorage,type SocialStorage,type SocialWindow} from './social-browser.js';
import {contactCsv,profileLink,socialPlatform,validateBrief,type SocialPlatform,type SocialProfile} from './social-model.js';

type Login={id:string;owner:string;platform:SocialPlatform;window:SocialWindow;expiresAt:number;timer:NodeJS.Timeout;
  monitor?:NodeJS.Timeout;checking:boolean;readySignature?:string;readyAt?:number;saving?:Promise<ObjectValue>;saveFailed?:boolean};
export class Social {
  private readonly logins=new Map<string,Login>();
  private readonly opening=new Set<string>();
  private readonly researchBusy=new Set<string>();
  private readonly observedState=new Map<string,string>();
  constructor(private readonly store:Store,private readonly driver=new SocialBrowser()){}
  private key(actor:Actor,platform:SocialPlatform){return actor.tenantId+':'+actor.id+':'+platform;}
  private base(actor:Actor){return {tenantId:actor.tenantId,actorId:actor.id,now:Date.now()};}
  private permit(actor:Actor,permissions:string[]){assert(permissions.every(permission=>actor.permissions.includes(permission)),'FORBIDDEN','This account cannot perform that social-contact operation.',403);}
  hasPendingLogins(){return this.logins.size>0||this.opening.size>0;}

  private async settings(actor:Actor,platform:SocialPlatform){return this.store.call<ObjectValue|null>('connection.get',{...this.base(actor),id:'social:'+platform});}
  async requireConnections(actor:Actor,input:ObjectValue):Promise<void>{
    this.permit(actor,['web.read','memory.write']);
    const brief=validateBrief(input);
    for(const platform of brief.platforms){const saved=await this.settings(actor,platform);assert(saved?.storageState,'SOCIAL_CONNECTION_REQUIRED','Sign in to the selected platforms in Social contacts before searching.',409);}
  }
  async status(actor:Actor):Promise<ObjectValue>{
    this.permit(actor,['web.read']);
    const connections=[];
    for(const platform of ['instagram','tiktok'] as const){
      const saved=await this.settings(actor,platform),login=this.logins.get(this.key(actor,platform));
      connections.push({platform,hasSession:Boolean(saved?.storageState),state:login?(login.saving?'saving_session':login.saveFailed?'save_failed':'awaiting_login'):this.observedState.get(this.key(actor,platform))??(saved?.storageState?'session_saved':'not_connected'),
        savedAt:saved?.savedAt??null,label:saved?.label??null,loginId:login?.id??null,expiresAt:login?.expiresAt??null});
    }
    return {connections,note:'Sessions are private to this account. A saved session is checked by actual platform reads; login or verification prompts can still require attention.'};
  }
  async startLogin(actor:Actor,value:unknown):Promise<ObjectValue>{
    this.permit(actor,['connections.manage','web.read']);const platform=socialPlatform(value),key=this.key(actor,platform);
    const existing=this.logins.get(key);if(existing)return {id:existing.id,platform,state:'awaiting_login',expiresAt:existing.expiresAt};
    assert(!this.opening.has(key),'SOCIAL_LOGIN_OPENING','The sign-in browser is already opening.',409);
    assert(this.logins.size+this.opening.size<4,'SOCIAL_LOGIN_LIMIT','Finish or close an existing social sign-in first.',409);
    this.opening.add(key);
    try{
      const window=await this.driver.open(platform,undefined,true),id=randomUUID(),expiresAt=Date.now()+20*60_000;
      const timer=setTimeout(()=>{if(this.logins.get(key)?.id===id){this.observedState.set(key,'login_expired');void this.closeLogin(key,id);}},20*60_000);timer.unref();
      const login:Login={id,owner:actor.id,platform,window,expiresAt,timer,checking:false};this.logins.set(key,login);
      login.monitor=setInterval(()=>{void this.checkLogin(actor,login);},2000);login.monitor.unref();
      window.browser.on('disconnected',()=>{if(this.logins.get(key)===login){clearTimeout(timer);clearInterval(login.monitor);this.logins.delete(key);this.observedState.set(key,'login_closed');}});
      return {id,platform,state:'awaiting_login',expiresAt,automaticSave:true,instructions:'Sign in directly in the separate browser window on the PC and complete verification. JARVIS will save the session privately and close this window when sign-in is ready.'};
    }catch{throw new OperatorError('SOCIAL_LOGIN_UNAVAILABLE','The separate sign-in browser could not open. Check the PC browser window and try again.',503);}
    finally{this.opening.delete(key);}
  }
  private currentLogin(key:string,login:Login){return this.logins.get(key)===login&&login.expiresAt>Date.now();}
  private async checkLogin(actor:Actor,login:Login):Promise<void>{
    const key=this.key(actor,login.platform);
    if(!this.currentLogin(key,login)||login.checking||login.saving||login.saveFailed)return;
    login.checking=true;
    try{
      const current=await this.store.call<Actor>('actor.get',{tenantId:actor.tenantId,actorId:actor.id});
      this.permit(current,['connections.manage','web.read']);
      const state=await this.driver.loginStatus(login.window,login.platform);
      if(!this.currentLogin(key,login))return;
      if(!state.ready){delete login.readySignature;delete login.readyAt;return;}
      if(login.readySignature!==state.signature){login.readySignature=state.signature;login.readyAt=Date.now();return;}
      if(Date.now()-(login.readyAt??Date.now())>=1500)await this.saveLogin(current,login.platform,login.id);
    }catch(error){
      if(this.currentLogin(key,login)){
        if(error instanceof OperatorError&&error.code==='FORBIDDEN'){this.observedState.set(key,'login_permission_changed');await this.closeLogin(key,login.id);}
        else if(!(error instanceof OperatorError&&['SOCIAL_LOGIN_REQUIRED','SOCIAL_LOGIN_MISSING'].includes(error.code)))login.saveFailed=true;
      }
    }finally{login.checking=false;}
  }
  private async closeLogin(key:string,expectedId?:string){const login=this.logins.get(key);if(!login||expectedId&&login.id!==expectedId)return;this.logins.delete(key);clearTimeout(login.timer);clearInterval(login.monitor);await login.window.browser.close().catch(()=>{});}
  async cancelLogin(actor:Actor,value:unknown,id:string):Promise<ObjectValue>{
    this.permit(actor,['connections.manage']);const platform=socialPlatform(value),key=this.key(actor,platform),login=this.logins.get(key);
    assert(!login||login.id===id,'SOCIAL_LOGIN_CHANGED','A newer sign-in window is open. Refresh the connection card.',409);
    await this.closeLogin(key,id);return {closed:true};
  }
  async saveLogin(actor:Actor,value:unknown,id:string,label=''):Promise<ObjectValue>{
    this.permit(actor,['connections.manage','web.read']);const platform=socialPlatform(value),key=this.key(actor,platform),login=this.logins.get(key);
    if(!login||login.id!==id){
      const saved=await this.settings(actor,platform).catch(()=>null);
      if(saved?.loginId===id&&saved.storageState)return {platform,state:'session_saved',hasSession:true};
      throw new OperatorError('SOCIAL_LOGIN_MISSING','Open a new sign-in window for this platform.',409);
    }
    assert(this.currentLogin(key,login),'SOCIAL_LOGIN_MISSING','Open a new sign-in window for this platform.',409);
    if(login.saving)return login.saving;
    const save=(async()=>{
      const ready=await this.driver.loginStatus(login.window,platform);
      assert(ready.ready,'SOCIAL_LOGIN_REQUIRED','Finish signing in and any platform verification before saving the connection.',409);
      const state=platformStorage(await login.window.context.storageState(),platform);
      assert(hasLoginCookie(state,platform),'SOCIAL_LOGIN_REQUIRED','Finish signing in before saving the connection.',409);
      assert(label.length<=80,'SOCIAL_LABEL_INVALID','Use a short account label.');
      const current=await this.store.call<Actor>('actor.get',{tenantId:actor.tenantId,actorId:actor.id});this.permit(current,['connections.manage','web.read']);
      assert(this.currentLogin(key,login),'SOCIAL_LOGIN_MISSING','This sign-in window closed or expired before it could be saved.',409);
      const saved=await this.settings(current,platform);
      assert(this.currentLogin(key,login),'SOCIAL_LOGIN_MISSING','This sign-in window closed or expired before it could be saved.',409);
      if(saved?.loginId!==id)await this.store.call('connection.save',{...this.base(current),id:'social:'+platform,value:json({storageState:state,savedAt:new Date().toISOString(),label,loginId:id})});
      if(this.logins.get(key)===login)this.observedState.delete(key);
      await this.closeLogin(key,id);
      return {platform,state:'session_saved',hasSession:true};
    })();
    login.saving=save;
    try{return await save;}finally{if(login.saving===save)delete login.saving;}
  }
  async disconnect(actor:Actor,value:unknown):Promise<ObjectValue>{
    this.permit(actor,['connections.manage']);const platform=socialPlatform(value),key=this.key(actor,platform);
    await this.closeLogin(key);await this.store.call('connection.save',{...this.base(actor),id:'social:'+platform,value:null});
    this.observedState.delete(key);return {platform,state:'not_connected',hasSession:false};
  }
  async close(){await Promise.all([...this.logins.keys()].map(key=>this.closeLogin(key)));}

  async research(actor:Actor,input:ObjectValue,signal:AbortSignal):Promise<ObjectValue>{
    this.permit(actor,['web.read','memory.write']);const brief=validateBrief(input),key=actor.tenantId+':'+actor.id;
    const supplied=Array.isArray(input.profileUrls)?input.profileUrls.map(value=>profileLink(String(value))):[];
    assert(supplied.length<=20&&supplied.every(value=>value&&brief.platforms.includes(value.platform)),'SOCIAL_PROFILE_INVALID','Use up to 20 profile URLs from the selected platforms.');
    const settings=new Map<SocialPlatform,SocialStorage>();
    for(const platform of brief.platforms){const saved=await this.settings(actor,platform);assert(saved?.storageState,'SOCIAL_CONNECTION_REQUIRED','Sign in to the selected platforms in Social contacts before searching.',409);settings.set(platform,saved.storageState as unknown as SocialStorage);}
    assert(!this.researchBusy.has(key),'SOCIAL_SEARCH_BUSY','A social search is already running for this account.',409);this.researchBusy.add(key);
    const profiles:SocialProfile[]=[],issues:ObjectValue[]=[],deadline=AbortSignal.timeout(100000),bound=AbortSignal.any([signal,deadline]);
    try{
      for(const platform of brief.platforms){
        if(bound.aborted){signal.throwIfAborted();issues.push({platform,state:'time_limit',message:'The search time budget ended; review partial results.'});break;}
        let window:SocialWindow|undefined;
        try{
          window=await this.driver.open(platform,settings.get(platform));
          const quota=Math.min(brief.limit-profiles.length,Math.ceil(brief.limit/brief.platforms.length));
          const selected=supplied.filter(value=>value?.platform===platform).map(value=>value!.url);
          const discovery=selected.length?{urls:selected.slice(0,quota),state:'provided_urls'}:await this.driver.discover(window,platform,[brief.query,brief.location].filter(Boolean).join(' '),quota,bound);
          if(!discovery.urls.length){issues.push({platform,state:discovery.state,message:'No inspectable profile links were returned. This does not establish that no matching accounts exist.'});this.observedState.set(this.key(actor,platform),discovery.state);continue;}
          for(const url of discovery.urls){
            bound.throwIfAborted();
            try{
              const profile=await this.driver.inspect(window,url,bound);
              if(['login_required','challenge_required'].includes(profile.sourceState)){issues.push({platform,state:profile.sourceState,message:'Complete the platform login or verification in a new sign-in window.'});this.observedState.set(this.key(actor,platform),profile.sourceState);break;}
              if(profile.sourceState==='unavailable'){issues.push({platform,state:'profile_unavailable',url});continue;}
              if(!profiles.some(value=>value.id===profile.id)){profiles.push(profile);this.observedState.set(this.key(actor,platform),'read_verified');}
            }catch(error){if(bound.aborted)throw error;issues.push({platform,state:'profile_unavailable',url});}
          }
        }catch(error){signal.throwIfAborted();issues.push({platform,state:deadline.aborted?'time_limit':'platform_unavailable',message:'The platform could not complete this search. Inspect its login/verification state and the saved partial results.'});}
        finally{await window?.browser.close().catch(()=>{});}
      }
      signal.throwIfAborted();
      return object({brief,profiles,issues,requested:brief.limit,observed:profiles.length,status:issues.length||profiles.length<brief.limit?'partial':'completed',observedAt:new Date().toISOString(),untrustedContent:true,
        note:'These are observed candidate profiles, not guaranteed matches. Review location/language evidence before shortlisting; contact details are only those displayed publicly. Drafting never sends a message.'});
    }finally{this.researchBusy.delete(key);}
  }
  async contacts(actor:Actor,input:ObjectValue={}):Promise<ObjectValue>{
    this.permit(actor,['web.read','memory.read']);
    const rows=await this.store.call<ObjectValue[]>('social.contacts',{...this.base(actor),secure:true});
    const ids=Array.isArray(input.ids)?input.ids.map(String):null,searchId=typeof input.searchId==='string'?input.searchId:null;
    return {contacts:rows.filter(row=>(!ids||ids.includes(String(row.id)))&&(!searchId||row.searchId===searchId)),limit:100};
  }
  async toolContacts(actor:Actor,input:ObjectValue):Promise<ObjectValue>{
    if(input.action==='connections')return this.status(actor);
    const result=await this.contacts(actor,input);
    if(Array.isArray(input.ids)&&input.ids.length)return result;
    return {contacts:(result.contacts as ObjectValue[]).map(row=>({id:row.id??null,revision:row.revision??null,platform:row.platform??null,handle:row.handle??null,
      stage:row.stage??null,sourceState:row.sourceState??null,searchId:row.searchId??null})),note:'Read selected IDs in batches of up to five to obtain full profile evidence before assessing matches or drafting.'};
  }
  async searches(actor:Actor):Promise<ObjectValue>{this.permit(actor,['web.read','memory.read']);return {searches:await this.store.call('social.searches',{...this.base(actor),secure:true})};}
  async export(actor:Actor):Promise<string>{const result=await this.contacts(actor);return contactCsv(result.contacts as ObjectValue[]);}
}
