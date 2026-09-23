const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [w,h,fs] of [[320,640,null],[640,800,'200%']]){
  const ctx=await br.newContext({viewport:{width:w,height:h}}); const p=await ctx.newPage();
  for (const l of ['pl','fr','nl']) for (const path of ['/logowanie','/rejestracja','/reset-hasla']){
   await p.goto(B+'/'+l+path); await p.waitForLoadState('networkidle');
   if(fs) await p.evaluate(f=>document.documentElement.style.fontSize=f,fs);
   await p.waitForTimeout(200);
   const r=await p.evaluate(()=>{const d=document.documentElement;
     const over=[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>d.clientWidth+1||b.left<-1)}).slice(0,4).map(e=>e.tagName+'.'+(e.className||'').toString().slice(0,40)+':'+Math.round(e.getBoundingClientRect().right));
     const clipped=[...document.querySelectorAll('button,a,label')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent.slice(0,40));
     const small=[...document.querySelectorAll('a,button,input')].map(e=>{const b=e.getBoundingClientRect();return [e.tagName+':'+(e.textContent||e.id).trim().slice(0,30),Math.round(b.width),Math.round(b.height)]}).filter(x=>x[2]<24||x[1]<24);
     return {sw:d.scrollWidth,cw:d.clientWidth,over,clipped,small};});
   console.log(w,fs,l+path,JSON.stringify(r));
   if(l==='pl'&&path==='/rejestracja') await p.screenshot({path:`reg-${w}.png`,fullPage:true});
  }
  await ctx.close();
 }
 await br.close();
})();
