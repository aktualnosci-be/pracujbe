const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B=process.env.B||'http://localhost:3207';
const act=p=>p.evaluate(()=>{const e=document.activeElement;return e?(e.tagName+'|'+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,30))+'|'+(e.closest('footer.border-t')?'footer':e.closest('header')?'header':'')):null});
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await br.newPage({viewport:{width:1280,height:800}});await p.goto(B+'/pl/oferty-pracy?q=kierowca');await p.waitForTimeout(800);
const cb=p.locator('footer.border-t [role=combobox]');await cb.focus();await p.keyboard.press('Enter');await p.keyboard.press('End');await p.keyboard.press('Enter');
for(const ms of [50,300,2500]){await p.waitForTimeout(ms);console.log('desktop',ms,p.url(),await act(p));}
const m=await br.newPage({viewport:{width:320,height:640}});await m.goto(B+'/nl/oferty-pracy?q=x');await m.waitForTimeout(800);
await m.locator('header button[aria-haspopup=dialog]').click();await m.waitForTimeout(300);
await m.locator('[role=dialog] [role=combobox]').focus();await m.keyboard.press('Enter');await m.keyboard.press('Home');await m.keyboard.press('Enter');
for(const ms of [50,300,2500]){await m.waitForTimeout(ms);console.log('mobile',ms,m.url(),'dialog',await m.locator('[role=dialog]').count(),await act(m));}
await br.close();})();
