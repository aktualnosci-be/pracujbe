const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const { AxeBuilder } = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
const B='http://localhost:3100';
const act=async p=>p.evaluate(()=>{const e=document.activeElement;return e?(e.tagName+'#'+e.id+'['+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,40))+'] inDialog='+!!e.closest('[role=dialog]')):'none'});
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:900}});
 const p=await ctx.newPage();
 const reqs=[];p.on('request',r=>{if(r.method()==='POST')reqs.push(r.url())});
 await p.goto(`${B}/pl/oferty-pracy/bricklayer-brussels-1002`,{waitUntil:'networkidle'});
 await p.getByRole('button',{name:'Akceptuj wszystkie'}).click().catch(()=>{});
 const trig=p.locator('button:visible',{hasText:'Aplikuj teraz'}).first();
 await trig.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
 console.log('initial focus:',await act(p));
 const seq=[];for(let i=0;i<14;i++){await p.keyboard.press('Tab');seq.push(await act(p));}
 console.log('TAB SEQ\n'+seq.join('\n'));
 const ax=await new AxeBuilder({page:p}).include('[role=dialog]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 ax.violations.forEach(v=>console.log('AXE',v.id,v.impact,v.nodes.map(n=>n.target.join(' ')+' '+n.failureSummary.slice(0,150).replace(/\n/g,' '))));
 // names
 console.log(await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] button,[role=dialog] input,[role=dialog] textarea,[role=dialog] [role=combobox]')].map(e=>e.tagName+' id='+e.id+' role='+e.getAttribute('role')+' aria-label='+e.getAttribute('aria-label')+' labelledby='+e.getAttribute('aria-labelledby')).join('\n')));
 // submit empty
 await p.locator('[role=dialog] button[type=submit]').click(); await p.waitForTimeout(400);
 console.log('after empty submit focus:',await act(p));
 console.log(await p.evaluate(()=>{const c=document.querySelector('#apply-consent');const ph=document.querySelector('#apply-phone');return {phoneInv:ph.getAttribute('aria-invalid'),phoneDesc:ph.getAttribute('aria-describedby'),consInv:c.getAttribute('aria-invalid'),consDesc:c.getAttribute('aria-describedby'),errs:[...document.querySelectorAll('[role=dialog] .text-error')].map(e=>e.textContent)}}));
 // fill and submit double click
 await p.fill('#apply-phone','470123456'); await p.click('#apply-consent');
 reqs.length=0;
 const sb=p.locator('[role=dialog] button[type=submit]');
 await sb.dblclick();
 await p.waitForTimeout(200); console.log('submit disabled during?', await sb.isDisabled().catch(()=>'gone'), await sb.textContent().catch(()=>''));
 await p.waitForTimeout(2500);
 console.log('POSTs',reqs.length);
 console.log('dialog open?',await p.locator('[role=dialog]').count());
 console.log('alert:',await p.locator('[role=dialog] [role=alert]').textContent().catch(()=>null));
 console.log('status:',await p.locator('[role=status]').allTextContents());
 console.log('focus after:',await act(p));
 await p.screenshot({path:'modal-after.png'});
 await p.keyboard.press('Escape'); await p.waitForTimeout(400);
 console.log('after Esc dialog?',await p.locator('[role=dialog]').count(),'focus:',await act(p));
 await br.close();
})();
