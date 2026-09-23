const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [vp,font] of [[{width:320,height:640},null],[{width:640,height:400},'200%'],[{width:1280,height:800},null]]) for (const l of ['pl','fr']) {
  const ctx=await br.newContext({viewport:vp});
  const p=await ctx.newPage();
  await p.goto(`${B}/${l}/oferty-pracy`); await p.waitForTimeout(1000);
  if(font) await p.evaluate(f=>document.documentElement.style.fontSize=f,font);
  await p.waitForTimeout(200);
  const ban=await p.evaluate(()=>{const b=document.querySelector('[aria-labelledby=cookie-banner-title]');if(!b)return null;const r=b.getBoundingClientRect();return {top:Math.round(r.top),h:Math.round(r.height),pct:Math.round(r.height/innerHeight*100),sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,btns:[...b.querySelectorAll('button,a')].map(e=>Math.round(e.getBoundingClientRect().height))}});
  let hidden=0,partial=0,total=0,ex=[];
  for(let i=0;i<60;i++){await p.keyboard.press('Tab');
   const r=await p.evaluate(()=>{const e=document.activeElement;const b=document.querySelector('[aria-labelledby=cookie-banner-title]');if(!e||!b||b.contains(e))return 'banner';const er=e.getBoundingClientRect(),br=b.getBoundingClientRect();if(er.height===0)return 'zero';const hdr=document.querySelector('header');const hr=hdr?hdr.getBoundingClientRect():{bottom:0};const hdrCover=hdr&&!hdr.contains(e)&&er.bottom<=hr.bottom;if(er.top>=br.top)return 'hidden:'+(e.getAttribute('aria-label')||e.textContent.trim().slice(0,25));if(hdrCover)return 'hiddenHeader:'+(e.textContent.trim().slice(0,25));if(er.bottom>br.top)return 'partial';return 'ok'});
   if(r==='banner')break; total++; if(r.startsWith('hidden')){hidden++; if(ex.length<4)ex.push(r)} else if(r==='partial')partial++;}
  console.log(l,JSON.stringify(vp),font,JSON.stringify(ban),'focus steps',total,'fullyHidden',hidden,'partial',partial,ex);
  if(l==='pl'&&vp.width===320) await p.screenshot({path:'banner-320.png'});
  await ctx.close();
 }
 await br.close();
})();
