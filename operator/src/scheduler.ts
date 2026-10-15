import type {ObjectValue} from './contracts.js';
import type {Config} from './config.js';
import type {ClaimedScheduledJob, Schedule} from './schedule-contracts.js';
import {OperatorError, publicError} from './errors.js';
import {Auth} from './auth.js';
import {EventBus} from './events.js';
import {Store} from './store.js';
import {ToolOwner} from './tool-owner.js';

export class Scheduler {
  private timer: NodeJS.Timeout|undefined;
  private active=false;
  private idle:Promise<void>=Promise.resolve();
  private readonly stopping=new AbortController();
  private current:{tenant:string;schedule:string;controller:AbortController}|null=null;
  lastFailure:ObjectValue|null=null;
  constructor(private readonly store:Store,private readonly owner:ToolOwner,private readonly auth:Auth,
    private readonly bus:EventBus,private readonly config:Config) {}

  start():void {
    this.timer=setInterval(()=>{void this.tick().catch(error=>{this.lastFailure=publicError(error);});},1000);
    this.timer.unref();
  }

  changed(schedule:Schedule):void {
    if(this.current?.tenant===schedule.tenantId&&this.current.schedule===schedule.id)
      this.current.controller.abort(new OperatorError('SCHEDULE_CHANGED','The schedule changed during this check.',409));
  }

  async tick():Promise<void> {
    if(this.active)return this.idle;
    if(this.stopping.signal.aborted)return;
    this.active=true;let complete!:()=>void;this.idle=new Promise(resolve=>{complete=resolve;});
    let release:(()=>void)|undefined;
    try {
      await this.store.call('reminders.dispatch',{now:Date.now()});
      await this.store.call('schedule.dispatch',{now:Date.now()});
      const claimed=await this.store.call<ClaimedScheduledJob|null>('schedule.claim',{now:Date.now()});
      if(!claimed){this.lastFailure=null;return;}
      const {job,actor}=claimed,controller=new AbortController();
      this.current={tenant:job.tenantId,schedule:job.schedule.id,controller};
      const bound=this.auth.bind(actor,AbortSignal.any([this.stopping.signal,controller.signal]));release=bound.release;
      let result:ObjectValue;
      try {
        await this.store.call('schedule.authorize',{tenantId:job.tenantId,id:job.id,leaseToken:job.leaseToken,now:Date.now()});
        result=await this.owner.invoke(job.schedule.tool,job.schedule.input,{actor,environment:this.config.environment,
          conversationId:job.schedule.conversationId,intentId:job.id,channel:'scheduler',secure:true,confidence:'high',
          source:'approved_schedule',signal:bound.signal});
      } catch(error){result={ok:false,error:publicError(error)};}
      const recorded=await this.store.call<ObjectValue>('schedule.complete',{tenantId:job.tenantId,id:job.id,leaseToken:job.leaseToken,now:Date.now(),result});
      this.bus.publish({id:job.id,kind:'schedule.finished',tenantId:job.tenantId,actorId:job.ownerId,at:Date.now(),
        data:{scheduleId:job.schedule.id,jobId:job.id,state:recorded.state??'unknown'}});
      this.lastFailure=null;
    }catch(error){this.lastFailure=publicError(error);}
    finally{release?.();this.current=null;this.active=false;complete();}
  }

  async stop():Promise<void> {
    if(this.timer)clearInterval(this.timer);
    this.stopping.abort(new OperatorError('SHUTTING_DOWN','The scheduler is stopping.',503));
    await this.idle;
  }
}
