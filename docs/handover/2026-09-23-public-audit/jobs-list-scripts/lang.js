const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto('http://localhost:3100/pl/oferty-pracy?location=Bruksela&category=construction&sort=salary&page=1', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  const state = async () => p.evaluate(() => ({ url: location.pathname+location.search, lang: document.documentElement.lang, count: [...document.querySelectorAll('p[aria-live]')].map(e=>e.textContent)[0], chips: [...document.querySelectorAll('a[aria-label*=":"]')].map(a=>a.getAttribute('aria-label')), locs: [...document.querySelectorAll('[data-filter-passport=desktop] [id^="d-loc-"]')].map(e=>e.id) }));
  console.log(JSON.stringify(await state()));
  await p.locator('footer [role=combobox]').click();
  await p.locator('[role=option]', { hasText: 'Nederlands' }).click();
  await p.waitForURL(/\/nl\//); await p.waitForLoadState('networkidle'); await p.waitForTimeout(500);
  console.log(JSON.stringify(await state()));
  await b.close();
})();
