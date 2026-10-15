import {randomUUID} from 'node:crypto';
import {writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import type {Config} from './config.js';
import type {Model,ObjectValue} from './contracts.js';
import {assert,OperatorError} from './errors.js';
import {object} from './store-context.js';
import type {Store} from './store.js';
import type {MeteredModel} from './model-metrics.js';

export type ResourceProfile='interactive'|'balanced';
export const keepAliveFor=(profile:ResourceProfile):number=>profile==='balanced'?900:-1;

export class RuntimeControl{
  private transition:string|null=null;
  private requests=0;
  private cached:{until:number;value:ObjectValue}|null=null;
  private checking:Promise<ObjectValue>|null=null;
  constructor(private readonly config:Config,private readonly store:Store,private readonly inner:Model,
    private readonly meter:MeteredModel,private readonly fetcher:typeof fetch=fetch){}

  assertAdmission():void{assert(this.transition===null,'RESOURCE_TRANSITION','Model resources are changing. Retry this request after the transition finishes.',503);}
  canDrain():boolean{return this.transition===null;}
  enterWork():()=>void{
    this.assertAdmission();this.requests++;let active=true;
    return ()=>{if(active){active=false;this.requests--;}};
  }

  private async json(route:string,body?:ObjectValue,signal=AbortSignal.timeout(4000)):Promise<ObjectValue>{
    assert(this.config.inference,'RESOURCE_UNSUPPORTED','The selected transport does not support these resource controls.',409);
    const base=new URL(this.config.inference.baseUrl);
    assert(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)&&!base.username&&!base.password,
      'CONFIG_INVALID','Runtime control requires the reviewed loopback model endpoint.',503);
    const response=await this.fetcher(new URL(route,base),{method:body?'POST':'GET',signal,redirect:'error',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    if(!response.ok){await response.body?.cancel();throw new OperatorError('MODEL_SERVICE_UNAVAILABLE','The local model service rejected the operation.',503);}
    const text=await response.text();assert(text.length<=2*1024*1024,'MODEL_STATUS_LIMIT','Model metadata exceeded its bound.',503);
    return object(JSON.parse(text));
  }

  async modelStatus(force=false):Promise<ObjectValue>{
    if(!force&&this.cached&&this.cached.until>Date.now())return structuredClone(this.cached.value);
    if(this.checking)return this.checking;
    this.checking=(async()=>{
      let state:ObjectValue;
      if(!this.config.inference){
        try{
          const response=await this.fetcher(new URL('/jarvis/operator-boundary',this.config.gatewayUrl),{headers:{Authorization:'Bearer '+this.config.gatewayToken},signal:AbortSignal.timeout(3000),redirect:'error'});
          const value=object(await response.json());const available=response.ok&&value.boundaryVersion===2&&value.nativeLogsDisabled===true;
          state={state:available?'gateway':'offline',available,warm:null,managed:false};
        }catch{state={state:'offline',available:false,warm:null,managed:false};}
      }else{
        try{
          const [version,tags,loaded]=await Promise.all([this.json('/api/version'),this.json('/api/tags'),this.json('/api/ps')]);
          const find=(value:unknown)=>Array.isArray(value)?value.map(object).find(item=>item.name===this.config.inference!.model):undefined;
          const installed=find(tags.models),resident=find(loaded.models);
          const matchingContext=resident?.context_length===this.config.inference.contextTokens;
          state={state:!installed?'missing':!resident?'cold':matchingContext?'ready':'context_mismatch',available:Boolean(installed),
            warm:Boolean(resident&&matchingContext),managed:true,version:version.version??null,digest:installed?.digest??null,
            contextTokens:resident?.context_length??null,reportedModelBytes:resident?.size??null,reportedGpuBytes:resident?.size_vram??null,
            allLayersAssignedToGpu:Boolean(resident&&resident.size===resident.size_vram),expiresAt:resident?.expires_at??null,
            note:'GPU assignment is reported by Ollama, not a physical VRAM-residency guarantee.'};
        }catch{state={state:'offline',available:false,warm:false,managed:true};}
      }
      this.cached={until:Date.now()+5000,value:state};return structuredClone(state);
    })();
    try{return await this.checking;}finally{this.checking=null;}
  }

  async snapshot(force=false):Promise<ObjectValue>{
    return {configurationHash:this.config.configurationHash,build:this.config.buildInfo??null,
      selected:this.config.inference?{transport:'ollama',model:this.config.inference.model,reasoning:this.config.inference.think,
        contextTokens:this.config.inference.contextTokens,maxTokens:this.config.inference.maxTokens}: {transport:'openclaw'},
      resources:{profile:this.config.resourceProfile??'interactive',keepAliveSeconds:this.config.inference?.keepAliveSeconds??-1,transition:this.transition},
      model:await this.modelStatus(force),inference:this.meter.snapshot()};
  }

  async control(operation:'standby'|'wake'|'profile',profile:ResourceProfile|undefined,signal:AbortSignal):Promise<ObjectValue>{
    this.assertAdmission();
    assert((operation==='profile')===(profile!==undefined),'RESOURCE_INPUT_INVALID','Only a profile operation accepts a profile value.');
    assert(this.config.inference,'RESOURCE_UNSUPPORTED','Resource controls require the selected native model.',409);
    assert(this.requests===0&&this.meter.active===0,'WORK_ACTIVE','Wait for active requests to finish before changing model resources.',409);
    this.transition=operation;
    let leaseRefresh='not_needed';
    try{
      const active=await this.store.call<{runs:number;actions:number}>('work.active',{});
      assert(active.runs===0&&active.actions===0&&this.meter.active===0,'WORK_ACTIVE','Queued or active work prevents changing model resources.',409);
      const status=await this.modelStatus(true);
      if(operation==='profile'){
        assert(profile==='interactive'||profile==='balanced','RESOURCE_PROFILE_INVALID','Choose interactive or balanced.');
        assert(this.config.resourceConfigPath,'CONFIG_INVALID','The resource profile file is not configured.',503);
        const temporary=path.join(path.dirname(this.config.resourceConfigPath),'.resources-'+randomUUID()+'.tmp');
        try{await writeFile(temporary,JSON.stringify({profile})+'\n',{flag:'wx',mode:0o600});await rename(temporary,this.config.resourceConfigPath);}
        finally{await unlink(temporary).catch(()=>{});}
        this.config.resourceProfile=profile;this.config.inference.keepAliveSeconds=keepAliveFor(profile);
        if(status.warm===true){
          // Ollama reloads a runner when its context-shift setting changes.
          // Match native chat's policy even for an empty lease-refresh request.
          try{await this.json('/api/generate',{model:this.config.inference.model,stream:false,shift:false,truncate:false,
            keep_alive:keepAliveFor(profile),options:{num_ctx:this.config.inference.contextTokens}},signal);leaseRefresh='updated';}
          catch(error){if(signal.aborted)throw error;leaseRefresh='deferred_to_next_request';}
        }
      }else if(operation==='standby'){
        if(status.state!=='cold'){
          assert(status.available===true,'MODEL_SERVICE_UNAVAILABLE','The selected model is not available.',503);
          await this.json('/api/generate',{model:this.config.inference.model,stream:false,keep_alive:0,shift:false,truncate:false},signal);
        }
      }else{
        assert(status.available===true,'MODEL_SERVICE_UNAVAILABLE','Install/start the selected model before waking it.',503);
        const result=await this.inner.complete([{role:'user',content:'Startup readiness check. Reply only Ready.'}],[],signal,undefined,'none');
        assert(result.text.trim()&&!result.calls.length,'MODEL_WARMUP_FAILED','The selected model did not confirm readiness.',503);
      }
      this.cached=null;
      return {operation,model:await this.modelStatus(true),profile:this.config.resourceProfile??'interactive',keepAliveSeconds:this.config.inference.keepAliveSeconds??-1,leaseRefresh};
    }finally{this.transition=null;this.cached=null;}
  }
}
