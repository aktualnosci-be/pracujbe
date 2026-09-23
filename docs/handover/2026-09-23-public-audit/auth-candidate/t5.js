const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:640,height:800}}); const p=await ctx.newPage();
 for (const l of ['pl','fr']){
 await p.goto(B+'/'+l+'/rejestracja'); await p.waitForLoadState('networkidle');
 await p.evaluate(()=>document.documentElement.style.fontSize='200%'); await p.waitForTimeout(300);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return b.textContent.trim().slice(0,50)+' L'+Math.round(r.left)+' R'+Math.round(r.right)+' sw'+b.scrollWidth+'/cw'+b.clientWidth+' in:'+(b.closest('form')?'form':b.closest('[class*=fixed]')?'fixed':'?')})));
 await p.screenshot({path:`reg-200-${l}.png`,fullPage:false});
 }
 // also 320 + 200%
 const c2=await br.newContext({viewport:{width:320,height:640}}); const q=await c2.newPage();
 await q.goto(B+'/fr/rejestracja'); await q.waitForLoadState('networkidle');
 await q.evaluate(()=>document.documentElement.style.fontSize='200%'); await q.waitForTimeout(300);
 console.log(await q.evaluate(()=>[...document.querySelectorAll('form button, form label, form p')].map(b=>{const r=b.getBoundingClientRect();return b.textContent.trim().slice(0,40)+' R'+Math.round(r.right)+' sw'+b.scrollWidth+'/cw'+b.clientWidth})));
 await br.close();
})();
