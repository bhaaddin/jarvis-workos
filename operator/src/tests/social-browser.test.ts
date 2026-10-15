import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {SocialBrowser} from '../social-browser.js';

test('sign-in readiness waits for credentials, verification and the correct origin without returning page text',async()=>{
  const browser=await chromium.launch({headless:true,channel:'chromium'}),context=await browser.newContext();
  try{
    await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<main>SYNTHETIC_PRIVATE_FEED</main>'}));
    const page=await context.newPage(),window={browser,context,page},driver=new SocialBrowser(true);
    await page.goto('https://www.instagram.com/');
    assert.equal((await driver.loginStatus(window,'instagram')).ready,false);
    await context.addCookies([{name:'sessionid',value:'SYNTHETIC_PRIVATE_COOKIE',domain:'.instagram.com',path:'/',secure:true,httpOnly:true}]);
    for(const field of ['<input type="password" value="SYNTHETIC_PRIVATE_PASSWORD">','<input autocomplete="one-time-code" value="SYNTHETIC_PRIVATE_CODE">','<div id="captcha_container">Verification required</div>']){
      await page.setContent('<main>'+field+'</main>');assert.equal((await driver.loginStatus(window,'instagram')).ready,false);
    }
    await page.setContent('<main>SYNTHETIC_PRIVATE_FEED</main>');
    const ready=await driver.loginStatus(window,'instagram');assert.equal(ready.ready,true);assert.equal(ready.signature?.length,64);
    assert(!JSON.stringify(ready).includes('SYNTHETIC_PRIVATE'));
    await page.goto('https://www.instagram.com/challenge/');assert.equal((await driver.loginStatus(window,'instagram')).ready,false);
    await page.goto('https://accounts.google.com/');assert.equal((await driver.loginStatus(window,'instagram')).ready,false);
  }finally{await browser.close();}
});
