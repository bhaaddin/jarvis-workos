import {randomUUID} from 'node:crypto';
import {CronExpressionParser} from 'cron-parser';
import type {Actor, ObjectValue} from './contracts.js';
import type {Schedule, ScheduledJob, ClaimedScheduledJob} from './schedule-contracts.js';
import {assert, OperatorError} from './errors.js';
import {StoreContext, integer, json, object, text} from './store-context.js';

export function nextOccurrence(cron: string, timezone: string, now: number, seed: string): number {
  assert(cron.trim().split(/\s+/).length === 5, 'SCHEDULE_INVALID', 'Use a five-field minute-resolution cron expression.');
  try {
    new Intl.DateTimeFormat('en', {timeZone:timezone}).format();
    return CronExpressionParser.parse('0 '+cron, {tz:timezone,currentDate:now,strict:true,hashSeed:seed}).next().getTime();
  } catch {throw new OperatorError('SCHEDULE_INVALID','The schedule or timezone is invalid. Specify day-of-month or day-of-week, not both.');}
}

export class ScheduleStore {
  constructor(private readonly store: StoreContext) {}

  private load(tenant: string, id: string): Schedule {
    const row=this.store.get('SELECT * FROM schedules WHERE tenant=? AND id=?',tenant,id);
    assert(row,'NOT_FOUND','Schedule not found.',404);
    const schedule=this.store.seal.open(text(row.payload,1000000),`schedule:${tenant}:${row.owner}:${id}`) as unknown as Schedule;
    assert(schedule.id===id&&schedule.ownerId===row.owner&&schedule.tenantId===tenant
      &&schedule.nextRun===row.next_run&&schedule.enabled===(row.enabled===1),'DATA_INTEGRITY','Schedule integrity failed.',500);
    return schedule;
  }

  private save(schedule: Schedule): void {
    this.store.run('INSERT INTO schedules VALUES(?,?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET enabled=excluded.enabled,next_run=excluded.next_run,payload=excluded.payload',
      schedule.tenantId,schedule.ownerId,schedule.id,schedule.enabled?1:0,schedule.nextRun,
      this.store.seal.seal(json(schedule),`schedule:${schedule.tenantId}:${schedule.ownerId}:${schedule.id}`));
  }

  private authority(schedule: Schedule): Actor {
    const actor=this.store.require(schedule.tenantId,schedule.ownerId,['schedule.manage','operator.chat']);
    const skill=this.store.skill(schedule.tool);
    assert(actor.revision===schedule.actorRevision,'AUTHORITY_CHANGED','The schedule owner authority changed.',409);
    assert(skill.ready&&skill.fingerprint===schedule.fingerprint&&skill.manifest.risk==='read',
      'SCHEDULE_TOOL_CHANGED','Review the changed or unavailable scheduled skill.',409);
    this.store.require(actor.tenantId,actor.id,skill.manifest.permissions);
    return actor;
  }

  put(args: ObjectValue): Schedule {
    return this.store.transaction(()=>{
      const tenant=text(args.tenantId),owner=text(args.actorId),now=integer(args.now),id=text(args.id,150);
      const actor=this.store.require(tenant,owner,['schedule.manage','operator.chat']);
      assert(args.secure===true,'SECURE_CHANNEL_REQUIRED','Configure automation in the secure application.',403);
      const row=this.store.get('SELECT id FROM schedules WHERE tenant=? AND id=?',tenant,id);
      const current=row?this.load(tenant,id):null;
      assert(!current||current.ownerId===owner,'NOT_FOUND','Schedule not found.',404);
      assert((current?.revision??0)===integer(args.expectedRevision),'SCHEDULE_CHANGED','Reload the schedule before changing it.',409);
      const skill=this.store.skill(text(args.tool,100));
      assert(skill.ready&&skill.manifest.risk==='read','SCHEDULE_READ_ONLY','Background schedules currently admit read-only checks.',409);
      assert(skill.fingerprint===text(args.fingerprint,100),'SCHEDULE_TOOL_CHANGED','Reload the changed tool before scheduling it.',409);
      this.store.require(tenant,owner,skill.manifest.permissions);
      const count=Number(this.store.get('SELECT COUNT(*) total FROM schedules WHERE tenant=? AND owner=?',tenant,owner)?.total??0);
      assert(current||count<25,'SCHEDULE_LIMIT','This account already has 25 schedules.',429);
      const cron=text(args.cron,150),timezone=text(args.timezone,100),nextRun=nextOccurrence(cron,timezone,now,id);
      const conversationId=current?.conversationId??randomUUID();
      if(!current)this.store.run('INSERT INTO conversations VALUES(?,?,?,?,?)',tenant,owner,conversationId,now,now);
      const schedule:Schedule={id,tenantId:tenant,ownerId:owner,revision:(current?.revision??0)+1,enabled:args.enabled===true,
        tool:skill.manifest.id,input:object(args.input),fingerprint:skill.fingerprint,actorRevision:actor.revision,
        cron,timezone,conversationId,nextRun,createdAt:current?.createdAt??now,updatedAt:now,reason:'configured'};
      this.save(schedule);
      for(const jobRow of this.store.all("SELECT id FROM scheduled_jobs WHERE tenant=? AND schedule=? AND state IN ('queued','running')",tenant,id)) {
        const job=this.loadJob(tenant,text(jobRow.id));job.state='cancelled';job.leaseToken=null;job.leaseExpires=null;job.updatedAt=now;this.saveJob(job);
      }
      this.store.audit(tenant,owner,'schedule.configured',json(schedule),now,'pii');
      return schedule;
    });
  }

