import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const folder=path.join(root,'logs','connection-tools-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const owner=spawnSync('docker',['inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}','jarvis-workos-openclaw-1'],{encoding:'utf8',timeout:10000});
if(owner.status!==0||owner.stdout.trim()!=='jarvis-workos')throw new Error('The expected owned Gateway container is unavailable.');
const update=`
import {readFileSync,writeFileSync,copyFileSync,constants,chmodSync,chownSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const oldActions="['list', 'overview', 'tree', 'read', 'search', 'git', 'instructions']";
const newActions="['list', 'connections', 'compatibility', 'overview', 'tree', 'read', 'search', 'git', 'instructions']";
const updates=[
  {file:'/home/node/.openclaw/extensions/jarvis-project-tools/index.js',rules:[[oldActions,newActions]]},
  {file:'/home/node/.openclaw/workspace/skills/jarvis-projects/bridge.mjs',rules:[[oldActions,newActions],["(action !== 'list' && !project)","(!['list','connections'].includes(action) && !project)"]]}
];
const prepared=updates.map(item=>{const original=readFileSync(item.file,'utf8'),metadata=statSync(item.file);let changed=original;for(const [before,after]of item.rules){if(changed.includes(after))continue;if(changed.split(before).length!==2)throw new Error('Unrecognized installed bridge version; preserved: '+item.file);changed=changed.replace(before,after);}return {...item,original,changed,metadata};});
const results=[];
for(const item of prepared){const before=createHash('sha256').update(item.original).digest('hex');if(item.changed!==item.original){try{copyFileSync(item.file,item.file+'.before-connections-'+before.slice(0,12),constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}writeFileSync(item.file,item.changed);chownSync(item.file,item.metadata.uid,item.metadata.gid);chmodSync(item.file,item.metadata.mode&0o777);}results.push({file:item.file,changed:item.original!==item.changed,previousSha256:before,sha256:createHash('sha256').update(item.changed).digest('hex')});}
console.log(JSON.stringify(results));`;
const patched=spawnSync('docker',['exec','--user','0','-i','jarvis-workos-openclaw-1','node','--input-type=module'],{input:update,encoding:'utf8',timeout:30000});
writeFileSync(path.join(folder,'migration.log'),(patched.stdout??'')+(patched.stderr??''));
if(patched.status!==0){console.error('Installed project-tool migration failed; see '+folder);process.exitCode=patched.status??1;}
else{
  const reload=spawnSync('docker',['exec','jarvis-workos-openclaw-1','node','dist/index.js','plugins','reload','jarvis-project-tools'],{encoding:'utf8',timeout:60000});
  writeFileSync(path.join(folder,'reload.log'),(reload.stdout??'')+(reload.stderr??''));
  writeFileSync(path.join(folder,'results.json'),JSON.stringify({migrationExit:patched.status,reloadExit:reload.status,files:JSON.parse(patched.stdout)},null,2));
  console.log(JSON.stringify({migrationExit:patched.status,reloadExit:reload.status,artifacts:folder}));if(reload.status!==0)process.exitCode=reload.status??1;
}
