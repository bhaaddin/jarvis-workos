import test from 'node:test';
import assert from 'node:assert/strict';
import {profileLink,parseProfile,contactCsv,validateBrief} from '../social-model.js';

test('social identities normalize profiles and reject content routes and credential-bearing URLs',()=>{
  assert.deepEqual(profileLink('https://www.instagram.com/Fit.Prague/?utm_source=test'),{platform:'instagram',handle:'fit.prague',url:'https://www.instagram.com/fit.prague/'});
  assert.equal(profileLink('https://www.tiktok.com/@Fit_Prague/video/123')?.url,'https://www.tiktok.com/@fit_prague');
  for(const value of ['https://instagram.com.evil.test/person','https://instagram.com/p/abc','https://instagram.com/accounts/login','https://instagram.com/popular/','https://user:secret@instagram.com/person','http://instagram.com/person','https://instagram.com:444/person'])assert.equal(profileLink(value),null,value);
});

test('contact extraction keeps observable fields and does not turn a login wall into a profile',()=>{
  const url='https://www.instagram.com/fit_prague/';
  const snapshot={url,title:'Synthetic Prague coach',description:'',bio:'Fitness coaching in Praha. Business: team@example.test',body:'Synthetic public profile',followers:'12.4K',links:[{text:'Website',url:'https://example.test/contact'},{text:'Call',url:'tel:+420123456789'}]};
  const profile=parseProfile(url,snapshot,'2026-10-06T12:00:00Z');
  assert.equal(profile.sourceState,'profile_read');assert.deepEqual(profile.emails,['team@example.test']);assert.equal(profile.followers,'12.4K');assert.equal(profile.observedAt,'2026-10-06T12:00:00Z');
  const blocked=parseProfile(url,{...snapshot,url:'https://www.instagram.com/accounts/login/',body:'Log in to continue'});
  assert.equal(blocked.sourceState,'login_required');assert.deepEqual(blocked.emails,[]);assert.equal(blocked.followers,null);assert.equal(blocked.sourceText,'');
  const redirected=parseProfile(url,{...snapshot,url:'https://www.instagram.com/another_account/'});assert.equal(redirected.sourceState,'unavailable');
});

test('social export escapes formulas and preserves quoted/newline text',()=>{
  const csv=contactCsv([{platform:'instagram',handle:'@example',displayName:'=1+1',notes:'a,"b"\nc'}]);
  assert(csv.includes('"\'@example"'));assert(csv.includes('"\'=1+1"'));assert(csv.includes('"a,""b""\nc"'));
  assert.throws(()=>validateBrief({query:'fitness',platforms:['instagram'],limit:21}),/1–20/);
  assert.equal(validateBrief({query:'fitness',location:'Prague',platforms:['instagram','tiktok']}).limit,20);
});
