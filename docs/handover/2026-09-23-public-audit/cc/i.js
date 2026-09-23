const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage({viewport:{width:640,height:800}});
 await pg.goto('http://localhost:3100/nl/praca',{waitUntil:'networkidle'});
 await pg.evaluate(()=>{document.querySelector('[aria-labelledby=cookie-banner-title]')?.remove();document.documentElement.style.fontSize='200%'}); await pg.waitForTimeout(200);
 const r=await pg.evaluate(()=>{const cw=document.documentElement.clientWidth;const o=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const rg=document.createRange();rg.selectNodeContents(n);for(const b of rg.getClientRects()){if(b.right>cw+1){o.push('"'+n.textContent.trim().slice(0,40)+'" r='+Math.round(b.right)+' parent='+n.parentElement.tagName+'.'+(n.parentElement.className+'').slice(0,80));break;}}}
  const sc=[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX!=='visible').map(e=>e.tagName+'.'+(e.className+'').slice(0,40));
  return {sw:document.documentElement.scrollWidth,o:o.slice(0,6),sc};});
 console.log(JSON.stringify(r,null,1));
 await pg.screenshot({path:'hub-200-nl.png',fullPage:false});
 await br.close();
})();
