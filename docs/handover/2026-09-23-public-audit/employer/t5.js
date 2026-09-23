const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [w,h] of [[320,568],[320,800],[390,844],[1280,800]]) {
 const ctx=await br.newContext({viewport:{width:w,height:h}}); const p=await ctx.newPage();
 await p.goto(`${B}/pl/rejestracja-pracodawca`); await p.waitForTimeout(500);
 await p.focus('button[type=submit]');
 await p.evaluate(()=>document.activeElement.scrollIntoView({block:'nearest'}));
 const r=await p.evaluate(()=>{const b=document.querySelector('button[type=submit]').getBoundingClientRect();const c=document.querySelector('[aria-labelledby=cookie-banner-title]');const cb=c?.getBoundingClientRect();const d=document.documentElement;return {btn:[Math.round(b.top),Math.round(b.bottom)],banner:cb&&[Math.round(cb.top),Math.round(cb.bottom)],scrollMax:d.scrollHeight-d.clientHeight,scrollY:scrollY,topEl:document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest('[aria-labelledby=cookie-banner-title]')?'BANNER':'btn'}});
 console.log(w,h,JSON.stringify(r));
 await p.evaluate(()=>scrollTo(0,1e6)); await p.waitForTimeout(200);
 console.log('  after max scroll', await p.evaluate(()=>{const b=document.querySelector('button[type=submit]').getBoundingClientRect();return [Math.round(b.top),Math.round(b.bottom), document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest('[aria-labelledby=cookie-banner-title]')?'BANNER':'btn']}));
 await ctx.close();}
 await br.close();
})();
