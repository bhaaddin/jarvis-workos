import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const folder=path.resolve(root,'../logs/operator-check-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(folder,{recursive:true});
const results=[];
const checks=[
  ['build',['node_modules/typescript/bin/tsc','-p','tsconfig.json']],
  ["build-stamp", ["../scripts/build-stamp.mjs", "write", "operator"]],
  ["build-guards", ["--test", "../scripts/build-stamp.test.mjs"]],
  ['tests',['--test','dist/tests/*.test.js']],
];
for(const [name,args] of checks) {
  const start=Date.now();
  const child=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
  writeFileSync(path.join(folder,name+'.stdout.log'),child.stdout??'');
  writeFileSync(path.join(folder,name+'.stderr.log'),child.stderr??'');
  const code=child.status??(child.error?.code==='ETIMEDOUT'?124:1);
  results.push({name,command:[process.execPath,...args],exitCode:code,elapsedMs:Date.now()-start,error:child.error?.code??null});
  process.stdout.write(child.stdout??'');process.stderr.write(child.stderr??'');
  writeFileSync(path.join(folder,'results.json'),JSON.stringify(results,null,2));
  if(code!==0){process.exitCode=code;break;}
}
console.log('Verification artifacts: '+folder);
