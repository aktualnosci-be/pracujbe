const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const act=p=>p.evaluate(()=>{const e=document.activeElement;return e?(e.tagName+'|'+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,30))):null});
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:800}});
 const p=await ctx.newPage();
 await p.goto(B+'/pl/oferty-pracy?q=kierowca&sort=newest#x');
 await p.waitForTimeout(800);
 const cb=p.locator('footer [role=combobox]');
 await cb.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
 await p.keyboard.press('End'); await p.keyboard.press('Enter');
 await p.waitForTimeout(2500);
 console.log('url',p.url(),'lang',await p.evaluate(()=>document.documentElement.lang),'focus',await act(p),'title',await p.title());
 const q=await p.evaluate(()=>document.querySelector('input[name=q], input[type=search]')?.value);
 console.log('search input value',q);
 // mobile keyboard in panel
 const ctx2=await br.newContext({viewport:{width:320,height:640}});
 const m=await ctx2.newPage();
 await m.goto(B+'/nl/oferty-pracy?q=chauffeur');await m.waitForTimeout(800);
 await m.locator('header button[aria-haspopup=dialog]').click();await m.waitForTimeout(300);
 await m.locator('[role=dialog] [role=combobox]').focus(); await m.keyboard.press('Enter'); await m.keyboard.press('Home'); await m.keyboard.press('Enter');
 await m.waitForTimeout(2500);
 console.log('mobile url',m.url(),'dialog open',await m.locator('[role=dialog]').count(),'focus',await act(m));
 await br.close();
})();
