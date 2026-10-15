import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const inputs={operator:['src','package.json','package-lock.json','tsconfig.json'],
  frontend:['src','index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts']};
function digest(base,entries){
  const hash=createHash('sha256');let files=0;
  const visit=relative=>{
    const full=path.join(base,relative);
    if(!existsSync(full))throw new Error('Missing build input: '+relative);
    const statEntries=readdirSync(path.dirname(full),{withFileTypes:true});
    const entry=statEntries.find(value=>value.name===path.basename(full));
    if(!entry||entry.isSymbolicLink())throw new Error('Unsupported linked build input: '+relative);
    if(entry.isDirectory())for(const child of readdirSync(full).sort())visit(path.join(relative,child));
    else if(entry.isFile()&&path.basename(full)!=='.build-info.json'){
      hash.update(relative.replaceAll('\\','/')).update('\0').update(readFileSync(full)).update('\0');files++;
    }
  };
  for(const name of [...entries].sort())visit(name);
  return {digest:hash.digest('hex'),files};
}

export function buildStatus(component,workspace=root){
  if(!Object.hasOwn(inputs,component))throw new Error('Unknown build component');
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major!==24||minor<16)return {component,valid:false,code:'NODE_VERSION_UNSUPPORTED'};
  const base=path.join(workspace,component),stampPath=path.join(base,'dist/.build-info.json');
  if(!existsSync(stampPath))return {component,valid:false,code:'BUILD_STAMP_MISSING',fix:`npm --prefix ${component} run build`};
  try{
    const stamp=JSON.parse(readFileSync(stampPath,'utf8'));
    if(stamp.owner!=='jarvis-build'||stamp.version!==1)return {component,valid:false,code:'BUILD_STAMP_INVALID'};
    if(stamp.source!==digest(base,inputs[component]).digest)return {component,valid:false,code:'BUILD_SOURCE_CHANGED',fix:`npm --prefix ${component} run build`};
    if(stamp.output!==digest(base,['dist']).digest)return {component,valid:false,code:'BUILD_OUTPUT_CHANGED',fix:`npm --prefix ${component} run build`};
    return {component,valid:true,source:stamp.source,builtAt:stamp.builtAt,node:stamp.node};
  }catch{return {component,valid:false,code:'BUILD_STAMP_INVALID',fix:`npm --prefix ${component} run build`};}
}

export function stampBuild(component,workspace=root){
  if(!Object.hasOwn(inputs,component))throw new Error('Unknown build component');
  const base=path.join(workspace,component),entry=component==='operator'?'dist/main.js':'dist/index.html';
  if(!existsSync(path.join(base,entry)))throw new Error('Build output is missing');
  const stamp={owner:'jarvis-build',version:1,component,node:process.version,builtAt:new Date().toISOString(),
    source:digest(base,inputs[component]).digest,output:digest(base,['dist']).digest};
  mkdirSync(path.join(base,'dist'),{recursive:true});writeFileSync(path.join(base,'dist/.build-info.json'),JSON.stringify(stamp,null,2)+'\n');
  return stamp;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [operation,component]=process.argv.slice(2);
    if(!['write','check'].includes(operation))throw new Error('Use write/check and operator/frontend');
    const result=operation==='write'?stampBuild(component):buildStatus(component);
    console.log(JSON.stringify(result));if(operation==='check'&&!result.valid)process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
