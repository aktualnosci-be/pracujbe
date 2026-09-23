const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const act=p=>p.evaluate(()=>{const e=document.activeElement;return e?(e.tagName+'|'+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,30))+'|'+(e.getAttribute('aria-expanded')??'')):null});
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:320,height:640}});
 const p=await ctx.newPage();
 await p.goto(B+'/pl/oferty-pracy?q=kierowca&page=1');
 await p.waitForTimeout(800);
 const trig=p.locator('header button[aria-haspopup=dialog]');
 console.log('trigger attrs',await trig.evaluate(e=>({exp:e.getAttribute('aria-expanded'),hp:e.getAttribute('aria-haspopup'),ctrl:e.getAttribute('aria-controls'),h:e.getBoundingClientRect().height,w:e.getBoundingClientRect().width})));
 // tab order from start
 const order=[];for(let i=0;i<6;i++){await p.keyboard.press('Tab');order.push(await act(p));}
 console.log('tab order',order);
 await trig.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
 console.log('after open focus',await act(p), 'expanded',await trig.getAttribute('aria-expanded'));
 const dlg=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');return d?{name:d.getAttribute('aria-labelledby')&&document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,modal:d.getAttribute('aria-modal'),links:[...d.querySelectorAll('a,button')].map(e=>(e.getAttribute('aria-label')||e.textContent.trim())+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height))}:null});
 console.log('dialog',JSON.stringify(dlg));
 const cyc=[];for(let i=0;i<9;i++){await p.keyboard.press('Tab');cyc.push(await act(p));}
 console.log('cycle',cyc);
 await p.keyboard.press('Escape'); await p.waitForTimeout(400);
 console.log('after esc',await act(p),await trig.getAttribute('aria-expanded'));
 // locale switch in mobile panel
 await trig.click(); await p.waitForTimeout(400);
 await p.getByRole('combobox',{name:'Język'}).click(); await p.waitForTimeout(300);
 await p.getByRole('option',{name:/English/}).click(); await p.waitForTimeout(2000);
 console.log('url after switch',p.url(), await p.evaluate(()=>document.documentElement.lang), 'dialog still open', await p.locator('[role=dialog]').count(), 'focus',await act(p));
 await p.screenshot({path:'mobile-after-switch.png'});
 await br.close();
})();
