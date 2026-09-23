const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const fs=require('fs');const B='http://localhost:3100';
const R=['','/oferty-pracy','/oferty-pracy/warehouse-worker-antwerp-1001','/praca','/praca/kategoria/construction','/praca/miasto/antwerp','/poradniki','/poradniki/numer-niss-i-podatki','/o-nas','/faq','/kontakt','/pomoc','/regulamin','/polityka-prywatnosci','/polityka-cookies','/logowanie','/rejestracja','/rejestracja-pracodawca','/reset-hasla','/offline','/nie-istnieje-xyz','/oferty-pracy/nope-999'];
const L=['pl','nl','fr','en'];
const jobs=[];for(const l of L)for(const r of R)jobs.push({l,r});
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const out=[];let i=0;
async function closeBanner(p){const b=p.locator('[aria-labelledby="cookie-banner-title"] button').first(); if(await b.count()){await b.click();await p.waitForTimeout(250);}}
async function work(){while(i<jobs.length){const j=jobs[i++];const url=`${B}/${j.l}${j.r}`;const res={url};
 // 320: static checks + target size + overflow
 let ctx=await br.newContext({viewport:{width:320,height:800}});let p=await ctx.newPage();await p.goto(url);await p.waitForTimeout(800);
 res.static=await p.evaluate(()=>{const ids={};document.querySelectorAll('[id]').forEach(e=>{ids[e.id]=(ids[e.id]||0)+1});
  return {lang:document.documentElement.getAttribute('lang'),title:document.title,dupIds:Object.entries(ids).filter(([k,v])=>v>1).map(([k,v])=>k+'x'+v),
   ov:document.documentElement.scrollWidth-document.documentElement.clientWidth}});
 res.small=await p.evaluate(()=>{const sel='a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=switch],[role=tab],[tabindex]:not([tabindex="-1"])';
  const els=[...document.querySelectorAll(sel)].filter(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'});
  const rects=els.map(e=>e.getBoundingClientRect());
  return els.map((e,k)=>{const r=rects[k];if(r.width>=24&&r.height>=24)return null;
   // inline exception: link inside a text block with siblings text
   const inline=getComputedStyle(e).display==='inline'&&e.parentElement&&/P|LI|SPAN|DD|TD|LABEL/.test(e.parentElement.tagName)&&(e.parentElement.textContent.trim().length>e.textContent.trim().length+10);
   // spacing exception: 24px circle centered doesn't intersect other targets
   const cx=r.x+r.width/2,cy=r.y+r.height/2;let conflict=false;
   rects.forEach((o,m)=>{if(m===k)return;const dx=Math.max(o.x-cx,0,cx-(o.x+o.width)),dy=Math.max(o.y-cy,0,cy-(o.y+o.height));if(Math.hypot(dx,dy)<12)conflict=true});
   const path=[];let n=e;for(let d=0;d<4&&n;d++){path.unshift(n.tagName.toLowerCase()+(n.className&&typeof n.className==='string'?'.'+n.className.split(' ').slice(0,3).join('.'):''));n=n.parentElement}
   return {tag:e.tagName,txt:(e.getAttribute('aria-label')||e.textContent||e.getAttribute('name')||'').trim().slice(0,40),w:Math.round(r.width),h:Math.round(r.height),inline,conflict,path:path.join(' > ').slice(0,250)}}).filter(Boolean)});
 // focus with banner visible at 320 then at 1280
 for(const w of [320,1280]){ if(w===1280){await ctx.close();ctx=await br.newContext({viewport:{width:1280,height:800}});p=await ctx.newPage();await p.goto(url);await p.waitForTimeout(800);}
  const f=[];await p.evaluate(()=>{document.activeElement&&document.activeElement.blur();window.scrollTo(0,0)});
  let prev=null;
  for(let t=0;t<70;t++){await p.keyboard.press('Tab');
   const info=await p.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return null;
    const cs=getComputedStyle(e);const r=e.getBoundingClientRect();
    const sig={o:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,bs:cs.boxShadow,bg:cs.backgroundColor,bc:cs.borderColor,td:cs.textDecorationLine,c:cs.color};
    // clipping by ancestor overflow
    let clip=null;for(let a=e.parentElement;a&&a!==document.body;a=a.parentElement){const acs=getComputedStyle(a);if(/hidden|clip|auto|scroll/.test(acs.overflow+acs.overflowX+acs.overflowY)){const ar=a.getBoundingClientRect();const ow=parseFloat(cs.outlineWidth)+Math.max(0,parseFloat(cs.outlineOffset)||0);
      if(r.left-ow<ar.left-0.5||r.right+ow>ar.right+0.5||r.top-ow<ar.top-0.5||r.bottom+ow>ar.bottom+0.5){clip=a.tagName+'.'+String(a.className).slice(0,80);break;}}}
    // obscured: sample points
    const pts=[[r.left+2,r.top+2],[r.right-2,r.bottom-2],[r.left+r.width/2,r.top+r.height/2]];let obsc=0;
    for(const [x,y] of pts){if(x<0||y<0||x>innerWidth||y>innerHeight){continue}const h=document.elementFromPoint(x,y);if(h&&!(e.contains(h)||h.contains(e)))obsc++}
    const offscreen=r.bottom<0||r.top>innerHeight;
    const path=[];let n=e;for(let d=0;d<3&&n;d++){path.unshift(n.tagName.toLowerCase()+(typeof n.className==='string'&&n.className?'.'+n.className.split(' ').slice(0,4).join('.'):''));n=n.parentElement}
    return {path:path.join(' > ').slice(0,260),txt:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,40),sig,clip,obsc,offscreen,vis:cs.visibility,sz:[Math.round(r.width),Math.round(r.height)]}});
   if(!info)break; const key=info.path+info.txt; if(prev===key)break; prev=key;
   // unfocused signature
   const un=await p.evaluate(()=>{const e=document.activeElement;e.setAttribute('data-aud','1');e.blur();const cs=getComputedStyle(e);return {o:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,bs:cs.boxShadow,bg:cs.backgroundColor,bc:cs.borderColor,td:cs.textDecorationLine,c:cs.color}});
   await p.evaluate(()=>{const e=document.querySelector('[data-aud]');e.removeAttribute('data-aud');e.focus({preventScroll:true})});
   // Note: programmatic focus may not trigger :focus-visible identically; use captured tab signature
   info.nochange=JSON.stringify(un)===JSON.stringify(info.sig);info.un=un;f.push(info);}
  res['focus'+w]=f;}
 // 640 + 200% font
 await ctx.close();ctx=await br.newContext({viewport:{width:640,height:800}});p=await ctx.newPage();await p.goto(url);await p.waitForTimeout(700);
 await p.evaluate(()=>document.documentElement.style.fontSize='200%');await p.waitForTimeout(300);
 res.ov640=await p.evaluate(()=>{const W=document.documentElement.clientWidth;const bad=[];document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(r.right>W+1&&r.width>0){const cs=getComputedStyle(e);bad.push(e.tagName+'.'+String(e.className).slice(0,70)+' r='+Math.round(r.right))}});return {sw:document.documentElement.scrollWidth-W,bad:bad.slice(0,6)}});
 await closeBanner(p);
 await ctx.close();out.push(res);process.stdout.write('.');}}
await Promise.all([1,2,3,4,5,6].map(work));fs.writeFileSync('prog.json',JSON.stringify(out,null,1));await br.close();})();
