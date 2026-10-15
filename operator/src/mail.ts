import {ImapFlow} from 'imapflow';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
import {createHash} from 'node:crypto';
import type {Actor,ObjectValue} from './contracts.js';
import {Store} from './store.js';
import {assert,OperatorError} from './errors.js';
import {object} from './store-context.js';
import {readFile} from 'node:fs/promises';
import {actorArtifactRoot,containedFile,publishAttachment} from './files.js';

const mailDate=(value:Date|string|undefined):string|null=>{if(!value)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;};

export class Mail {
  constructor(private readonly store:Store){}
  private async settings(actor:Actor):Promise<ObjectValue>{
    const value=await this.store.call<ObjectValue|null>('connection.get',{tenantId:actor.tenantId,actorId:actor.id,now:Date.now(),id:'mail'});
    assert(value,'MAIL_CONNECTION_REQUIRED','Connect your email account in the JARVIS email card first.',409);return value;
  }
  private async withClient<T>(settings:ObjectValue,signal:AbortSignal,work:(client:ImapFlow)=>Promise<T>):Promise<T>{
    const client=new ImapFlow({host:String(settings.imapHost),port:993,secure:true,auth:{user:String(settings.user),pass:String(settings.password)},
      logger:false,disableAutoIdle:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
    client.on('error',()=>{});
    const abort=()=>client.close();signal.addEventListener('abort',abort,{once:true});
    try{signal.throwIfAborted();await client.connect();return await work(client);}
    catch(error){if(signal.aborted)throw signal.reason;if(error instanceof OperatorError)throw error;
      throw new OperatorError('MAIL_CONNECTION_FAILED','The mailbox could not complete the request. Check its IMAP/app-password or OAuth requirements.',502);}
    finally{signal.removeEventListener('abort',abort);await client.logout().catch(()=>client.close());}
  }
  async connect(actor:Actor,input:ObjectValue,signal:AbortSignal):Promise<ObjectValue>{
    assert(actor.permissions.includes('connections.manage'),'FORBIDDEN','This account cannot connect email.',403);
    assert(typeof input.imapHost==='string'&&/^[a-z0-9.-]+$/i.test(input.imapHost)&&input.imapHost.includes('.'),
      'MAIL_HOST_INVALID','Enter the IMAP server hostname.');
    assert(typeof input.user==='string'&&input.user.length<=200&&typeof input.password==='string'&&input.password.length>0&&input.password.length<=500,
      'MAIL_LOGIN_INVALID','Enter the mailbox username and its password/app password.');
    if(input.smtpHost)assert(typeof input.smtpHost==='string'&&/^[a-z0-9.-]+$/i.test(input.smtpHost),'MAIL_HOST_INVALID','Enter the SMTP hostname.');
    const settings:ObjectValue={imapHost:input.imapHost,user:input.user,password:input.password,smtpHost:input.smtpHost??'',smtpPort:input.smtpPort===587?587:465,from:input.from??input.user};
    await this.withClient(settings,signal,async client=>{await client.status('INBOX',{messages:true});});
    await this.store.call('connection.save',{tenantId:actor.tenantId,actorId:actor.id,now:Date.now(),id:'mail',value:settings});
    return {connected:true,user:settings.user??'',sendingConfigured:Boolean(settings.smtpHost)};
  }
  async status(actor:Actor):Promise<ObjectValue>{
    const value=await this.store.call<ObjectValue|null>('connection.get',{tenantId:actor.tenantId,actorId:actor.id,now:Date.now(),id:'mail'});
    return {connected:Boolean(value),user:value?.user??null,sendingConfigured:Boolean(value?.smtpHost)};
  }
  async read(actor:Actor,input:ObjectValue,signal:AbortSignal):Promise<ObjectValue>{
    if(input.action==='connection')return this.status(actor);
    const settings=await this.settings(actor),folder=String(input.folder??'INBOX');
    assert(folder.length<=100&&!/[\x00-\x1f]/.test(folder),'MAIL_FOLDER_INVALID','Choose a normal mailbox folder.');
    return this.withClient(settings,signal,async client=>{
      if(input.action==='folders')return {folders:(await client.list()).slice(0,100).map(value=>({path:value.path,name:value.name})),untrustedContent:true};
      const lock=await client.getMailboxLock(folder,{readOnly:true});
      try{
        const mailbox=client.mailbox;assert(mailbox,'MAILBOX_UNAVAILABLE','The mailbox could not be opened.',502);
        const prefix='v1:'+createHash('sha256').update(folder).digest('hex').slice(0,16)+':'+String(mailbox.uidValidity)+':';
        if(input.action==='read'){
          const id=String(input.messageId??'');assert(id.startsWith(prefix)&&/^\d+$/.test(id.slice(prefix.length)),'MAIL_MESSAGE_CHANGED','Select the current message identity from a mailbox listing.',409);
          const uid=Number(id.slice(prefix.length));const metadata=await client.fetchOne(uid,{size:true},{uid:true});
          assert(metadata&&metadata.size!==undefined&&metadata.size<=8*1024*1024,'MAIL_MESSAGE_LIMIT','This message is absent or larger than the 8 MiB extraction limit.',413);
          const value=await client.fetchOne(uid,{source:true},{uid:true});assert(value&&value.source,'MAIL_MESSAGE_UNAVAILABLE','The message could not be read.',502);
          const parsed=await simpleParser(value.source,{skipHtmlToText:false,skipTextToHtml:true,skipImageLinks:true});
          return {messageId:id,subject:parsed.subject??'',from:parsed.from?.text??'',date:parsed.date?.toISOString()??null,text:(parsed.text??'').slice(0,40000),
            attachments:parsed.attachments.map((item,index)=>({index,name:item.filename??'attachment',contentType:item.contentType,bytes:item.size,sha256:createHash('sha256').update(item.content).digest('hex')})),
            senderVerified:false,untrustedContent:true,observedAt:new Date().toISOString()};
        }
        const limit=Math.max(1,Math.min(30,Number(input.limit??10)));let range:string;let uid=false;
        if(input.action==='search'){
          const query=String(input.query??'');assert(query.length>0&&query.length<=200,'MAIL_QUERY_INVALID','Enter a bounded mail search.');
          const found=await client.search({or:[{subject:query},{from:query},{body:query}]},{uid:true});
          const selected=(found||[]).slice(-limit);if(!selected.length)return {messages:[],count:0,folder,untrustedContent:true,observedAt:new Date().toISOString()};
          range=selected.join(',');uid=true;
        }else {if(mailbox.exists===0)return {messages:[],count:0,folder,untrustedContent:true,observedAt:new Date().toISOString()};range=Math.max(1,mailbox.exists-limit+1)+':*';}
        const messages:ObjectValue[]=[];
        for await(const item of client.fetch(range,{envelope:true,flags:true,size:true},{uid})){
          signal.throwIfAborted();messages.push({messageId:prefix+item.uid,subject:item.envelope?.subject??'',from:(item.envelope?.from??[]).map(value=>({name:value.name??'',address:value.address??''})),
            date:mailDate(item.envelope?.date),unread:!item.flags?.has('\\Seen'),bytes:item.size??null});
        }
        return {messages:messages.reverse(),count:messages.length,folder,untrustedContent:true,observedAt:new Date().toISOString()};
      }finally{lock.release();}
    });
  }
  async attachment(actor:Actor,actionId:string,input:ObjectValue,signal:AbortSignal,dispatch:()=>Promise<void>):Promise<ObjectValue>{
    const settings=await this.settings(actor),folder=String(input.folder??'INBOX');
    assert(folder.length<=100&&!/[\x00-\x1f]/.test(folder),'MAIL_FOLDER_INVALID','Choose a normal mailbox folder.');
    const attachment=await this.withClient(settings,signal,async client=>{
      const lock=await client.getMailboxLock(folder,{readOnly:true});
      try{
        const mailbox=client.mailbox;assert(mailbox,'MAILBOX_UNAVAILABLE','Mailbox unavailable.',502);
        const prefix='v1:'+createHash('sha256').update(folder).digest('hex').slice(0,16)+':'+String(mailbox.uidValidity)+':';
        const id=String(input.messageId);assert(id.startsWith(prefix)&&/^\d+$/.test(id.slice(prefix.length)),'MAIL_MESSAGE_CHANGED','Refresh this message identity.',409);
        const uid=Number(id.slice(prefix.length)),metadata=await client.fetchOne(uid,{size:true},{uid:true});
        assert(metadata&&metadata.size!==undefined&&metadata.size<=8*1024*1024,'MAIL_MESSAGE_LIMIT','The source message exceeds the extraction limit.',413);
        const fetched=await client.fetchOne(uid,{source:true},{uid:true});assert(fetched&&fetched.source,'MAIL_MESSAGE_UNAVAILABLE','Message unavailable.',404);
        const parsed=await simpleParser(fetched.source,{skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true});
        const item=parsed.attachments[Number(input.index)];assert(item,'MAIL_ATTACHMENT_MISSING','This attachment does not exist.',404);
        assert(createHash('sha256').update(item.content).digest('hex')===input.sha256,'MAIL_ATTACHMENT_CHANGED','The attachment differs from the reviewed message.',409);
        return item;
      }finally{lock.release();}
    });
    signal.throwIfAborted();await dispatch();
    return publishAttachment(actor,actionId,attachment.filename??'attachment.bin',attachment.content,input);
  }
  async send(actor:Actor,input:ObjectValue,signal:AbortSignal,dispatch:()=>Promise<void>):Promise<ObjectValue>{
    const settings=await this.settings(actor);
    assert(settings.smtpHost,'MAIL_SEND_CONNECTION_REQUIRED','Configure the SMTP server in the email connection card.',409);
    const attachments:Array<{filename:string;content:Buffer}>=[];
    for(const raw of Array.isArray(input.attachments)?input.attachments:[]){
      const item=object(raw),record=await this.store.call<ObjectValue>('artifact.get',{tenantId:actor.tenantId,actorId:actor.id,now:Date.now(),id:item.id??'',secure:true});
      assert(record.sha256===item.sha256,'ATTACHMENT_CHANGED','An attachment differs from the reviewed receipt.',409);
      const content=await readFile(await containedFile(actorArtifactRoot(actor),String(record.relative)));
      assert(createHash('sha256').update(content).digest('hex')===item.sha256,'ATTACHMENT_CHANGED','An attachment changed on disk.',409);
      attachments.push({filename:String(record.name),content});
    }
    assert(attachments.reduce((size,item)=>size+item.content.length,0)<=10*1024*1024,'ATTACHMENT_LIMIT','Email attachments are limited to 10 MiB total.',413);
    signal.throwIfAborted();await dispatch();
    const transport=nodemailer.createTransport({host:String(settings.smtpHost),port:Number(settings.smtpPort),secure:settings.smtpPort===465,requireTLS:true,
      auth:{user:String(settings.user),pass:String(settings.password)},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,logger:false,debug:false,
      disableFileAccess:true,disableUrlAccess:true});
    const abort=()=>transport.close();signal.addEventListener('abort',abort,{once:true});
    try{
      signal.throwIfAborted();const result=await transport.sendMail({from:String(settings.from),to:(input.to as string[]).join(', '),subject:String(input.subject),text:String(input.text),attachments});
      return {messageId:String(result.messageId),accepted:(result.accepted??[]).map(String),rejected:(result.rejected??[]).map(String),
        delivery:'Accepted by SMTP is not proof of delivery to the recipient.',observedAt:new Date().toISOString()};
    }finally{signal.removeEventListener('abort',abort);transport.close();}
  }
}
