const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage({viewport:{width:1280,height:900}});
 for (const u of ['/pl/poradniki/umowa-interim-co-warto-wiedziec','/pl/poradniki']) {
 await pg.goto(B+u,{waitUntil:'networkidle'}); const nb=pg.locator('[aria-labelledby=cookie-banner-title] button').first(); if(await nb.isVisible().catch(()=>false)) {await nb.click(); await pg.waitForTimeout(300);}
 for (const [lab,re] of [['Nederlands',/\/nl\//],['Français',/\/fr\//]]) {
 await pg.getByRole('combobox',{name:/język|taal|lang/i}).click(); await pg.getByRole('option',{name:lab}).click();
 await pg.waitForURL(re); await pg.waitForTimeout(2500);
 console.log(u,'->',pg.url(),JSON.stringify(await pg.evaluate(()=>[document.documentElement.lang,document.title,document.querySelector('link[rel=canonical]')?.href,document.querySelector('meta[name=description]')?.content?.slice(0,40)])));
 }}
 await br.close();
})();
