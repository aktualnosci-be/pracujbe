const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  for (const loc of ['pl','nl','fr','en']) {
    for (const q of ['', '?keyword=' + 'a'.repeat(120), '?category=construction,transport,warehouse&contractType=permanent,temporary&immediate=1&noLang=1&date=7d&salaryMin=2000&salaryMax=3000&accommodation=provided']) {
      await p.goto(`http://localhost:3100/${loc}/oferty-pracy${q}`, { waitUntil: 'networkidle' });
      const o = await p.evaluate(() => {
        const de = document.documentElement;
        const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > de.clientWidth + 1 && r.width>0 && getComputedStyle(e).position!=='fixed'; }).slice(0,5).map(e => e.tagName + '.' + (e.className?.toString()||'').slice(0,60) + ' r=' + Math.round(e.getBoundingClientRect().right));
        return { sw: de.scrollWidth, cw: de.clientWidth, wide };
      });
      console.log(loc, q.slice(0,30), JSON.stringify(o));
    }
  }
  // Small targets at 320
  await p.goto('http://localhost:3100/pl/oferty-pracy?category=construction&keyword=bouw', { waitUntil: 'networkidle' });
  const small = await p.evaluate(() => [...document.querySelectorAll('main a, main button, main summary, main input, main [role=checkbox]')].filter(e => { const r = e.getBoundingClientRect(); return r.width>0 && (r.height < 44 || r.width < 24); }).map(e => `${e.tagName} "${(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,40)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
  console.log('SMALL(<44h):', small.join('\n  '));
  await b.close();
})();
