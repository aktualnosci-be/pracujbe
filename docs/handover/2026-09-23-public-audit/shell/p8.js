const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:800}});const p=await ctx.newPage();
 await p.goto(B+'/pl/oferty-pracy');await p.waitForTimeout(800);
 await p.evaluate(()=>document.cookie='x=1');
 const out=[];
 for(let i=0;i<8;i++){await p.keyboard.press('Tab');out.push(await p.evaluate(()=>{const e=document.activeElement;const cs=getComputedStyle(e);return (e.textContent.trim().slice(0,20)||e.getAttribute('aria-label'))+' outline:'+cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor+' shadow:'+(cs.boxShadow!=='none')+' current:'+e.getAttribute('aria-current')}))}
 console.log(out.join('\n'));
 // footer links focus
 await p.locator('footer a').first().focus();
 const fl=await p.evaluate(()=>[...document.querySelectorAll('footer a, footer button')].map(e=>{const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return (e.textContent.trim().slice(0,18)||e.getAttribute('aria-label'))+' '+Math.round(r.width)+'x'+Math.round(r.height)}));
 console.log(fl);
 await p.locator('footer a[href$="/o-nas"]').focus();await p.keyboard.press('Shift+Tab');await p.keyboard.press('Tab');
 await p.locator('footer').screenshot({path:'footer-focus.png'});
 console.log(await p.evaluate(()=>{const e=document.activeElement;const cs=getComputedStyle(e);return [cs.outlineStyle,cs.outlineWidth,cs.outlineColor,cs.boxShadow]}));
 await br.close();
})();
