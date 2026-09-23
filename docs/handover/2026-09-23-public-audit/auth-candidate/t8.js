const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const {default:AxeBuilder} = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:1000}}); 
 await ctx.addCookies([{name:'pb_consent',value:'x',url:B}]);
 const p=await ctx.newPage();
 for(const l of ['nl','en']){
 await p.goto(B+'/'+l+'/rejestracja'); await p.waitForLoadState('networkidle');
 await p.click('button[type=submit]'); await p.waitForTimeout(300);
 const ax=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 console.log(l,'axe after errors',ax.violations.map(v=>v.id+':'+v.nodes.map(n=>n.target+' '+(n.any[0]?.message||'')).join('|')));
 console.log(await p.evaluate(()=>[...document.querySelectorAll('[id$=-error]')].map(e=>e.textContent).join(' / ')));
 }
 await p.goto(B+'/pl/rejestracja'); await p.click('button[type=submit]'); await p.waitForTimeout(300);
 await p.screenshot({path:'reg-errors.png',fullPage:true});
 await br.close();
})();
