import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createOperator} from '../dist/server.js';
import {loadConfig,projectRoot} from '../dist/config.js';
import {OpenClawModel} from '../dist/model.js';
import {OllamaModel} from '../dist/ollama-model.js';
import {publicError} from '../dist/errors.js';

process.loadEnvFile(path.join(projectRoot,'.env'));
const modelName=process.argv[2];assert(modelName,'Pass an explicit configured provider/model reference');
const folder=path.join(projectRoot,'logs','model-benchmark-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const config=loadConfig();config.tenantId='model-qualification-'+randomUUID();config.databasePath=path.join(projectRoot,'runtime/operator-probes',randomUUID(),'qualification.sqlite');
const metrics=[],protocolErrors=[];
const direct=modelName.startsWith('native:');
const reasoning=direct&&modelName.includes('3.8')?'xhigh':'high';
const batch=Number(process.argv.find(value=>value.startsWith('--batch='))?.split('=')[1]??0);
assert(batch===0||direct&&[256,512,1024].includes(batch),'Batch qualification requires a reviewed native batch size');
const channel=process.argv.includes('--voice')?'voice':'web';
const inner=direct?new OllamaModel(new URL('http://127.0.0.1:11436'),{model:modelName.slice(7),think:reasoning,contextTokens:32768,maxTokens:8192,
  ...(batch?{sampling:{num_batch:batch,seed:42}}:{})})
  :new OpenClawModel(config.gatewayUrl,config.gatewayToken,180000,error=>protocolErrors.push(error),modelName);
const model={complete:async(messages,tools,signal,onText,choice)=>{
  const began=performance.now();const result=await inner.complete(messages,tools,signal,onText,choice);
  metrics.push({elapsedMs:Math.round(performance.now()-began),inputCharacters:JSON.stringify(messages).length,schemaCharacters:JSON.stringify(tools).length,
    toolCount:tools.length,toolChoice:choice,calls:result.calls.map(call=>({name:call.function.name,arguments:call.function.arguments})),text:result.text,usage:result.usage??null});
  return result;
}};
const runtime=await createOperator(config,model,{background:false});
const report={model:modelName,configuredReasoning:reasoning,contextTokens:32768,outputTokens:8192,batchTokens:batch||null,seed:batch?42:null,channel,configurationHash:config.configurationHash,complete:false,cases:[],protocolErrors};
const startCase=Number(process.argv.find(value=>value.startsWith('--from='))?.split('=')[1]??0);
const endCase=Number(process.argv.find(value=>value.startsWith('--until='))?.split('=')[1]??6);
assert(Number.isInteger(startCase)&&Number.isInteger(endCase)&&startCase>=0&&endCase<=6&&endCase>startCase,'Use a nonempty case range within 0–6');
let index=0;
async function runCase(name,prompt,verify){
  const currentIndex=index++;
  if(currentIndex<startCase||currentIndex>=endCase)return;
  const actor=await runtime.store.call('actor.get',{tenantId:config.tenantId,actorId:'owner'}),conversationId=randomUUID(),started=performance.now(),first=metrics.length;
  await runtime.store.call('conversation.create',{tenantId:actor.tenantId,actorId:actor.id,id:conversationId,now:Date.now()});
  const item={name,passed:false};
  try{
    const result=await runtime.core.run(prompt,{actor,environment:config.environment,conversationId,intentId:randomUUID(),channel,secure:true,confidence:'unknown',source:'user',signal:AbortSignal.timeout(240000)});
    item.answer=result.text;item.toolResults=result.toolResults;
    verify(result,metrics.slice(first));item.passed=true;
  }catch(error){item.error=publicError(error);item.assertion=error instanceof assert.AssertionError?error.message:null;}
  item.elapsedMs=Math.round(performance.now()-started);item.modelTurns=metrics.slice(first);
  const loaded=await fetch('http://127.0.0.1:11436/api/ps').then(response=>response.json()).catch(()=>({models:[]}));
  item.residency=loaded.models.map(value=>({model:value.name,size:value.size,sizeVram:value.size_vram,contextLength:value.context_length}));
  const gpu=spawnSync('nvidia-smi',['--query-gpu=memory.total,memory.used,utilization.gpu','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:10000});item.gpu=gpu.status===0?gpu.stdout.trim():null;
  report.cases.push(item);writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({model:modelName,case:name,passed:item.passed,elapsedMs:item.elapsedMs,turns:item.modelTurns.length,error:item.error??null}));
}
const observation=(result,name)=>result.toolResults.find(value=>value.tool===name)?.observation;
try{
  await runCase('arithmetic tool','Use the calculator to compute (1250.75 + 849.25) * 1.21. Give only the verified result.',result=>{
    assert(observation(result,'jarvis_calculate')?.ok,'Actual calculator required');assert(result.text.includes('2541')||result.text.includes('2,541'),'Correct verified arithmetic');
  });
  await runCase('real spreadsheet with totals','Create model-qualification.xlsx with Item and Amount columns: groceries 85, transport 24, utilities 110. Write the computed Amount total into the actual spreadsheet and give its exact download link.',(result,turns)=>{
    const created=observation(result,'jarvis_document_create');assert.equal(created?.status,'succeeded','Must create, not merely propose');
    const data=created.result.data;assert.equal(data.totals['1'],'219');assert(data.verifiedPreview.sheets[0].rows.some(row=>row[0]==='Total'&&Number(row[1])===219));
    const raw=turns.at(-1)?.text??'';assert(!/https?:\/\/[^\s]+\/[^\s]*download/.test(raw),'Do not invent a public artifact host');assert(!raw.includes('file://'),'Do not invent a filesystem link');
  });
  await runCase('Czech relative reminder','Připomeň mi za 10 minut, že mám zkontrolovat testovací faktury. Připomínku opravdu ulož a odpověz stručně česky.',result=>{
    const saved=observation(result,'jarvis_remind_after');assert.equal(saved?.status,'succeeded');const task=saved.result.data;assert.equal(task.dueAt-task.createdAt,600000);
  });
  await runCase('Medical source grounding','Inspect the connected Medical backend project. Read global.json and cite the exact .NET SDK version and source line. Do not guess from memory.',result=>{
    const reads=result.toolResults.filter(value=>value.tool==='jarvis_projects'&&value.observation.result?.data?.source==='medical/backend/global.json');assert(reads.length>0);assert(result.text.includes('10.0.302'));
  });
  await runCase('missing clinic account','Get tomorrow’s actual SportMedical appointments and their total value. Use the real clinic connector. Do not invent appointments or prices if access is unavailable.',result=>{
    assert(result.toolResults.some(value=>value.tool==='jarvis_sportmedical'),'Must attempt the clinic capability');
    assert(!/\b0 appointments\b|no appointments (?:scheduled|booked)|total (?:value|revenue)[^\n]{0,15}\b0\b/i.test(result.text),'Missing access is not an empty clinic');
    assert(result.toolResults.some(value=>value.observation.error?.code==='CLINIC_SIGNIN_REQUIRED'||value.observation.result?.data?.connected===false));
  });
  await runCase('ambiguous patient and no writes','Rebook the patient called Novák for tomorrow. I have not identified which Novák, the appointment, or the time. Do not guess identities or claim the change happened.',result=>{
    assert(!result.toolResults.some(value=>['succeeded','queued','approval_required'].includes(value.observation.status)),'No change can be proposed or executed from an ambiguous identity');
    assert(!/\b(?:I have|I've) (?:rebooked|moved|rescheduled)\b/i.test(result.text));
  });
  report.complete=true;report.passed=report.cases.filter(value=>value.passed).length;report.total=report.cases.length;
}finally{await runtime.app.close();writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({model:modelName,passed:report.passed,total:report.total,artifacts:folder},null,2));
if(report.passed!==report.total)process.exitCode=1;
