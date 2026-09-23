const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100'; const {dismiss}=require('./common');
const m=async(p,sel)=>p.evaluate(s=>[...document.querySelectorAll(s)].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return `"${(e.getAttribute('aria-label')||e.textContent).trim().slice(0,25)}" ${Math.round(r.width)}x${Math.round(r.height)} -> ${e.getAttribute('href')||''}`}),sel);
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 let ctx=await br.newContext({viewport:{width:1280,height:800}}); let p=await ctx.newPage();
 await p.goto(B+'/fr'); await dismiss(p); console.log('desktop header', await m(p,'header a, header button'));
 console.log('footer employer', await m(p,'footer a[href*=pracodaw]'));
 await ctx.close();
 ctx=await br.newContext({viewport:{width:320,height:640},hasTouch:true,isMobile:true}); p=await ctx.newPage();
 await p.goto(B+'/fr'); await dismiss(p); console.log('mobile header', await m(p,'header a, header button'));
 await p.click('header button[aria-label]'); await p.waitForTimeout(500);
 console.log('menu', await m(p,'[role=dialog] a, [role=dialog] button'));
 await p.screenshot({path:'menu-320-fr.png'});
 await p.keyboard.press('Escape'); await p.waitForTimeout(400);
 console.log('after esc dialog?', await p.$('[role=dialog]')!==null, 'focus', await p.evaluate(()=>document.activeElement.getAttribute('aria-label')));
 await br.close();
})();
