const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage({viewport:{width:768,height:800}});
 await pg.goto('http://localhost:3100/pl/praca/miasto/antwerp',{waitUntil:'networkidle'});
 await pg.evaluate(()=>{document.querySelector('[aria-labelledby=cookie-banner-title]')?.remove();document.documentElement.style.fontSize='200%'}); await pg.waitForTimeout(150);
 const r=await pg.evaluate(()=>{const cw=768;const o=[];document.querySelectorAll('body *').forEach(e=>{const b=e.getBoundingClientRect();if(b.width&&b.right>cw+1&&!(e.parentElement&&e.parentElement.getBoundingClientRect().right>cw+1))o.push(e.tagName+'.'+(e.className+'').slice(0,70)+' "'+e.textContent.trim().slice(0,30)+'" r='+Math.round(b.right)+' '+(e.closest('header')?'header':e.closest('footer')?'footer':e.closest('main')?'main':'?'))});return o.slice(0,6)});
 console.log(r.join('\n'));
 await br.close();
})();
