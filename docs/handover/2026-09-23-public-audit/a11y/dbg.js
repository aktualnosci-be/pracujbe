const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await br.newPage({viewport:{width:320,height:568}});
await p.goto('http://localhost:3208/pl/rejestracja-pracodawca');await p.waitForTimeout(1000);
await p.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await p.waitForTimeout(200);
console.log(await p.evaluate(()=>{const b=document.querySelector('[aria-labelledby="cookie-banner-title"]').getBoundingClientRect();const s=document.querySelector('form button[type="submit"]');const r=s.getBoundingClientRect();const h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
return {var:document.documentElement.style.getPropertyValue('--cookie-banner-h'),pb:getComputedStyle(document.body).paddingBottom,sh:document.documentElement.scrollHeight,bh:document.body.scrollHeight,y:scrollY,banner:[b.top,b.bottom],submit:[r.top,r.bottom,s.textContent],hit:h?h.outerHTML.slice(0,100):null,bodyH:document.body.getBoundingClientRect().height,minh:getComputedStyle(document.body).minHeight,wrap:[...document.body.children].map(c=>c.tagName+'.'+String(c.className).slice(0,40)+':'+Math.round(c.getBoundingClientRect().height))}}));
await br.close()})();
