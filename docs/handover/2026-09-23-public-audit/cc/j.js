const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await br.newPage({viewport:{width:640,height:800}});
 await pg.goto('http://localhost:3100/nl/praca',{waitUntil:'networkidle'});
 await pg.evaluate(()=>{document.querySelector('[aria-labelledby=cookie-banner-title]')?.remove();document.documentElement.style.fontSize='200%'}); await pg.waitForTimeout(200);
 const el=pg.locator('h3:has-text("Seizoenswerk")'); await el.scrollIntoViewIfNeeded();
 await pg.evaluate(()=>{const h=[...document.querySelectorAll('h3')].find(h=>h.textContent.includes('Schoonmaak'));window.scrollTo(0,h.getBoundingClientRect().top+scrollY-100)});
 await pg.screenshot({path:'hub-200-tiles.png'});
 // real zoom equivalent: 1280 with deviceScaleFactor? use CSS zoom
 await br.close();
})();
