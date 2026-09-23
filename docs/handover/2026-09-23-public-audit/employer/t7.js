const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100'; const {dismiss}=require('./common');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:800}}); const p=await ctx.newPage();
 await p.goto(`${B}/nl`); await dismiss(p);
 await p.locator('a[href="/nl/dla-pracodawcow"]').last().click(); await p.waitForURL(/dla-pracodawcow/); await p.waitForTimeout(1500);
 console.log(p.url(), await p.title(), await p.evaluate(()=>document.body.innerText.slice(0,400)+' | lang='+document.documentElement.lang+' h1='+document.querySelector('h1')?.textContent));
 await p.screenshot({path:'cta404-nl.png'});
 await br.close();
})();
