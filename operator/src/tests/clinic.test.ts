import test from 'node:test';
import assert from 'node:assert/strict';
import type {Actor,ObjectValue} from '../contracts.js';
import type {Store} from '../store.js';
import {Clinic} from '../clinic.js';
import {OperatorError} from '../errors.js';

const actor:Actor={id:'synthetic-owner',tenantId:'synthetic-clinic',displayName:'Qualification',roles:['owner'],
  permissions:['connections.manage'],revision:1,active:true,language:'en',timezone:'Europe/Prague'};
const schema={paths:{'/api/scheduling/appointments':{get:{}},'/api/services':{get:{}},'/api/Patients':{get:{}}}};
function connectionStore(){
  let connection:ObjectValue|null=null;
  return {call:async(operation:string,input:ObjectValue)=>{
    assert.equal(input.tenantId,actor.tenantId);assert.equal(input.actorId,actor.id);
    if(operation==='connection.get')return connection;
    assert.equal(operation,'connection.save');connection=input.value as ObjectValue;return {};
  }} as unknown as Store;
}
const hasCode=(code:string)=>(error:unknown)=>error instanceof OperatorError&&error.code===code;

test('unsafe, unavailable and unknown Medical contracts never receive login credentials',async t=>{
  let mode='anonymous';const posts:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:URL|string,options?:RequestInit)=>{
    const route=new URL(String(input)).pathname;
    if(options?.method==='POST'){posts.push(route);assert.fail('Credentials must not reach an unverified API');}
    if(mode==='offline')throw new TypeError('Synthetic offline');
    if(route==='/health')return new Response('healthy');
    if(route==='/openapi/v1.json')return mode==='no-schema'?new Response('',{status:404}):Response.json(mode==='unknown'?{paths:{'/api/services':{get:{}}}}:schema);
    assert.equal(route,'/api/services');return new Response('',{status:mode==='anonymous'?200:401});
  });
  for(mode of ['anonymous','no-schema','unknown','offline']){
    const clinic=new Clinic(connectionStore());
    await assert.rejects(clinic.login(actor,'synthetic@example.test','synthetic-password',AbortSignal.timeout(1000)),hasCode('CLINIC_CONTRACT_UNVERIFIED'));
    const status=await clinic.status(actor);assert.equal(status.contractVerified,false);assert.equal(status.connected,false);
    assert.equal(status.readOnly,true);assert.deepEqual(status.writeActions,[]);
    if(mode==='offline')assert.equal(status.apiReachable,false);
  }
  assert.deepEqual(posts,[]);
});

test('authenticated registration reads preserve DST bounds, unknown value, denial and contract-change states',async t=>{
  let changed=false,denied=0,reads=0;const requests:Array<{route:string;method:string}>=[];
  t.mock.method(globalThis,'fetch',async(input:URL|string,options?:RequestInit)=>{
    const url=new URL(String(input)),headers=new Headers(options?.headers),method=options?.method??'GET';requests.push({route:url.pathname,method});
    if(url.pathname==='/health')return new Response('healthy');
    if(url.pathname==='/openapi/v1.json')return Response.json(changed?{...schema,components:{schemas:{Appointment:{type:'string'}}}}:schema);
    if(url.pathname==='/api/services'&&!headers.has('Authorization'))return new Response('',{status:401});
    if(url.pathname==='/api/v1/session'){
      assert.equal(method,'POST');assert.deepEqual(JSON.parse(String(options?.body)),{email:'synthetic@example.test',password:'synthetic-password'});
      return Response.json({accessToken:'synthetic-token-with-sufficient-length',expiresAtUtc:new Date(Date.now()+60000).toISOString(),account:{displayName:'Synthetic'},permissions:['appointments.read']});
    }
    assert.equal(url.pathname,'/api/scheduling/appointments');assert.equal(method,'GET');
    assert.equal(headers.get('Authorization'),'Bearer synthetic-token-with-sufficient-length');
    assert.equal(url.searchParams.get('from'),'2026-03-28T23:00:00.000Z');assert.equal(url.searchParams.get('to'),'2026-03-29T22:00:00.000Z');
    reads++;
    if(denied)return new Response('',{status:denied});
    return Response.json({success:true,data:[{id:'synthetic-appointment',startTime:'2026-03-29T08:00:00Z',status:'Cancelled'}]});
  });
  const store=connectionStore(),clinic=new Clinic(store),signal=AbortSignal.timeout(5000);
  await clinic.login(actor,'synthetic@example.test','synthetic-password',signal);
  const input={action:'summary',date:'2026-03-29'};
  const result=await clinic.read(actor,input,signal),summary=result.data as ObjectValue;
  assert.equal(result.apiProfile,'registration');assert.equal(summary.recordCount,1);assert.equal(summary.totalValue,null);
  assert.deepEqual(summary.statusCounts,{Cancelled:1});
  for(denied of [401,403])await assert.rejects(clinic.read(actor,input,signal),hasCode(denied===401?'CLINIC_SIGNIN_REQUIRED':'CLINIC_PERMISSION_REQUIRED'));
  assert.equal(reads,3,'Authorization denials must not replay reads');
  await assert.rejects(clinic.read(actor,{action:'calendars'},signal),hasCode('CLINIC_ACTION_UNAVAILABLE'));
  changed=true;
  await assert.rejects(new Clinic(store).read(actor,input,signal),hasCode('CLINIC_CONTRACT_CHANGED'));
  assert.equal(reads,3,'Changed schemas must be rejected before any authenticated business read');
  assert.deepEqual(requests.filter(request=>request.method!=='GET'),[{route:'/api/v1/session',method:'POST'}]);
});
