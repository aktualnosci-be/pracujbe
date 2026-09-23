const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const w of [320,768,1024,1280]){const p=await br.newPage({viewport:{width:w,height:800}});await p.goto('http://localhost:3207/fr/oferty-pracy');console.log(w,await p.evaluate(()=>Math.round(document.querySelector('header').getBoundingClientRect().height)));await p.evaluate(()=>document.documentElement.style.fontSize='200%');console.log(' 200%',await p.evaluate(()=>Math.round(document.querySelector('header').getBoundingClientRect().height)));await p.close();}
await br.close();})();
