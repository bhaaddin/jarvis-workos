import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStatus,stampBuild} from './build-stamp.mjs';

test('build identity rejects changed source/output and does not include private configuration',()=>{
  const parent=fileURLToPath(new URL('../runtime/build-tests/',import.meta.url));mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(path.join(parent,'stamp-')),component=path.join(root,'operator');
  try{
    mkdirSync(path.join(component,'src'),{recursive:true});mkdirSync(path.join(component,'dist'));
    for(const name of ['package.json','package-lock.json','tsconfig.json'])writeFileSync(path.join(component,name),'{}');
    const source=path.join(component,'src/main.ts'),output=path.join(component,'dist/main.js');
    writeFileSync(source,'export const value=1;');writeFileSync(output,'export const value=1;');
    assert.equal(buildStatus('operator',root).code,'BUILD_STAMP_MISSING');
    const stamp=stampBuild('operator',root);assert.equal(buildStatus('operator',root).valid,true);
    writeFileSync(path.join(component,'.env'),'SYNTHETIC_PRIVATE_VALUE=do-not-record');
    assert.equal(buildStatus('operator',root).valid,true);assert(!JSON.stringify(stamp).includes('PRIVATE_VALUE'));
    writeFileSync(source,'export const value=2;');assert.equal(buildStatus('operator',root).code,'BUILD_SOURCE_CHANGED');
    writeFileSync(source,'export const value=1;');writeFileSync(output,'corrupted');assert.equal(buildStatus('operator',root).code,'BUILD_OUTPUT_CHANGED');
  }finally{rmSync(root,{recursive:true,force:true});}
});
