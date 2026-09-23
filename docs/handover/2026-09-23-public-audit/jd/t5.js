const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:375,height:740}});
 const p=await ctx.newPage();
 await p.goto(`${B}/pl/oferty-pracy/bricklayer-brussels-1002`,{waitUntil:'networkidle'});
 const cb=p.getByRole('button',{name:'Akceptuj wszystkie'}); if(await cb.count()) await cb.click();
 await p.waitForTimeout(300);
 // tab through, record elements whose focus rect is obscured by the fixed bar
 const obs=[];
 for(let i=0;i<80;i++){await p.keyboard.press('Tab');
  const r=await p.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const bar=[...document.querySelectorAll('div.fixed.inset-x-0.bottom-0')][0];if(bar&&bar.contains(e))return null;const a=e.getBoundingClientRect(),b=bar.getBoundingClientRect();const hidden=a.top>=b.top-1;const partial=a.bottom>b.top;return (hidden||partial)?(hidden?'FULL ':'PART ')+e.tagName+'['+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,30))+'] top='+Math.round(a.top)+' barTop='+Math.round(b.top):null});
  if(r)obs.push(r);}
 console.log(obs.join('\n'));
 await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await p.waitForTimeout(300);
 await p.screenshot({path:'bottom-375.png'});
 console.log(await p.evaluate(()=>{const bar=document.querySelector('div.fixed.inset-x-0.bottom-0').getBoundingClientRect();return [...document.querySelectorAll('footer a, footer button, footer p')].filter(e=>e.getBoundingClientRect().bottom>bar.top).map(e=>e.textContent.trim().slice(0,40)+' '+Math.round(e.getBoundingClientRect().top)+'/'+Math.round(bar.top))}));
 await br.close();
})();
