const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
 const p = await b.newPage();
 for (const l of ['pl','nl','fr','en']) for (const panel of ['candidate','employer','admin','dashboard']) {
   const r = await p.goto(`http://localhost:3100/${l}/${panel}`, {waitUntil:'domcontentloaded'});
   const chain=[]; let q=r.request(); while(q.redirectedFrom()){q=q.redirectedFrom(); chain.push(q.url());}
   const meta = await p.locator('meta[name="robots"]').evaluateAll(e=>e.map(x=>x.content));
   const h = await p.locator('h1,h2').first().textContent().catch(()=>null);
   console.log(l,panel,r.status(),'final=',p.url().replace('http://localhost:3100',''),'redirFrom=',chain.length,'xrobots=',r.headers()['x-robots-tag'],'meta=',JSON.stringify(meta),'h=',(h||'').trim().slice(0,50), 'lang=', await p.getAttribute('html','lang'));
 }
 await b.close();
})();
