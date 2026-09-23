const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
const R=process.argv.slice(2);
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const u of R)for(const w of [320,1280])for(const state of ['banner','closed']){
 const ctx=await br.newContext({viewport:{width:w,height:800}});const p=await ctx.newPage();await p.goto(B+u);await p.waitForTimeout(800);
 if(state==='closed'){const b=p.locator('[aria-labelledby="cookie-banner-title"] button').first();if(await b.count()){await b.click();await p.waitForTimeout(300)}}
 const bh=await p.evaluate(()=>{const b=document.querySelector('[aria-labelledby="cookie-banner-title"]');return b?Math.round(b.getBoundingClientRect().height):0});
 await p.addStyleTag({content:"html{scroll-padding-bottom:"+(bh?bh+8:88)+"px}"});await p.evaluate(()=>{window.scrollTo(0,0);document.activeElement&&document.activeElement.blur()});
 let full=0,part=0,tot=0;const by={};const ex=[];let skip=null;let prev;
 for(let t=0;t<150;t++){await p.keyboard.press('Tab');await p.waitForTimeout(t===0?250:0);
  const r=await p.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const r=e.getBoundingClientRect();
   const pts=[];for(const fx of [0.1,0.5,0.9])for(const fy of [0.1,0.5,0.9])pts.push([r.left+r.width*fx,r.top+r.height*fy]);
   let ob=0;let who=null;for(const [x,y] of pts){const h=document.elementFromPoint(x,y);if(h&&!(e.contains(h)||h.contains(e))){ob++;const c=h.closest('[aria-labelledby="cookie-banner-title"],.fixed,.sticky,header');who=c?(c.tagName+'.'+String(c.className).slice(0,50)):h.tagName}}
   return {k:e.outerHTML.slice(0,120),txt:(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,30),ob,who,top:Math.round(r.top),bottom:Math.round(r.bottom)}});
  if(!r)break;if(r.k+r.txt===prev)break;prev=r.k+r.txt;tot++;
  if(t===0)skip=r;
  if(r.ob===9){full++;by[r.who]=(by[r.who]||0)+1;if(ex.length<3)ex.push(r.txt)}else if(r.ob>0)part++;}
 console.log(u,w,state,'bannerH',bh,'tabs',tot,'fullyHidden',full,'partial',part,JSON.stringify(by),ex.join('|'),'skip',skip&&skip.top+'/'+skip.bottom+' '+skip.txt);
 await ctx.close();}
await br.close()})();
