const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const u of ['/nl/praca','/nl/praca/miasto/ghent','/nl/oferty-pracy','/nl']) {
 const pg=await br.newPage({viewport:{width:640,height:800}});
 await pg.goto('http://localhost:3100'+u,{waitUntil:'networkidle'});
 await pg.evaluate(()=>document.documentElement.style.fontSize='200%'); await pg.waitForTimeout(200);
 const r=await pg.evaluate(()=>{const cw=document.documentElement.clientWidth;const o=[];document.querySelectorAll('body *').forEach(e=>{const b=e.getBoundingClientRect();if(b.width&&b.right>cw+1){o.push(e.tagName+'.'+(e.className+'').slice(0,60)+' "'+e.textContent.trim().slice(0,30)+'" r='+Math.round(b.right)+' in:'+(e.closest('main')?'main':e.closest('header')?'header':e.closest('footer')?'footer':'?'))}});return {sw:document.documentElement.scrollWidth,o:o.slice(0,8)}});
 console.log(u,JSON.stringify(r,null,1));
 if(u==='/nl/praca') await pg.screenshot({path:'hub-200.png'});
 }
 await br.close();
})();
