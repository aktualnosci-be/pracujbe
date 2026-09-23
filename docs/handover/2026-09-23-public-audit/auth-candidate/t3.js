const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const {default:AxeBuilder} = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:900}});
 const p=await ctx.newPage();
 // double submit with delayed action
 let posts=0;
 await p.route('**/pl/rejestracja', async (route)=>{ if(route.request().method()==='POST'){posts++; await new Promise(r=>setTimeout(r,1500));} await route.continue(); });
 await p.goto(B+'/pl/rejestracja'); await p.waitForLoadState('networkidle');
 await p.fill('#firstName','Jan'); await p.fill('#lastName','Kowalski'); await p.fill('#email','jan@example.com'); await p.fill('#password','Haslo1234'); await p.fill('#passwordConfirm','Haslo1234'); await p.click('#agreeTerms');
 await p.focus('button[type=submit]');
 await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
 await p.waitForTimeout(200);
 const mid=await p.evaluate(()=>({btn:document.querySelector('button[type=submit]').outerHTML.slice(0,200),active:document.activeElement.tagName, busy:document.querySelector('form').getAttribute('aria-busy')}));
 await p.waitForTimeout(2500);
 const after=await p.evaluate(()=>({active:document.activeElement.tagName+'#'+document.activeElement.id, vals:[...document.querySelectorAll('input[id]')].map(i=>i.id+'='+i.value)}));
 console.log('posts',posts,JSON.stringify(mid),JSON.stringify(after));
 // language switcher / links on auth pages
 for (const l of ['pl','nl','fr','en']) for (const path of ['/logowanie','/rejestracja','/reset-hasla','/ustaw-nowe-haslo','/potwierdzenie']){
  const q=await ctx.newPage(); await q.goto(B+'/'+l+path); await q.waitForLoadState('networkidle');
  const r=await q.evaluate(()=>({links:[...document.querySelectorAll('a')].map(a=>a.getAttribute('href')), raw:(document.body.innerText.match(/\b[a-z]+\.[a-z]+[A-Za-z.]*\b/g)||[]).filter(s=>/auth\.|errors\.|common\./.test(s)), hreflang:[...document.querySelectorAll('link[hreflang]')].length}));
  const ax=await new AxeBuilder({page:q}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']).analyze();
  console.log(l+path, JSON.stringify(r), ax.violations.map(v=>v.id+'('+v.impact+'):'+v.nodes.length).join(', '));
  await q.close();
 }
 await br.close();
})();
