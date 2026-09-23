const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const l of ['pl','fr'])for(const [w,fs] of [[320,'100%'],[640,'200%'],[768,'200%'],[1024,'200%'],[1280,'200%'],[1280,'100%']]){const p=await br.newPage({viewport:{width:w,height:800}});await p.goto(`http://localhost:3100/${l}`);await p.waitForTimeout(700);
 await p.evaluate(f=>document.documentElement.style.fontSize=f,fs);await p.waitForTimeout(200);
 console.log(l,w,fs,await p.evaluate(()=>{const b=document.querySelector('[aria-labelledby="cookie-banner-title"]');const br=b.getBoundingClientRect();return 'bannerH='+Math.round(br.height)+' top='+Math.round(br.top)+' '+[...b.querySelectorAll('button,a')].map(e=>{const r=e.getBoundingClientRect();return e.textContent.trim().slice(0,14)+'['+Math.round(r.left)+'..'+Math.round(r.right)+', y'+Math.round(r.top)+(r.right>innerWidth||r.top<0||r.bottom>innerHeight?' OUT':'')+']'}).join(' ')}));
 if(w===320&&l==='pl')await p.screenshot({path:'banner-320.png'});if(w===640&&l==='fr')await p.screenshot({path:'banner-640-200.png'});await p.close()}
await br.close()})();
