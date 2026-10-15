import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaProjection,classifyClinicSchema,clinicDay} from '../clinic-contract.js';

test('Medical API profiles reflect advertised GET routes rather than a different checkout',()=>{
  const legacy=classifyClinicSchema({paths:{'/api/scheduling/appointments':{get:{}},'/api/services':{get:{}},'/api/billing/invoices':{get:{}},'/api/dashboard/stats':{get:{}}}},true);
  assert.equal(legacy.profile,'registration');assert(legacy.actions.includes('dashboard'));assert(!legacy.actions.includes('calendars'));assert(!legacy.actions.includes('activities'));
  const modern=classifyClinicSchema({paths:{'/api/day':{get:{}},'/api/day/summary':{get:{}},'/api/calendars':{get:{}},'/api/services':{get:{}}}},true);
  assert.equal(modern.profile,'booking-day');assert(modern.actions.includes('calendars'));
  assert.equal(classifyClinicSchema({paths:{'/api/scheduling/appointments':{get:{}}}},false).verified,false);
  assert(classifyClinicSchema({paths:{'/api/scheduling/appointments':{get:{}},'/api/Patients':{get:{}}}},true).actions.includes('patients'));
  assert.notEqual(legacy.contractHash,classifyClinicSchema({paths:{'/api/scheduling/appointments':{get:{description:'Changed response contract'}}}},true).contractHash);
});

test('clinic date bounds honor Prague DST and do not guess missing appointment prices',()=>{
  const spring=clinicDay('2026-03-29');assert.equal(spring.from,'2026-03-28T23:00:00.000Z');assert.equal(spring.to,'2026-03-29T22:00:00.000Z');
  const fall=clinicDay('2026-10-25');assert.equal(Date.parse(fall.to)-Date.parse(fall.from),25*3600000);
  assert.throws(()=>clinicDay('2026-02-30'));
  const range=clinicDay('2026-09-30');
  const summary=agendaProjection([{id:'a',startTime:'2026-09-30T08:00:00Z',status:'Scheduled'},
    {id:'b',startTime:'2026-09-30T09:00:00Z',status:'Cancelled'},{id:'next-day',startTime:range.to,status:'Scheduled'}],range,true);
  assert.equal(summary.recordCount,2);assert.deepEqual(summary.statusCounts,{Scheduled:1,Cancelled:1});assert.equal(summary.totalValue,null);
  assert.throws(()=>agendaProjection([{start:'unknown schema'}],range,true));
  assert.throws(()=>agendaProjection([{startTime:'2026-09-30T08:00:00'}],range,true),'Timezone-less values must not silently become UTC');
  assert.equal(agendaProjection([{startTime:'2026-09-30T10:00:00+02:00'}],range,true).firstStartUtc,'2026-09-30T08:00:00.000Z');
});