  list(args: ObjectValue): Schedule[] {
    const tenant=text(args.tenantId),owner=text(args.actorId);
    this.store.require(tenant,owner,['schedule.manage']);
    assert(args.secure===true,'SECURE_CHANNEL_REQUIRED','Schedule details require the secure application.',403);
    return this.store.all('SELECT id FROM schedules WHERE tenant=? AND owner=? ORDER BY id',tenant,owner).map(row=>this.load(tenant,text(row.id)));
  }

  dispatch(now: number): number {
    return this.store.transaction(()=>{
      let created=0;
      for(const row of this.store.all('SELECT tenant,id FROM schedules WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 25',now)) {
        const schedule=this.load(text(row.tenant),text(row.id));
        try {this.authority(schedule);} catch {
          schedule.enabled=false;schedule.reason='authority_or_skill_changed';schedule.updatedAt=now;this.save(schedule);
          this.store.notify(schedule.tenantId,schedule.ownerId,'schedule.paused',{scheduleId:schedule.id,reason:schedule.reason},now);
          this.store.audit(schedule.tenantId,schedule.ownerId,'schedule.paused',{scheduleId:schedule.id,reason:schedule.reason},now);
          continue;
        }
        const busy=this.store.get("SELECT id FROM scheduled_jobs WHERE tenant=? AND schedule=? AND state IN ('queued','running')",schedule.tenantId,schedule.id);
        const dueAt=schedule.nextRun;
        // Coalesce missed intervals and overlap; never create a catch-up burst.
        schedule.nextRun=nextOccurrence(schedule.cron,schedule.timezone,now,schedule.id);schedule.updatedAt=now;
        this.save(schedule);
        if(busy)continue;
        const job:ScheduledJob={id:randomUUID(),tenantId:schedule.tenantId,ownerId:schedule.ownerId,schedule:structuredClone(schedule),dueAt,
          state:'queued',attempts:0,leaseToken:null,leaseExpires:null,result:null,createdAt:now,updatedAt:now};
        this.saveJob(job);created++;
        this.store.audit(job.tenantId,job.ownerId,'schedule.triggered',{scheduleId:schedule.id,jobId:job.id,dueAt,observedAt:now},now);
      }
      return created;
    });
  }

  private loadJob(tenant: string,id: string): ScheduledJob {
    const row=this.store.get('SELECT * FROM scheduled_jobs WHERE tenant=? AND id=?',tenant,id);
    assert(row,'NOT_FOUND','Scheduled check not found.',404);
    const job=this.store.seal.open(text(row.payload,1000000),`scheduled-job:${tenant}:${row.owner}:${id}`) as unknown as ScheduledJob;
    assert(job.id===id&&job.tenantId===tenant&&job.ownerId===row.owner&&job.state===row.state,
      'DATA_INTEGRITY','Scheduled check integrity failed.',500);
    return job;
  }

