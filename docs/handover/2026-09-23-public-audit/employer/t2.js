const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:800}}); const p=await ctx.newPage();
 await p.goto(`${B}/pl/rejestracja-pracodawca`);
 await p.fill('#companyName','ACME BV'); await p.fill('#firstName','Jan'); await p.fill('#lastName','Nowak');
 await p.fill('#email','jan@example.com'); await p.fill('#password','abcdefg1'); await p.fill('#passwordConfirm','abcdefg1');
 await p.click('#agreeTerms');
 const reqs=[]; p.on('request',r=>{ if(r.method()==='POST') reqs.push(r.url())});
 await p.click('button[type=submit]'); await p.click('button[type=submit]').catch(e=>console.log('2nd click err',e.message.slice(0,60)));
 await p.waitForTimeout(3000);
 console.log('url',p.url(),'posts',reqs.length);
 console.log(await p.evaluate(()=>({alert:document.querySelector('[role=alert]')?.textContent, main:document.querySelector('main')?.innerText.slice(0,300)})));
 // mismatch + bad email
 await p.goto(`${B}/pl/rejestracja-pracodawca`);
 await p.fill('#companyName','A'); await p.fill('#firstName','  '); await p.fill('#email','jan@'); await p.fill('#password','abcdefgh'); await p.fill('#passwordConfirm','x');
 await p.click('button[type=submit]'); await p.waitForTimeout(400);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('p[id$=-error]')].map(e=>e.id+'='+e.textContent)));
 // fix one field -> revalidate?
 await p.fill('#companyName','ACME'); await p.waitForTimeout(300);
 console.log('after fix', await p.evaluate(()=>document.querySelector('#companyName-error')?.textContent||'gone'));
 await br.close();
})();
