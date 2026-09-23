const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:800}}); const p=await ctx.newPage();
 await p.goto(`${B}/pl/rejestracja-pracodawca`);
 let n=0; await p.route('**/*', async r=>{ if(r.request().method()==='POST'){n++; await new Promise(x=>setTimeout(x,1500));} r.continue(); });
 await p.fill('#companyName','ACME BV'); await p.fill('#firstName','Jan'); await p.fill('#lastName','Nowak');
 await p.fill('#email','jan@example.com'); await p.fill('#password','abcdefg1'); await p.fill('#passwordConfirm','abcdefg1');
 await p.click('#agreeTerms');
 await p.click('button[type=submit]'); await p.waitForTimeout(200);
 console.log('disabled', await p.$eval('button[type=submit]',b=>[b.disabled,b.textContent]));
 await p.click('button[type=submit]',{force:true,timeout:500}).catch(()=>{});
 await p.keyboard.press('Enter');
 await p.waitForTimeout(3500); console.log('posts',n);
 // values preserved after error?
 console.log(await p.evaluate(()=>['companyName','email','password'].map(i=>document.getElementById(i).value)));
 console.log('focus after err', await p.evaluate(()=>document.activeElement.tagName+'#'+document.activeElement.id));
 await br.close();
})();
