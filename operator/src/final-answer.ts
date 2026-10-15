import type {ObjectValue} from './contracts.js';

// Link authority comes from completed effect receipts, never model-generated
// file:// paths. This validates output; it does not route natural-language intents.
export function groundedAnswer(text:string,observations:ObjectValue[]):string {
  const files:Array<{id:string;name:string;url:string}>=[];
  for(const entry of observations){
    const observation=entry.observation as ObjectValue|undefined;
    if(!observation)continue;
    let result=observation.result as ObjectValue|undefined;
    if(entry.tool==='jarvis_action_result'){
      const action=result?.data as ObjectValue|undefined;
      if(!['jarvis_document_create','jarvis_mail_attachment'].includes(String(action?.tool))||action?.state!=='succeeded')continue;
      result=action.result as ObjectValue|undefined;
    }else if(!['jarvis_document_create','jarvis_mail_attachment'].includes(String(entry.tool))||observation.status!=='succeeded')continue;
    const data=result?.data as ObjectValue|undefined;
    if(typeof data?.id==='string'&&typeof data.name==='string'&&data.url==='/api/operator/artifacts/'+data.id+'/download'
      &&!files.some(file=>file.id===data.id))files.push({id:data.id,name:data.name,url:String(data.url)});
  }
  const label=(file:{name:string})=>file.name.replace(/[\\[\]()]/g,'\\$&');
  let safe=text.replace(/\[([^\]]*)\]\(\s*<?(?:file|javascript|data):[^\n)]*>?\s*\)/gi,(_whole:string,caption:string)=>{
    const file=files.find(value=>caption.includes(value.url)||caption.includes(value.name));
    return file?`[${label(file)}](${file.url})`:caption;
  });
  for(const file of files){
    safe=safe.replace(/https?:\/\/[^\s<>"')]+/gi,(target:string)=>target.includes(file.id)?file.url:target);
    safe=safe.replace(/\[([^\]]*)\]\(([^\n)]*)\)/g,(whole:string,label:string,target:string)=>
      label.includes(file.name)||label.includes(file.url)||target.includes('/artifacts/'+file.id)
        ?`[${file.name.replace(/[\\[\]()]/g,'\\$&')}](${file.url})`:whole);
  }
  const missing=files.filter(file=>!safe.includes(']('+file.url+')'));
  if(missing.length)safe+='\n\n**Created files:**\n'+missing.map(file=>`- [${label(file)}](${file.url})`).join('\n');
  return safe;
}
