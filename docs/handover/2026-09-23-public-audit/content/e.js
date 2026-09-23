const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage({viewport:{width:1280,height:900}});
 for (const u of ['/pl/poradniki/umowa-interim-co-warto-wiedziec','/pl/faq','/pl/poradniki/xyz']) {
 await pg.goto(B+u,{waitUntil:'networkidle'}); const nb=pg.locator('[aria-labelledby=cookie-banner-title] button').first(); if(await nb.isVisible().catch(()=>false)) {await nb.click(); await pg.waitForTimeout(300);}
 const sw=pg.getByRole('combobox',{name:/język|lang/i});
 console.log(u,'switcher',await sw.count());
 if(!await sw.count()) continue;
 await sw.click(); await pg.getByRole('option',{name:/Nederlands/}).click();
 await pg.waitForURL(/\/nl\//); await pg.waitForLoadState('networkidle');
 console.log(' ->',pg.url(),await pg.evaluate(()=>document.documentElement.lang+' | '+document.querySelector('h1').textContent+' | '+document.title));
 }
 // Rendered HTML check of legal page: date & intro
 await pg.goto(B+'/nl/regulamin'); console.log(await pg.locator('article').innerText());
 await br.close();
})();
