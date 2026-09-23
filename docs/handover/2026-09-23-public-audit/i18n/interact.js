const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const polish=/[ąćęłńśźżĄĆĘŁŃŚŹŻ]|\b(Szukaj|Oferty|Praca|pracy|Zaloguj|Wyślij|oraz|Pracodawca|Kandydat|Hasło|Imię)\b/;
const rawk=/\b(auth|apply|application|errors|common|jobs|job|filters|cookies|home)\.[a-z][\w.]+/;
async function snap(p,label,l){const t=await p.evaluate(()=>document.body.innerText+'\n'+[...document.querySelectorAll('[aria-label],[placeholder],[title]')].map(e=>(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('placeholder')||'')+' '+(e.getAttribute('title')||'')).join('\n'));
 const lines=[...new Set(t.split('\n').map(s=>s.trim()).filter(Boolean))];
 const bad=lines.filter(s=>(l!=='pl'&&polish.test(s)&&!/Polski|Pracuj\.be/.test(s))||rawk.test(s));
 console.log(l,label,bad.length?'ISSUES '+JSON.stringify(bad.slice(0,8)):'ok');}
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for(const l of ['pl','nl','fr','en']){
  const ctx=await b.newContext();const p=await ctx.newPage();
  await p.goto(`${B}/${l}`);await p.waitForTimeout(1500);await snap(p,'home+cookiebanner',l);
  // cookie settings
  const btns=p.locator('[role=region] button');const n=await btns.count();
  if(n>=2){await btns.nth(n-1).click().catch(()=>{});await p.waitForTimeout(500);await snap(p,'cookie-last-button-click',l);}
  for(const path of ['/logowanie','/rejestracja','/rejestracja-pracodawca','/reset-hasla']){
   await p.goto(`${B}/${l}${path}`);await p.waitForTimeout(800);
   await p.locator('form button[type=submit]').first().click();await p.waitForTimeout(800);
   // bad email
   const em=p.locator('input[type=email]').first(); if(await em.count()){await em.fill('abc');await p.locator('form button[type=submit]').first().click();await p.waitForTimeout(500);}
   await snap(p,path+' submit-invalid',l);
  }
  await p.goto(`${B}/${l}/oferty-pracy/fruit-picker-hasselt-1011`);await p.waitForTimeout(1000);
  const apply=p.getByRole('button').filter({hasText:/./}).locator('text=/aplikuj|solliciteer|postuler|apply/i').first();
  if(await apply.count()){await apply.click().catch(e=>console.log('applyclick',e.message.slice(0,80)));await p.waitForTimeout(800);await snap(p,'apply-modal',l);}else console.log(l,'no apply button found');
  await p.setViewportSize({width:390,height:800});await p.goto(`${B}/${l}/oferty-pracy?keyword=zzzqqq`);await p.waitForTimeout(800);await snap(p,'empty-results-mobile',l);
  await ctx.close();
 }
 await b.close();
})();
