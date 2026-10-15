import type {ObjectValue} from './contracts.js';

// Model-selected return-direct follows the upstream tool pattern, but only the
// trusted calculator's exact numeric output may terminate the run this way.
export function directCalculation(tool:string,input:ObjectValue,observed:ObjectValue,batchSize:number):string|null{
  if(tool!=='jarvis_calculate'||input._respond!==true||batchSize!==1||observed.ok!==true)return null;
  const result=observed.result;
  if(!result||typeof result!=='object'||Array.isArray(result))return null;
  const data=result.data;
  if(!data||typeof data!=='object'||Array.isArray(data)||data.rounded!==false||typeof data.value!=='string')return null;
  if(!/^-?\d+(?:\.\d+)?$/.test(data.value))return null;
  const value=data.value.includes('.')?data.value.replace(/0+$/,'').replace(/\.$/,''):data.value;
  return (value==='-0'?'0':value)+'.';
}
