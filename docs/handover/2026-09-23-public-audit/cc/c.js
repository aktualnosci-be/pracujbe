const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage({viewport:{width:1280,height:900}});
 await pg.goto(B+'/pl/praca/miasto/brussels?x=1');
 // find language switcher
 const sw=await pg.$$eval('header a[hreflang], header [lang], header a', as=>as.filter(a=>/\/(pl|nl|fr|en)(\/|$)/.test(a.getAttribute('href')||'')).map(a=>a.textContent.trim()+'=>'+a.getAttribute('href')).slice(0,40));
 console.log(sw);
 const btns=await pg.$$eval('header button', bs=>bs.map(b=>(b.getAttribute('aria-label')||b.textContent.trim())));
 console.log(btns);
 await br.close();
})();
