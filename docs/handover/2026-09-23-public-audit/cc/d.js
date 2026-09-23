const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage({viewport:{width:1280,height:900}});
 for (const start of ['/pl/praca/miasto/brussels','/pl/praca/kategoria/care','/nl/praca']) {
  await pg.goto(B+start,{waitUntil:'networkidle'}); const rej=pg.locator('[aria-labelledby=cookie-banner-title] button').first(); if(await rej.count()) { await rej.click(); await pg.waitForTimeout(300);} 
  const trig=pg.locator('footer [role=combobox]');
  for (const target of ['Français','English']) {
   await trig.click(); await pg.getByRole('option',{name:target}).click();
   await pg.waitForFunction(()=>true); await pg.waitForTimeout(1500);
   const s=await pg.evaluate(()=>({u:location.pathname,lang:document.documentElement.lang,h1:document.querySelector('h1')?.textContent,bc:document.querySelector('nav[aria-label] ol')?.innerText.replace(/\n/g,' ')}));
   console.log(start,'->',target,JSON.stringify(s));
  }
 }
 // city "see all" link in nl
 await pg.goto(B+'/nl/praca/miasto/antwerp');
 const href=await pg.locator('main a:has-text("Antwerpen")').filter({hasText:/alle|Bekijk/i}).first().getAttribute('href').catch(()=>null);
 console.log('seeAll nl', href);
 const all=await pg.$$eval('main a',as=>as.map(a=>a.getAttribute('href')).filter(h=>h.includes('oferty-pracy')));
 console.log(all);
 await pg.goto(B+all.find(h=>h.includes('city')),{waitUntil:'networkidle'});
 console.log('list count', await pg.locator('h1').textContent(), (await pg.locator('main').innerText()).match(/\d+ vacature[s]?/)?.[0]);
 await br.close();
})();