  private saveJob(job: ScheduledJob): void {
    this.store.run(`INSERT INTO scheduled_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET
      state=excluded.state,lease_expires=excluded.lease_expires,payload=excluded.payload,updated=excluded.updated`,
      job.tenantId,job.ownerId,job.id,job.schedule.id,job.schedule.revision,job.dueAt,job.state,job.leaseExpires,
      this.store.seal.seal(json(job),`scheduled-job:${job.tenantId}:${job.ownerId}:${job.id}`),job.createdAt,job.updatedAt);
  }

  private current(job: ScheduledJob): Actor {
    const schedule=this.load(job.tenantId,job.schedule.id);
    assert(schedule.enabled&&schedule.revision===job.schedule.revision,'SCHEDULE_CHANGED','The scheduled check was disabled or changed.',409);
    return this.authority(job.schedule);
  }

  claim(now: number): ClaimedScheduledJob|null {
    return this.store.transaction(()=>{
      for(const row of this.store.all("SELECT tenant,id FROM scheduled_jobs WHERE state='running' AND lease_expires<=?",now)) {
        const job=this.loadJob(text(row.tenant),text(row.id));
        job.state=job.attempts>=3?'failed':'queued';job.leaseToken=null;job.leaseExpires=null;job.updatedAt=now;
        this.saveJob(job);
        if(job.state==='failed')this.store.notify(job.tenantId,job.ownerId,'schedule.failed',{scheduleId:job.schedule.id,jobId:job.id,reason:'recovery_limit'},now);
      }
      for(const row of this.store.all("SELECT tenant,id FROM scheduled_jobs WHERE state='queued' ORDER BY created LIMIT 25")) {
        const job=this.loadJob(text(row.tenant),text(row.id));let actor:Actor;
        try {actor=this.current(job);}catch {job.state='cancelled';job.updatedAt=now;this.saveJob(job);continue;}
        job.state='running';job.attempts++;job.leaseToken=randomUUID();job.leaseExpires=now+120000;job.updatedAt=now;this.saveJob(job);
        return {job,actor};
      }
      return null;
    });
  }

  complete(args: ObjectValue): ScheduledJob {
    return this.store.transaction(()=>{
      const now=integer(args.now),job=this.loadJob(text(args.tenantId),text(args.id));
      if(job.state==='cancelled')return job;
      assert(job.state==='running'&&job.leaseToken===args.leaseToken&&(job.leaseExpires??0)>now,
        'LEASE_LOST','This scheduled worker no longer owns the result.',409);
      try {this.current(job);}catch {job.state='cancelled';job.leaseToken=null;job.leaseExpires=null;job.updatedAt=now;this.saveJob(job);return job;}
      job.result=object(args.result);job.state=job.result.ok===true?'completed':'failed';
      job.leaseToken=null;job.leaseExpires=null;job.updatedAt=now;this.saveJob(job);
      this.store.audit(job.tenantId,job.ownerId,'schedule.completed',{jobId:job.id,scheduleId:job.schedule.id,result:job.result},now,'pii');
      // External adapters receive only this safe reference, never raw read data.
      this.store.notify(job.tenantId,job.ownerId,'schedule.'+job.state,{scheduleId:job.schedule.id,jobId:job.id,state:job.state,tool:job.schedule.tool},now);
      return job;
    });
  }

  authorize(args: ObjectValue): void {
    const job=this.loadJob(text(args.tenantId),text(args.id));
    assert(job.state==='running'&&job.leaseToken===args.leaseToken&&(job.leaseExpires??0)>integer(args.now),
      'LEASE_LOST','This scheduled worker no longer owns the check.',409);
    this.current(job);
  }

  jobs(args: ObjectValue): ScheduledJob[] {
    const tenant=text(args.tenantId),owner=text(args.actorId),schedule=this.load(tenant,text(args.id));
    this.store.require(tenant,owner,['schedule.manage']);
    assert(schedule.ownerId===owner,'NOT_FOUND','Schedule not found.',404);
    assert(args.secure===true,'SECURE_CHANNEL_REQUIRED','Check results require the secure application.',403);
    return this.store.all('SELECT id FROM scheduled_jobs WHERE tenant=? AND schedule=? ORDER BY created DESC LIMIT 50',tenant,schedule.id)
      .map(row=>this.loadJob(tenant,text(row.id)));
  }
}
