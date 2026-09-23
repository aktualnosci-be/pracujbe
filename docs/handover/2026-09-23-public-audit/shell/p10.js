const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const act=p=>p.evaluate(()=>{const e=document.activeElement;return e?(e.tagName+'|'+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,30))):null});
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await br.newPage({viewport:{width:1280,height:800}});
 await p.goto('http://localhost:3100/pl');await p.waitForTimeout(1000);
 const b=p.locator('[aria-labelledby=cookie-banner-title] button').first();console.log(await b.textContent());
 await b.focus();await p.keyboard.press('Enter');await p.waitForTimeout(300);console.log('after banner choice',await act(p));
 const fb=p.locator('body > div footer, footer.border-t').locator('button',{hasText:/cookie/i});console.log('cnt',await fb.count());
 await fb.first().focus();await p.keyboard.press('Enter');await p.waitForTimeout(400);console.log('dialog open focus',await act(p));
 await p.keyboard.press('Escape');await p.waitForTimeout(400);console.log('after esc',await act(p));
 await fb.first().focus();await p.keyboard.press('Enter');await p.waitForTimeout(400);
 await p.getByRole('button',{name:'Zapisz ustawienia'}).click();await p.waitForTimeout(400);console.log('after save',await act(p));
 await br.close();
})();
