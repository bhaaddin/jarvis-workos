import type {ObjectValue} from './contracts.js';
import {assert} from './errors.js';
import type {ActionStore} from './store-actions.js';
import {StoreContext,integer,json,object,text} from './store-context.js';
import {contactId,normalizedQuote,profileLink} from './social-model.js';

const contactKind='social_contact',searchKind='social_search';
export function socialRead(store:StoreContext,operation:string,args:ObjectValue){
  const tenant=text(args.tenantId),actor=store.require(tenant,text(args.actorId),['web.read','memory.read']);
  assert(args.secure===true,'SECURE_CHANNEL_REQUIRED','Open social contacts in the secure application.',403);
  const kind=operation==='social.contacts'?contactKind:searchKind;
  return store.all('SELECT * FROM records WHERE tenant=? AND owner=? AND kind=? ORDER BY updated DESC LIMIT ?',tenant,actor.id,kind,kind===contactKind?100:20)
    .map(row=>({id:text(row.id),revision:integer(row.revision),...object(store.seal.open(text(row.payload,1000000),`record:${tenant}:${actor.id}:${kind}:${row.id}:${row.revision}`))}));
}

export function socialCommit(store:StoreContext,actions:ActionStore,args:ObjectValue){
  return store.transaction(()=>{
    const tenant=text(args.tenantId),actor=store.require(tenant,text(args.actorId),['web.read','memory.write']),now=integer(args.now);
    const action=actions.authorize({tenantId:tenant,id:text(args.actionId),leaseToken:text(args.leaseToken),now,dispatch:false});
    assert(action.ownerId===actor.id&&action.dispatchedAt!==null&&action.secure,'EFFECT_NOT_ADMITTED','A current, secure social-contact action is required.',403);
    const name=text(args.operation),input=object(args.input),hash=store.seal.digest(input);
    assert(['social.research','social.contacts.update'].includes(name)&&store.skill(action.tool).manifest.serviceOperations.includes(name),'EFFECT_NOT_DECLARED','This social operation was not declared.',403);
    const prior=store.get('SELECT * FROM effects WHERE tenant=? AND action=? AND operation=?',tenant,action.id,name);
    if(prior){assert(prior.input_hash===hash,'IDEMPOTENCY_CONFLICT','The social action input changed.',409);return store.seal.open(text(prior.result,1000000),`effect:${tenant}:${action.id}:${name}`);}
    const read=(id:string)=>{
      const row=store.get('SELECT * FROM records WHERE tenant=? AND owner=? AND kind=? AND id=?',tenant,actor.id,contactKind,id);
      return row?{revision:integer(row.revision),data:object(store.seal.open(text(row.payload,1000000),`record:${tenant}:${actor.id}:${contactKind}:${id}:${row.revision}`))}:null;
    };
    const save=(kind:string,id:string,data:ObjectValue,revision:number)=>store.run('INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant,owner,kind,id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated=excluded.updated',
      tenant,actor.id,kind,id,store.seal.seal(data,`record:${tenant}:${actor.id}:${kind}:${id}:${revision}`),revision,now);
    let result:ObjectValue;
    if(name==='social.research'){
      const observed=object(args.result),brief=object(observed.brief);
      assert(Array.isArray(observed.profiles)&&observed.profiles.length<=20,'SOCIAL_RESULT_INVALID','The profile result exceeded its bound.');
      const contacts=[];
      for(const raw of observed.profiles){
        const profile=object(raw),link=profileLink(text(profile.url,1000));
        assert(link&&profile.platform===link.platform&&profile.handle===link.handle&&['profile_read','limited_profile'].includes(String(profile.sourceState)),
          'SOCIAL_RESULT_INVALID','Only observed public-profile fields may be saved.');
        const id=contactId(link.platform,link.handle),previous=read(id),old=previous?.data??{};
        const sourceHash=store.seal.digest({sourceText:profile.sourceText??'',url:link.url});
        const data:ObjectValue={...profile,id,sourceHash,searchId:action.id,query:brief.query??'',location:brief.location??'',languages:brief.languages??'',purpose:brief.purpose??'',
          stage:old.stage??'new',notes:old.notes??'',draft:old.draft??'',draftPurpose:old.draftPurpose??'',matchReason:old.matchReason??'',evidenceQuote:old.evidenceQuote??'',
          assessmentSourceHash:old.assessmentSourceHash??null,assessmentStale:Boolean(old.assessmentSourceHash&&old.assessmentSourceHash!==sourceHash),contactedAt:old.contactedAt??null};
        const revision=(previous?.revision??0)+1;save(contactKind,id,data,revision);contacts.push({...data,revision});
      }
      result={searchId:action.id,...observed,profiles:json(contacts),saved:contacts.length};
      save(searchKind,action.id,{brief,status:observed.status??'partial',requested:observed.requested??20,saved:contacts.length,issues:observed.issues??[],observedAt:observed.observedAt??null},1);
    }else{
      assert(Array.isArray(input.edits)&&input.edits.length>0&&input.edits.length<=20,'SOCIAL_EDITS_INVALID','Update 1–20 saved contacts.');
      const contacts=[],seen=new Set<string>();
      for(const raw of input.edits){
        const edit=object(raw),id=text(edit.id,100);assert(!seen.has(id),'SOCIAL_EDITS_INVALID','Each contact may appear only once.');seen.add(id);
        assert(Object.keys(edit).every(key=>['id','expectedRevision','stage','notes','draft','draftPurpose','matchReason','evidenceQuote'].includes(key)),'SOCIAL_EDITS_INVALID','Observed profile/contact fields cannot be overwritten by a draft.');
        const previous=read(id);assert(previous,'NOT_FOUND','Saved contact not found.',404);
        assert(previous.revision===integer(edit.expectedRevision,1),'SOCIAL_CONTACT_CHANGED','This contact changed. Refresh it before editing.',409);
        const data={...previous.data};
        for(const field of ['notes','draft','draftPurpose','matchReason','evidenceQuote'])if(edit[field]!==undefined){
          assert(typeof edit[field]==='string'&&edit[field].length<=(field==='draft'?1500:field==='notes'?2000:500),'SOCIAL_EDITS_INVALID','Use bounded contact notes and message drafts.');data[field]=edit[field];
        }
        if(edit.matchReason){
          const quote=normalizedQuote(String(edit.evidenceQuote??''));
          assert(quote.length>=8&&normalizedQuote(String(data.sourceText??'')).includes(quote),'SOCIAL_EVIDENCE_REQUIRED','Quote the actual saved profile text to support a match.');
          data.assessmentSourceHash=data.sourceHash??null;data.assessmentStale=false;
        }
        if(edit.stage!==undefined){assert(['new','shortlisted','contacted','dismissed'].includes(String(edit.stage)),'SOCIAL_STAGE_INVALID','Choose a valid contact stage.');data.stage=edit.stage;if(edit.stage==='contacted')data.contactedAt=new Date(now).toISOString();}
        const revision=previous.revision+1;save(contactKind,id,data,revision);contacts.push({...data,id,revision});
      }
      result={contacts:json(contacts),updated:contacts.length,messageSending:false};
    }
    store.run('INSERT INTO effects VALUES(?,?,?,?,?,?)',tenant,action.id,name,hash,store.seal.seal(result,`effect:${tenant}:${action.id}:${name}`),now);
    store.audit(tenant,actor.id,'social.updated',{operation:name,actionId:action.id,count:(name==='social.research'?result.saved:result.updated)??0},now,'pii');
    return result;
  });
}
