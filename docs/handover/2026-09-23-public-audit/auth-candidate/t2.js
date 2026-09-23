const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const state=async p=>p.evaluate(()=>({active:document.activeElement?.id||document.activeElement?.tagName,
 fields:[...document.querySelectorAll('input[id],button[role=checkbox]')].map(i=>({id:i.id,inv:i.getAttribute('aria-invalid'),db:i.getAttribute('aria-describedby'),
   err:(document.getElementById(i.id+'-error')||{}).textContent})),
 alert:[...document.querySelectorAll('[role=alert],[role=status]')].map(a=>a.getAttribute('role')+':'+a.textContent.trim()).filter(x=>x.length>6),
 btn:[...document.querySelectorAll('button[type=submit]')].map(b=>b.textContent+(b.disabled?'[disabled]':''))}));
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:900}});
 const p=await ctx.newPage();
 const reqs=[]; p.on('request',r=>{if(r.method()==='POST')reqs.push(r.url())});
 // empty submit register
 await p.goto(B+'/pl/rejestracja'); await p.waitForLoadState('networkidle');
 await p.click('button[type=submit]'); await p.waitForTimeout(400);
 console.log('REG empty',JSON.stringify(await state(p)));
 // bad values
 await p.fill('#firstName','A'); await p.fill('#lastName','Kowalski'); await p.fill('#email','jan@'); await p.fill('#password','abc'); await p.fill('#passwordConfirm','abd');
 await p.click('button[type=submit]'); await p.waitForTimeout(400);
 console.log('REG bad',JSON.stringify(await state(p)));
 // fix fields - check errors live update?
 await p.fill('#firstName','Jan'); await p.waitForTimeout(300);
 console.log('REG after fix firstName (no submit)',JSON.stringify((await state(p)).fields[0]));
 // valid, demo submit, double click
 await p.fill('#email','jan.kowalski@example.com'); await p.fill('#password','Haslo1234'); await p.fill('#passwordConfirm','Haslo1234');
 await p.click('#agreeTerms');
 reqs.length=0;
 await p.click('button[type=submit]'); 
 try{ await p.click('button[type=submit]',{timeout:300}); }catch(e){console.log('second click blocked')}
 await p.waitForTimeout(2500);
 console.log('REG demo submit posts',reqs.length,JSON.stringify(await state(p)), p.url());
 await p.screenshot({path:'reg-demo.png',fullPage:true});
 // login
 await p.goto(B+'/pl/logowanie'); await p.waitForLoadState('networkidle');
 await p.click('button[type=submit]'); await p.waitForTimeout(300);
 console.log('LOGIN empty',JSON.stringify(await state(p)));
 await p.fill('#email','zly e-mail'); await p.fill('#password','x'); await p.click('button[type=submit]'); await p.waitForTimeout(300);
 console.log('LOGIN bad email',JSON.stringify(await state(p)));
 await p.fill('#email','jan@example.com'); reqs.length=0; await p.click('button[type=submit]'); await p.waitForTimeout(2500);
 console.log('LOGIN demo',reqs.length,JSON.stringify(await state(p)));
 await p.screenshot({path:'login-demo.png',fullPage:true});
 // reset
 await p.goto(B+'/pl/reset-hasla'); await p.waitForLoadState('networkidle');
 await p.click('button[type=submit]'); await p.waitForTimeout(300);
 console.log('RESET empty',JSON.stringify(await state(p)));
 await p.fill('#email','jan@example.com'); await p.click('button[type=submit]'); await p.waitForTimeout(2500);
 console.log('RESET demo',JSON.stringify(await state(p)));
 // new pw
 await p.goto(B+'/pl/ustaw-nowe-haslo'); await p.waitForLoadState('networkidle');
 await p.click('button[type=submit]'); await p.waitForTimeout(300);
 console.log('NEWPW empty',JSON.stringify(await state(p)));
 await p.fill('#password','Haslo1234'); await p.fill('#passwordConfirm','Haslo1234'); await p.click('button[type=submit]'); await p.waitForTimeout(2500);
 console.log('NEWPW demo',JSON.stringify(await state(p)));
 await br.close();
})();
