import {constants} from 'node:fs';
import {mkdir,lstat,realpath,open,readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import type {Actor,ObjectValue} from './contracts.js';
import {assert} from './errors.js';
import {projectRoot,packageRoot} from './config.js';
import {runProcess} from './processes.js';
import {object} from './store-context.js';

const extensions=new Set(['.txt','.md','.json','.csv','.pdf','.docx','.xlsx','.log']);
const blocked=/(^\.|password|credential|secret|token|private.key|notebook.access|prihlasovacie|^auth(?:-profiles)?\.json$|^id_(?:rsa|ed25519))/i;
export const artifactRoot=path.join(projectRoot,'runtime/operator-artifacts');
export const inboxRoot=path.join(projectRoot,'workspace/operator-inbox');
const ownerKey=(actor:Actor)=>createHash('sha256').update(actor.tenantId+'\0'+actor.id).digest('hex');
export function actorArtifactRoot(actor:Actor):string{return path.join(artifactRoot,ownerKey(actor));}

export function relativeFile(value:unknown):string {
  assert(typeof value==='string'&&value.length>0&&value.length<500,'FILE_PATH_INVALID','A bounded relative file path is required.');
  const parts=value.replaceAll('\\','/').split('/');
  assert(parts.every(part=>part&&part!=='.'&&part!=='..'&&!/[<>:"|?*\x00-\x1f]/.test(part)&&!/[. ]$/.test(part)
    &&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)&&!blocked.test(part)),
    'FILE_PATH_INVALID','Use a normal relative document path without credentials or traversal.');
  return parts.join('/');
}

export async function containedFile(root:string,relative:string):Promise<string> {
  const base=await realpath(root),parts=relativeFile(relative).split('/');let current=base;
  for(const part of parts){current=path.join(current,part);const entry=await lstat(current);assert(!entry.isSymbolicLink(),'FILE_LINK_BLOCKED','Linked files and directories are not followed.',403);}
  const resolved=await realpath(current);
  assert(resolved.startsWith(base+path.sep),'FILE_SCOPE_REJECTED','The file is outside the configured document root.',403);
  const entry=await lstat(resolved);
  assert(entry.isFile()&&entry.size<=20*1024*1024,'FILE_LIMIT','Choose a regular file no larger than 20 MiB.',413);
  return resolved;
}

export function roots(actor:Actor):Record<string,string> {
  return {inbox:path.join(inboxRoot,ownerKey(actor)),artifacts:actorArtifactRoot(actor),...(actor.permissions.includes('files.personal')
    ?{documents:path.join(os.homedir(),'Documents'),downloads:path.join(os.homedir(),'Downloads'),desktop:path.join(os.homedir(),'Desktop')}:{})};
}

export async function documentPath(actor:Actor,rootId:unknown,relative:unknown):Promise<string> {
  const root=typeof rootId==='string'?roots(actor)[rootId]:undefined;
  assert(root,'FILE_ROOT_UNKNOWN','Choose inbox, artifacts, documents, downloads or desktop.');
  const name=relativeFile(relative);
  assert(extensions.has(path.extname(name).toLowerCase()),'FILE_TYPE_UNSUPPORTED','Choose a supported document or text file.');
  return containedFile(root,name);
}

export async function findFiles(actor:Actor,input:ObjectValue):Promise<ObjectValue> {
  if(input.action==='roots')return {roots:Object.entries(roots(actor)).map(([id,location])=>({id,path:location})),supported:[...extensions]};
  const rootId=String(input.root??'inbox'),root=roots(actor)[rootId];assert(root,'FILE_ROOT_UNKNOWN','Unknown document root.');
  if(rootId==='inbox'||rootId==='artifacts')await mkdir(root,{recursive:true});
  const query=String(input.query??'').toLowerCase(),hits:ObjectValue[]=[];let examined=0;
  const walk=async(folder:string,prefix:string,depth:number):Promise<void>=>{
    for(const entry of await readdir(folder,{withFileTypes:true})){
      if(examined++>5000||hits.length>=100)return;
      if(entry.isSymbolicLink()||blocked.test(entry.name))continue;
      const relative=prefix+entry.name;
      if(entry.isDirectory()){
        if(depth<3&&!['node_modules','AppData','bin','obj','data','backups'].includes(entry.name))await walk(path.join(folder,entry.name),relative+'/',depth+1);
      }else if(entry.isFile()&&extensions.has(path.extname(entry.name).toLowerCase())&&relative.toLowerCase().includes(query)){
        const metadata=await lstat(path.join(folder,entry.name));hits.push({root:rootId,path:relative,bytes:metadata.size,modifiedAt:metadata.mtime.toISOString()});
      }
    }
  };
  await walk(root,'',0);return {files:hits,examined,truncated:examined>5000||hits.length>=100};
}

export async function pythonDocument(payload:ObjectValue,signal:AbortSignal):Promise<ObjectValue> {
  const python=process.env.JARVIS_OPERATOR_PYTHON??path.join(packageRoot,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const response=await runProcess(python,['-B',path.join(packageRoot,'python/documents.py')],{signal,input:JSON.stringify(payload),timeoutMs:40000,maximum:payload.operation==='table'?16*1024*1024:220000});
  let value:ObjectValue;try{value=object(JSON.parse(response.stdout));}catch{throw new Error('Document processor returned an invalid response.');}
  assert(response.code===0&&value.ok===true,'DOCUMENT_FAILED',typeof value.error==='string'?value.error:'The document operation failed.',422);
  return object(value.result);
}

export async function createDocument(actor:Actor,actionId:string,input:ObjectValue,signal:AbortSignal):Promise<ObjectValue> {
  const format=String(input.format);let name=relativeFile(input.name);
  if(!path.extname(name))name+='.'+format;
  assert(!name.includes('/')&&path.extname(name).toLowerCase()==='.'+format,'DOCUMENT_NAME_INVALID','Use a file name with the selected format extension.');
  assert(['pdf','docx','xlsx','csv','md','txt','json'].includes(format),'DOCUMENT_FORMAT_INVALID','Unsupported document output format.');
  const folder=path.join(actorArtifactRoot(actor),actionId);await mkdir(folder,{recursive:true});
  const final=path.join(folder,name),requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const receiptPath=path.join(folder,'receipt.json');
  try {
    const receipt=object(JSON.parse(await readFile(receiptPath,'utf8')));
    assert(receipt.requestHash===requestHash,'IDEMPOTENCY_CONFLICT','This output belongs to different input.',409);
    const file=await containedFile(actorArtifactRoot(actor),actionId+'/'+name),bytes=await readFile(file);
    assert(createHash('sha256').update(bytes).digest('hex')===receipt.sha256,'ARTIFACT_CHANGED','The saved artifact changed.',409);
    return receipt;
  }catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
  const staging=path.join(folder,'pending-'+name);
  const result=await pythonDocument({operation:'create',path:staging,spec:input},signal);signal.throwIfAborted();
  // Publish only a new action-owned path; never replace a user's file.
  const handle=await open(final,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY);
  try{await handle.writeFile(await readFile(staging));await handle.sync();}finally{await handle.close();}
  const receipt:ObjectValue={id:actionId,name,format,bytes:result.bytes??0,sha256:result.sha256??'',totals:result.totals??{},
    tableRowsWritten:result.tableRowsWritten??0,columnsWritten:result.columnsWritten??[],verifiedPreview:result.verifiedPreview??null,
    relative:actionId+'/'+name,requestHash,url:'/api/operator/artifacts/'+actionId+'/download'};
  await writeFile(receiptPath,JSON.stringify(receipt),{flag:'wx',mode:0o600});
  return receipt;
}

export async function publishAttachment(actor:Actor,actionId:string,name:string,bytes:Buffer,input:ObjectValue):Promise<ObjectValue>{
  name=relativeFile(path.basename(name));
  assert(/\.(pdf|docx|xlsx|csv|txt|md|json|png|jpe?g)$/i.test(name),'ATTACHMENT_TYPE_UNSUPPORTED','This attachment type is not enabled for download.');
  assert(bytes.length>0&&bytes.length<=20*1024*1024,'ATTACHMENT_LIMIT','Choose an attachment up to 20 MiB.',413);
  const folder=path.join(actorArtifactRoot(actor),actionId);await mkdir(folder,{recursive:true});
  const target=path.join(folder,name),hash=createHash('sha256').update(bytes).digest('hex');
  const receipt:ObjectValue={id:actionId,name,format:path.extname(name).slice(1).toLowerCase(),bytes:bytes.length,sha256:hash,
    relative:actionId+'/'+name,requestHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),url:'/api/operator/artifacts/'+actionId+'/download'};
  const handle=await open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await writeFile(path.join(folder,'receipt.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});return receipt;
}
