const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const AxeBuilder=require('/workspace/pracujbe/node_modules/@axe-core/playwright').default;
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [u,vp,openDlg] of [['/pl',{width:320,height:640},false],['/en/offline',{width:320,height:640},false],['/pl/praca/miasto/zzz',{width:1280,height:800},false],['/pl/nie-istnieje',{width:1280,height:800},false],['/fr',{width:1280,height:800},true]]) {
  const ctx=await br.newContext({viewport:vp});const p=await ctx.newPage();await p.goto(B+u);await p.waitForTimeout(1000);
  if(openDlg){await p.getByRole('button',{name:'Personnaliser'}).click().catch(e=>console.log('no btn'));await p.waitForTimeout(400);}
  const r=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']).analyze();
  console.log(u,openDlg?'dialog':'',r.violations.map(v=>v.id+'('+v.impact+'):'+v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')));
  if(openDlg){console.log(await p.evaluate(()=>{const s=document.querySelector('[role=switch]');const k=s.firstElementChild;return [getComputedStyle(s).backgroundColor,getComputedStyle(k).backgroundColor,getComputedStyle(s.closest('[role=dialog]')).backgroundColor]}));}
  await ctx.close();
 }
 await br.close();
})();
