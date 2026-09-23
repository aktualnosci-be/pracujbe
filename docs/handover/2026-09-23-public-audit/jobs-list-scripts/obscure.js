const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const vp of [[1280,800],[320,640]]) {
  const p = await b.newPage({ viewport: { width: vp[0], height: vp[1] } });
  await p.goto('http://localhost:3100/pl/oferty-pracy?category=construction,transport,warehouse,production', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.locator('footer a').first().focus();
  const hits = [];
  for (let i = 0; i < 60; i++) {
    await p.keyboard.press('Shift+Tab');
    const s = await p.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const h = document.querySelector('header.sticky').getBoundingClientRect();
      if (a.closest('header')) return null;
      const covered = r.top < h.bottom ? Math.round(Math.min(r.bottom, h.bottom) - r.top) : 0;
      return covered > 0 ? `${a.tagName} "${(a.getAttribute('aria-label')||a.textContent).trim().slice(0,30)}" top=${Math.round(r.top)} h=${Math.round(r.height)} headerBottom=${Math.round(h.bottom)} coveredPx=${covered}` : null; });
    if (s) hits.push(s);
  }
  console.log(vp[0], hits.length, '\n ' + [...new Set(hits)].slice(0,8).join('\n '));
  await p.close(); }
  await b.close();
})();
