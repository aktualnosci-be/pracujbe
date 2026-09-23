const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const pg=await br.newPage();
for (const s of ['praca-w-belgii-bez-znajomosci-jezyka','umowa-interim-co-warto-wiedziec','numer-niss-i-podatki']) { const row=[s];
 for (const l of ['pl','nl','fr','en']) { await pg.goto(`http://localhost:3100/${l}/poradniki/${s}`); row.push(l+':'+await pg.evaluate(()=>{const a=document.querySelector('article');return a.innerText.split(/\s+/).length+'w/'+a.querySelectorAll('h2').length+'h2'}));}
 console.log(row.join(' '));}
await br.close();})();
