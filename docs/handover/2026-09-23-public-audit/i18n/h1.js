const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();
for(const l of ['pl','en'])for(const x of ['candidate','employer','admin']){await p.goto(`http://localhost:3100/${l}/${x}`);
console.log(l,x,JSON.stringify(await p.evaluate(()=>({h1:[...document.querySelectorAll('h1')].map(e=>e.innerText),nav:[...document.querySelectorAll('nav')].map(n=>n.getAttribute('aria-label')),main:document.querySelectorAll('main').length}))));}
await b.close();})();
