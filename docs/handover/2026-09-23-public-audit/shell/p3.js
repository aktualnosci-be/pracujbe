const { chromium, devices } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const vp of [{width:320,height:640},{width:390,height:844}]) {
 const ctx=await br.newContext({viewport:vp,hasTouch:true,isMobile:true});
 const p=await ctx.newPage();
 await p.goto(B+'/pl/oferty-pracy?q=kierowca');
 await p.waitForTimeout(800);
 await p.locator('header button[aria-haspopup=dialog]').tap(); await p.waitForTimeout(400);
 const cb=p.locator('[role=dialog] [role=combobox]');
 await cb.tap(); await p.waitForTimeout(300);
 const r=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');const lb=d.querySelector('[role=listbox]');return {vh:innerHeight,dialog:[d.scrollHeight,d.clientHeight,getComputedStyle(d).overflowY],opts:[...lb.querySelectorAll('[role=option]')].map(o=>o.textContent+':'+Math.round(o.getBoundingClientRect().top)+'-'+Math.round(o.getBoundingClientRect().bottom))}});
 console.log(JSON.stringify(vp),JSON.stringify(r));
 await p.screenshot({path:`mnav-select-${vp.width}.png`});
 // try swipe scroll dialog
 await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');d.scrollTop=500;});
 console.log('scrollTop after',await p.evaluate(()=>document.querySelector('[role=dialog]').scrollTop));
 await ctx.close();
 }
 await br.close();
})();
