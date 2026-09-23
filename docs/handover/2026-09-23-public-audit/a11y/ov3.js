const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const R=['','/oferty-pracy','/oferty-pracy/warehouse-worker-antwerp-1001','/praca','/praca/kategoria/construction','/praca/miasto/antwerp','/poradniki','/poradniki/numer-niss-i-podatki','/o-nas','/faq','/kontakt','/pomoc','/regulamin','/polityka-prywatnosci','/polityka-cookies','/logowanie','/rejestracja','/rejestracja-pracodawca','/reset-hasla','/offline'];
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const l of ['pl','nl','fr','en'])for(const r of R)for(const w of [1280,768]){const p=await br.newPage({viewport:{width:w,height:800}});await p.goto(`http://localhost:3100/${l}${r}`);await p.waitForTimeout(500);
 const b=p.locator('[aria-labelledby="cookie-banner-title"] button').first();if(await b.count()){await b.click();await p.waitForTimeout(200)}
 await p.evaluate(()=>document.documentElement.style.fontSize='200%');await p.waitForTimeout(200);
 const sw=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);if(sw>0)console.log(w,l+r,sw);await p.close()}
await br.close()})();
