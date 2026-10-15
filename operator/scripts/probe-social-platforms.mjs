import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';
import {SocialBrowser} from '../dist/social-browser.js';
import {profileLink} from '../dist/social-model.js';

// Public availability check only: no credentials, saved sessions, private inbox
// or personal browser profile. Logged-in discovery is qualified separately.
const folder=path.join(projectRoot,'logs','social-platforms-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(folder,{recursive:true});
const driver=new SocialBrowser(true),report={mode:'unauthenticated public availability',accountsConnected:false,results:[]};
for(const platform of ['instagram','tiktok']){
  let window;
  try{
    window=await driver.open(platform);
    const query=await driver.discover(window,platform,'fitness Prague',3,AbortSignal.timeout(45000));
    const snapshot=await driver.snapshot(window.page,platform);
    const allLinks=await window.page.locator('a[href]').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().width>0).map(node=>node.href).slice(0,150));
    report.results.push({platform,searchState:query.state,visibleProfileLinks:query.urls.length,allVisibleProfileLinks:allLinks.filter(value=>profileLink(value)?.platform===platform).length,
      pageTitle:snapshot.title,pagePath:new URL(snapshot.url).pathname,loginVisible:snapshot.loginVisible,blockedHosts:[...(window.blockedHosts??[])],publicPagePreview:snapshot.body.slice(0,500)});
  }catch(error){const snapshot=window?await driver.snapshot(window.page,platform).catch(()=>null):null;report.results.push({platform,searchState:'unavailable',code:error.code??error.name,
    ...(snapshot?{pageTitle:snapshot.title,pagePath:new URL(snapshot.url).pathname,loginVisible:snapshot.loginVisible,publicPagePreview:snapshot.body.slice(0,500)}:{})});}
  finally{await window?.browser.close().catch(()=>{});}
}
writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,artifacts:folder},null,2));
