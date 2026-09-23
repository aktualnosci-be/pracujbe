const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const { AxeBuilder } = require('/workspace/pracujbe/node_modules/@axe-core/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  await p.goto('http://localhost:3100/pl/oferty-pracy', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  // axe list page desktop + mobile
  for (const vp of [[1280,800],[320,640]]) {
    await p.setViewportSize({ width: vp[0], height: vp[1] });
    for (const u of ['/pl/oferty-pracy', '/pl/oferty-pracy?keyword=zzzzqqq', '/nl/oferty-pracy?category=construction&keyword=a']) {
      await p.goto('http://localhost:3100' + u, { waitUntil: 'networkidle' });
      const r = await new AxeBuilder({ page: p }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
      console.log(vp[0], u, r.violations.map(v => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0,2).map(n=>n.target.join(' ')).join(' ; ')}`).join(' | ') || 'OK');
    }
  }
  // resize text 200% at 640
  await p.setViewportSize({ width: 640, height: 800 });
  for (const u of ['/pl/oferty-pracy?category=construction&keyword=bouw', '/fr/oferty-pracy?category=construction&contractType=freelance']) {
    await p.goto('http://localhost:3100' + u, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.documentElement.style.fontSize = '200%'); await p.waitForTimeout(300);
    const o = await p.evaluate(() => { const de = document.documentElement; const clipped = [...document.querySelectorAll('main *')].filter(e => (e.scrollWidth > e.clientWidth + 1) && ['hidden','clip'].includes(getComputedStyle(e).overflowX) && e.clientWidth>0).slice(0,5).map(e=>e.tagName+'.'+String(e.className).slice(0,50)+` ${e.scrollWidth}/${e.clientWidth}`);
      const wide = [...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right > de.clientWidth+1).slice(0,4).map(e=>e.tagName+'.'+String(e.className).slice(0,50)); return { sw: de.scrollWidth, cw: de.clientWidth, clipped, wide }; });
    console.log('200%', u, JSON.stringify(o));
    await p.screenshot({ path: `text200-${u.slice(1,3)}.png`, fullPage: false });
  }
  await b.close();
})();
