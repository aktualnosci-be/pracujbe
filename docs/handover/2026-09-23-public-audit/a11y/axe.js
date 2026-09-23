const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const AxeBuilder = require('/workspace/pracujbe/node_modules/@axe-core/playwright').default;
const fs = require('fs');
const B='http://localhost:3100';
const R=['','/oferty-pracy','/oferty-pracy/warehouse-worker-antwerp-1001','/praca','/praca/kategoria/construction','/praca/miasto/antwerp','/poradniki','/poradniki/numer-niss-i-podatki','/o-nas','/faq','/kontakt','/pomoc','/regulamin','/polityka-prywatnosci','/polityka-cookies','/logowanie','/rejestracja','/rejestracja-pracodawca','/reset-hasla','/offline','/nie-istnieje-xyz'];
const L=['pl','nl','fr','en'];
const VP=[1280,320];
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const jobs=[];for(const l of L)for(const r of R)for(const w of VP)jobs.push({l,r,w});
 const out=[];let i=0;
 async function worker(){ while(i<jobs.length){ const j=jobs[i++];
  const ctx=await br.newContext({viewport:{width:j.w,height:800}});const p=await ctx.newPage();
  const url=`${B}/${j.l}${j.r}`;
  try{ const resp=await p.goto(url,{waitUntil:'load'}); await p.waitForTimeout(900);
   for(const state of ['banner','closed']){
    if(state==='closed'){ const b=p.locator('[aria-labelledby="cookie-banner-title"] button').first(); if(await b.count()){await b.click(); await p.waitForTimeout(300);} }
    const bannerVis=await p.locator('#cookie-banner-title').count();
    const wc=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).options({rules:{'target-size':{enabled:true}}}).analyze();
    const bp=await new AxeBuilder({page:p}).withTags(['best-practice']).analyze();
    const f=(res,kind)=>res.violations.map(v=>({kind,id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({t:n.target.join(' '),html:n.html.slice(0,200),s:(n.failureSummary||'').slice(0,300)}))}));
    out.push({url,status:resp.status(),w:j.w,state,bannerVis,v:[...f(wc,'wcag'),...f(bp,'bp')]});
   }
  }catch(e){out.push({url,w:j.w,err:String(e)})}
  await ctx.close(); } }
 await Promise.all([1,2,3,4,5,6].map(worker));
 fs.writeFileSync('axe.json',JSON.stringify(out,null,1)); await br.close();
})();
