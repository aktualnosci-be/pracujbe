const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await (await br.newContext({viewport:{width:375,height:740}})).newPage();
 for (const u of ['/pl/oferty-pracy/nie-istnieje-xyz','/nl/oferty-pracy/nie-istnieje-xyz','/fr/oferty-pracy/nie-istnieje-xyz','/en/oferty-pracy/nie-istnieje-xyz','/pl/oferty-pracy/bricklayer-brussels-9999','/pl/oferty-pracy/%E2%80%8B','/pl/oferty-pracy/'+'a'.repeat(3000)]) {
  const r=await p.goto(B+u,{waitUntil:'networkidle'}).catch(e=>null);
  if(!r){console.log(u.slice(0,60),'ERR');continue;}
  const info=await p.evaluate(()=>({lang:document.documentElement.lang,title:document.title,robots:document.querySelector('meta[name=robots]')?.content,h1:document.querySelector('h1')?.textContent,txt:document.body.innerText.slice(0,200).replace(/\n/g,' | '),links:[...document.querySelectorAll('main a')].map(a=>a.getAttribute('href')).slice(0,5)}));
  console.log(u.slice(0,60),r.status(),r.headers()['x-robots-tag'],JSON.stringify(info));
 }
 await p.goto(B+'/fr/oferty-pracy/nie-istnieje-xyz'); await p.screenshot({path:'404-fr.png'});
 await br.close();
})();
