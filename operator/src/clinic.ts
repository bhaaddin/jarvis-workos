import type {Actor,ObjectValue} from './contracts.js';
import {assert,OperatorError} from './errors.js';
import {Store} from './store.js';
import {object} from './store-context.js';
import {ResilientHttp} from './resilience.js';
import {classifyClinicSchema,clinicDay,agendaProjection,type ClinicContract} from './clinic-contract.js';

// Select reviewed read-only routes from the running API's advertised profile.
// Never query the clinic database or substitute a generated clinic dataset.
export class Clinic {
  private readonly base:URL;
  private readonly http=new ResilientHttp();
  private cachedContract:{until:number;value:ClinicContract}|null=null;
  constructor(private readonly store:Store){
    this.base=new URL(process.env.JARVIS_SPORTMEDICAL_BASE_URL??'http://127.0.0.1:5092');
    assert(this.base.protocol==='https:'||this.base.protocol==='http:'&&['127.0.0.1','localhost'].includes(this.base.hostname),
      'CLINIC_URL_INVALID','A remote clinic connection requires HTTPS.',503);
  }
  async discover(signal:AbortSignal):Promise<ClinicContract>{
    if(this.cachedContract&&this.cachedContract.until>Date.now())return this.cachedContract.value;
    let result:ClinicContract={reachable:false,healthy:false,verified:false,profile:'unknown',protectedReads:false,routes:[],actions:['connection','capabilities'],contractHash:null,message:'The configured Medical API is offline or unreachable.'};
    try{
      const health=await fetch(new URL('/health',this.base),{signal:AbortSignal.any([signal,AbortSignal.timeout(3000)]),redirect:'error'});
      result.reachable=true;result.healthy=health.ok;await health.body?.cancel();
      const response=await fetch(new URL('/openapi/v1.json',this.base),{signal:AbortSignal.any([signal,AbortSignal.timeout(4000)]),redirect:'error'});
      assert(response.ok,'CLINIC_CONTRACT_UNAVAILABLE','The running clinic does not expose its reviewed OpenAPI contract.',503);
      const text=await response.text();assert(text.length<4*1024*1024,'CLINIC_CONTRACT_LIMIT','The clinic contract exceeds its inspection limit.',413);
      const probe=await fetch(new URL('/api/services',this.base),{signal:AbortSignal.any([signal,AbortSignal.timeout(3000)]),redirect:'error'});
      const protectedReads=probe.status===401||probe.status===403;await probe.body?.cancel();
      result={...classifyClinicSchema(JSON.parse(text),protectedReads),healthy:result.healthy};
    }catch(error){
      if(signal.aborted)throw signal.reason;
      if(result.reachable)result.message=error instanceof OperatorError?error.message:'The running clinic contract could not be verified.';
    }
    this.cachedContract={until:Date.now()+30000,value:result};return result;
  }
  private async request(route:string,signal:AbortSignal,token?:string,body?:ObjectValue):Promise<unknown>{
    const response=await this.http.request({integration:'sportmedical:'+this.base.origin,url:new URL(route,this.base),method:body?'POST':'GET',signal,
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),
      safety:body?'non_idempotent':'read',timeoutMs:20000,maximumBytes:2*1024*1024,acceptedStatuses:[401,403]});
    if(response.status===401)throw new OperatorError('CLINIC_SIGNIN_REQUIRED','Sign in to SportMedical in the JARVIS connection card.',401);
    if(response.status===403)throw new OperatorError('CLINIC_PERMISSION_REQUIRED','Your SportMedical account does not permit this read.',403);
    assert(response.status>=200&&response.status<300,'CLINIC_API_UNAVAILABLE','The configured SportMedical API could not complete this request.',502);
    return JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown;
  }
  async login(actor:Actor,email:string,password:string,signal:AbortSignal):Promise<ObjectValue>{
    assert(actor.permissions.includes('connections.manage'),'FORBIDDEN','This account cannot connect business accounts.',403);
    const contract=await this.discover(signal);
    assert(contract.verified&&contract.healthy,'CLINIC_CONTRACT_UNVERIFIED',contract.message,503);
    const value=object(await this.request('/api/v1/session',signal,undefined,{email,password}));
    assert(typeof value.accessToken==='string'&&value.accessToken.length>=20&&typeof value.expiresAtUtc==='string',
      'CLINIC_SESSION_INVALID','The clinic did not return its expected session contract.',502);
    const user=object(value.account??{}),expires=Date.parse(value.expiresAtUtc);
    assert(Number.isFinite(expires)&&expires>Date.now(),'CLINIC_SESSION_INVALID','The clinic session is already expired.',502);
    await this.store.call('connection.save',{tenantId:actor.tenantId,actorId:actor.id,now:Date.now(),id:'sportmedical',
      value:{token:value.accessToken,expires,origin:this.base.origin,permissions:value.permissions??[],displayName:user.displayName??'Connected account',contractHash:contract.contractHash}});
    return {connected:true,expires,displayName:user.displayName??'Connected account',permissions:value.permissions??[]};
  }
  async status(actor:Actor):Promise<ObjectValue>{
    const value=await this.store.call<ObjectValue|null>('connection.get',{tenantId:actor.tenantId,actorId:actor.id,now:Date.now(),id:'sportmedical'});
    const contract=await this.discover(AbortSignal.timeout(12000));
    return {configuredOrigin:this.base.origin,connected:Boolean(value&&Number(value.expires)>Date.now()&&value.origin===this.base.origin),
      readOnly:true,writeActions:[],contractChanged:Boolean(value&&value.contractHash!==contract.contractHash),
      expires:value?.expires??null,displayName:value?.displayName??null,apiReachable:contract.reachable,apiHealthy:contract.healthy,
      contractVerified:contract.verified,apiProfile:contract.profile,availableActions:contract.actions,message:contract.message};
  }
  async read(actor:Actor,input:ObjectValue,signal:AbortSignal):Promise<ObjectValue>{
    if(input.action==='connection'||input.action==='capabilities')return this.status(actor);
    const connection=await this.store.call<ObjectValue|null>('connection.get',{tenantId:actor.tenantId,actorId:actor.id,now:Date.now(),id:'sportmedical'});
    assert(connection&&typeof connection.token==='string'&&Number(connection.expires)>Date.now()&&connection.origin===this.base.origin,
      'CLINIC_SIGNIN_REQUIRED','Connect your SportMedical account in the JARVIS connection card to read real appointments, invoices or prices.',401);
    const contract=await this.discover(signal);
    assert(contract.verified&&contract.healthy,'CLINIC_CONTRACT_UNVERIFIED',contract.message,503);
    assert(connection.contractHash===contract.contractHash,'CLINIC_CONTRACT_CHANGED','The running clinic contract changed. Reconnect the account before using this API profile.',409);
    assert(contract.actions.includes(String(input.action)),'CLINIC_ACTION_UNAVAILABLE','That operation is not available in the running Medical API profile.',409);
    let route:string;
    let legacyDay:{from:string;to:string}|null=null;
    if(input.action==='day'||input.action==='summary'){
      const range=clinicDay(input.date);
      if(contract.profile==='booking-day')route=input.action==='summary'?'/api/day/summary?date='+range.date:'/api/day?from='+range.date+'&to='+range.date;
      else{legacyDay=range;route='/api/scheduling/appointments?'+new URLSearchParams({from:range.from,to:range.to}).toString();}
    }else if(input.action==='patients'){
      const query=String(input.query??'');assert(query.length>=2&&query.length<=100,'PATIENT_QUERY_REQUIRED','Provide a specific patient search; do not enumerate the whole registry.');
      route='/api/patients?'+new URLSearchParams({query,page:'1',pageSize:'20'}).toString();
    }else if(input.action==='activities')route='/api/activities';
    else if(input.action==='dashboard')route='/api/dashboard/stats';
    else if(input.action==='upcoming')route='/api/dashboard/upcoming?take=20';
    else if(input.action==='appointments'){
      const from=Date.parse(String(input.from)),to=Date.parse(String(input.to));
      assert(Number.isFinite(from)&&Number.isFinite(to)&&to>from&&to-from<=31*86400000,'CLINIC_DATE_RANGE','Provide a valid date range of at most 31 days.');
      route='/api/scheduling/appointments?'+new URLSearchParams({from:new Date(from).toISOString(),to:new Date(to).toISOString()}).toString();
    }else route=input.action==='invoices'?'/api/billing/invoices':input.action==='prices'?'/api/services':'/api/calendars';
    const payload=await this.request(route,signal,connection.token);
    if(!Array.isArray(payload))assert(object(payload).success!==false,'CLINIC_QUERY_REJECTED','The clinic did not accept this query.',422);
    const data=Array.isArray(payload)?payload:object(payload).data??payload;
    const projected=legacyDay?agendaProjection(data,legacyDay,input.action==='summary'):Array.isArray(data)?data.slice(0,200):data as ObjectValue;
    return {source:new URL(route,this.base).origin+new URL(route,this.base).pathname,apiProfile:contract.profile,contractHash:contract.contractHash,data:projected,
      returnedCount:Array.isArray(data)?Math.min(data.length,200):null,totalCount:Array.isArray(data)?data.length:null,truncated:Array.isArray(data)&&data.length>200,
      observedAt:new Date().toISOString(),appointmentValue:'Use explicitly linked billing/pricing data; do not infer prices from patient names or unmatched catalog items.'};
  }
}
