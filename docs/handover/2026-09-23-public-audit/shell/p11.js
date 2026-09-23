const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await br.newPage({viewport:{width:320,height:640}});
await p.goto('http://localhost:3100/offline.html');const r=await p.evaluate(()=>{const b=document.querySelector('button').getBoundingClientRect();return [b.width,b.height,getComputedStyle(document.querySelector('.logo')).backgroundColor]});console.log(r);await p.screenshot({path:'offline-static.png'});await br.close();})();
