import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {chromium} from 'playwright';
import type {ObjectValue} from './contracts.js';
import {assert,OperatorError} from './errors.js';

export async function publicUrl(raw:string):Promise<URL>{
  const url=new URL(raw);
  assert(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&(!url.port||['80','443'].includes(url.port)),
    'WEB_URL_REJECTED','Use a public HTTP(S) URL without credentials or custom ports.',403);
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  assert(hostname.includes('.')&&!hostname.endsWith('.local')&&!hostname.endsWith('.internal'),'WEB_URL_REJECTED','Local network names are not public websites.',403);
  const addresses=isIP(hostname)?[{address:hostname}]:await lookup(hostname,{all:true});
  assert(addresses.length>0&&addresses.every(({address})=>{
    if(address.includes(':'))return /^(2|3)[0-9a-f]{3}:/i.test(address)&&!address.toLowerCase().startsWith('2001:db8:');
    const [a=0,b=0]=address.split('.').map(Number);
    return a>0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127)&&!(a===198&&[18,19].includes(b));
  }),'WEB_PRIVATE_ADDRESS','Private, local and metadata network targets are blocked.',403);
  return url;
}

async function pinnedRequest(url:URL,method:string,headers:Record<string,string>,body:Buffer|null,signal:AbortSignal):Promise<{status:number;headers:Record<string,string>;body:Buffer}>{
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await lookup(hostname,{all:true});
  const address=addresses.find(value=>value.family===4)??addresses[0];assert(address,'WEB_FETCH_FAILED','The public host did not resolve.',502);
  // Revalidate the selected address and connect to exactly that address. Merely
  // checking DNS then letting Chromium resolve it again permits DNS rebinding.
  await publicUrl(url.protocol+'//'+(address.address.includes(':')?'['+address.address+']':address.address));
  return new Promise((resolve,reject)=>{
    const request=(url.protocol==='https:'?httpsRequest:httpRequest)({hostname:address.address,servername:hostname,
      port:url.port||(url.protocol==='https:'?443:80),path:url.pathname+url.search,method,agent:false,
      headers:{...headers,host:url.host,'accept-encoding':'identity'},signal,timeout:12000},response=>{
      const chunks:Buffer[]=[];let bytes=0;
      response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>3*1024*1024)request.destroy(new Error('Response limit'));else chunks.push(chunk);});
      response.on('end',()=>{const responseHeaders:Record<string,string>={};for(const[key,value]of Object.entries(response.headers))if(value!==undefined&&!['transfer-encoding','content-length'].includes(key))responseHeaders[key]=Array.isArray(value)?value.join('\n'):value;
        resolve({status:response.statusCode??502,headers:responseHeaders,body:Buffer.concat(chunks)});});
      response.on('error',reject);
    });
    request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('Public request timed out')));request.end(body??undefined);
  });
}

export async function browserRead(input:ObjectValue,signal:AbortSignal,interact=false):Promise<ObjectValue>{
  const search=input.action==='search';
  const url=await publicUrl(search?'https://www.bing.com/search?q='+encodeURIComponent(String(input.query)):String(input.url));
  const browser=await chromium.launch({headless:true,chromiumSandbox:true});
  const abort=()=>{void browser.close();};signal.addEventListener('abort',abort,{once:true});
  const context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
  let requests=0;
  try {
    await context.route('**/*',async route=>{
      if(++requests>80||signal.aborted||['media','font','websocket'].includes(route.request().resourceType())){await route.abort();return;}
      try{const target=await publicUrl(route.request().url());
        const response=await pinnedRequest(target,route.request().method(),route.request().headers(),route.request().postDataBuffer(),signal);
        await route.fulfill(response);
      }catch{await route.abort().catch(()=>{});}
    });
    await context.routeWebSocket('**/*',socket=>socket.close());
    const page=await context.newPage();page.setDefaultTimeout(12000);
    const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:20000});
    assert(response&&response.ok(),'WEB_FETCH_FAILED','The website did not return a successful page.',502);
    const completed:ObjectValue[]=[];
    if(interact){
      assert(Array.isArray(input.steps)&&input.steps.length>0&&input.steps.length<=10,'BROWSER_STEPS_INVALID','Provide 1–10 explicit browser steps.');
      for(const raw of input.steps){
        const step=raw as ObjectValue;signal.throwIfAborted();
        const target=page.locator(String(step.selector));
        assert(await target.count()===1,'BROWSER_TARGET_AMBIGUOUS','Each browser selector must match exactly one element.',409);
        const type=await target.getAttribute('type');
        assert(!['password','file'].includes(type??''),'BROWSER_CREDENTIAL_ENTRY_BLOCKED','Connect accounts through the dedicated connection screens; browser tasks do not enter passwords or upload host files.',403);
        if(step.kind==='fill')await target.fill(String(step.value??''));
        else if(step.kind==='click')await target.click();
        else if(step.kind==='select')await target.selectOption(String(step.value??''));
        else if(step.kind==='check')await target.setChecked(step.checked===true);
        else if(step.kind==='wait')await target.waitFor({state:'visible'});
        else throw new OperatorError('BROWSER_STEP_INVALID','Unsupported browser operation.');
        completed.push({kind:step.kind??null,selector:step.selector??null});
      }
      await page.waitForLoadState('domcontentloaded');
      if(typeof input.expectedText==='string'&&input.expectedText)await page.getByText(input.expectedText,{exact:false}).first().waitFor();
    }
    await publicUrl(page.url());signal.throwIfAborted();
    const title=await page.title();
    const text=(await page.locator('body').innerText()).slice(0,24000);
    const links=await page.locator(search?'li.b_algo h2 a':'a[href]').evaluateAll(elements=>elements.map(element=>({title:(element.textContent??'').trim().slice(0,200),url:(element as HTMLAnchorElement).href})).filter(value=>value.title&&value.url.startsWith('http')).slice(0,25));
    const fields=await page.locator('input,select,textarea,button').evaluateAll(elements=>elements.slice(0,40).map(element=>({tag:element.tagName.toLowerCase(),type:element.getAttribute('type')??'',name:element.getAttribute('name')??'',
      label:element.getAttribute('aria-label')??element.getAttribute('placeholder')??element.textContent?.trim().slice(0,100)??'',
      selector:element.id?'#'+CSS.escape(element.id):element.getAttribute('name')?element.tagName.toLowerCase()+'[name="'+CSS.escape(element.getAttribute('name')??'')+'"]':element.tagName.toLowerCase()})));
    if(search)assert(links.length>0,'SEARCH_UNAVAILABLE','The search provider returned no inspectable results; open a known URL instead.',503);
    return {url:page.url(),title,text,links,fields,completedSteps:completed,observedAt:new Date().toISOString(),untrustedContent:true,
      ...(interact?{confirmation:'These are observed browser interactions and page contents, not an independent business-provider receipt.'}:{})};
  }catch(error){if(signal.aborted)throw signal.reason;if(error instanceof OperatorError)throw error;throw new OperatorError('BROWSER_UNAVAILABLE','The isolated browser could not finish the page; try a direct public URL.',502);}
  finally{signal.removeEventListener('abort',abort);await browser.close();}
}
