const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await (await br.newContext({viewport:{width:1280,height:900}})).newPage();
 await p.goto('http://localhost:3100/pl/oferty-pracy/bricklayer-brussels-1002#firma',{waitUntil:'networkidle'});
 await p.getByRole('button',{name:'Akceptuj wszystkie'}).click();
 await p.getByRole('button',{name:'Język'}).click(); await p.waitForTimeout(300);
 const opts=await p.locator('[role=menuitem],[role=option],[role=menuitemradio]').allTextContents(); console.log(opts);
 await p.locator('[role=menuitem],[role=option],[role=menuitemradio]').filter({hasText:/Nederlands/}).first().click();
 await p.waitForURL(/\/nl\//,{timeout:5000}).catch(()=>{}); await p.waitForTimeout(800);
 console.log(p.url(), await p.getAttribute('html','lang'), await p.locator('h1').textContent());
 await br.close();
})();
