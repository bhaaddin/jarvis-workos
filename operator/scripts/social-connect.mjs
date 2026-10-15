// Local-owner connection controls. No platform password or cookie value is
// accepted here, printed, or passed to the model. Sign-in happens on the site.
async function main(){
  const operation=process.argv[2]??'status';
  if(!['status','open'].includes(operation))throw new Error('Use status or open');
  const session=await fetch('http://127.0.0.1:18791/api/session',{signal:AbortSignal.timeout(10000)});
  if(!session.ok)throw new Error('Project Hub is unavailable');
  const cookie=session.headers.get('set-cookie')?.split(';')[0];
  async function call(route,body){
    const response=await fetch('http://127.0.0.1:18791/api/operator/social'+route,{method:body?'POST':'GET',signal:AbortSignal.timeout(30000),headers:{Cookie:cookie,Origin:'http://127.0.0.1:18791',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Social connection request failed: '+response.status);return data;
  }
  if(operation==='open')for(const platform of ['instagram','tiktok']){
    const opened=await call('/connections/'+platform+'/start',{});
    console.log(JSON.stringify({platform,state:opened.state,expiresAt:opened.expiresAt,instructions:opened.instructions}));
  }
  const result=await call('/connections');
  console.log(JSON.stringify({connections:result.connections.map(value=>({platform:value.platform,state:value.state,hasSession:value.hasSession,expiresAt:value.expiresAt}))},null,2));
}
try{await main();}catch(error){
  console.error(error.cause?.code==='ECONNREFUSED'?'JARVIS is not running. Start it with python -B scripts/dev.py up --voice.':'Social connection: '+error.message);
  process.exitCode=1;
}
