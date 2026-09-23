const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await (await br.newContext({viewport:{width:1280,height:900}})).newPage();
 await p.goto(`${B}/pl/oferty-pracy/bricklayer-brussels-1002`,{waitUntil:'networkidle'});
 await p.getByRole('button',{name:'Akceptuj wszystkie'}).click();
 const seq=[];
 for(let i=0;i<20;i++){await p.keyboard.press('Tab');seq.push(await p.evaluate(()=>{const e=document.activeElement;const cs=getComputedStyle(e);return e.tagName+'['+e.textContent.trim().slice(0,30)+'] outline='+cs.outlineStyle+'/'+cs.outlineWidth+' shadow='+(cs.boxShadow!=='none')}));
   if(seq[seq.length-1].startsWith('SUMMARY')){ await p.keyboard.press('Enter'); const open=await p.evaluate(()=>document.activeElement.parentElement.open); seq.push('  -> after Enter open='+open); break;}}
 console.log(seq.join('\n'));
 await p.screenshot({path:'desk-collapsed.png'});
 const snap=await p.locator('main').ariaSnapshot();
 console.log(snap.split('\n').filter(l=>/heading|group|button "Zakres|Wymagania/.test(l)).slice(0,20).join('\n'));
 await br.close();
})();
