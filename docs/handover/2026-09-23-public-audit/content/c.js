const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage({viewport:{width:320,height:800}});
 await pg.goto(B+'/nl/regulamin',{waitUntil:'networkidle'});
 await pg.evaluate(()=>document.documentElement.style.fontSize='200%');
 console.log(await pg.evaluate(()=>{const cw=320;return [...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>cw+1&&[...e.children].every(c=>c.getBoundingClientRect().right<=cw+1)).slice(0,8).map(e=>e.tagName+'['+String(e.className).slice(0,60)+']:'+e.textContent.trim().slice(0,30)+' r='+Math.round(e.getBoundingClientRect().right)+' in '+(e.closest('header')?'header':e.closest('footer')?'footer':'other'))}));
 // 640 200% guide card screenshot
 await pg.setViewportSize({width:640,height:900});
 await pg.goto(B+'/nl/poradniki',{waitUntil:'networkidle'});
 await pg.evaluate(()=>document.documentElement.style.fontSize='200%');
 const el=pg.locator('article',{hasText:'Rijksregisternummer'}).first(); await el.scrollIntoViewIfNeeded(); await el.screenshot({path:'nl-card-640-200.png'});
 // 404
 await pg.setViewportSize({width:1280,height:800});
 await pg.goto(B+'/fr/poradniki/xyz',{waitUntil:'networkidle'}); await pg.screenshot({path:'404-fr.png'});
 console.log('404 links',await pg.evaluate(()=>[...document.querySelectorAll('a,button')].map(a=>a.textContent.trim()+'->'+a.getAttribute('href'))));
 await br.close();
})();
