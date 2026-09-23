const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 640, height: 800 } });
  await p.goto('http://localhost:3100/fr/oferty-pracy?category=construction&contractType=freelance', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.documentElement.style.fontSize = '200%'); await p.waitForTimeout(300);
  const r = await p.evaluate(() => { const ul = document.querySelector('main ul.divide-y'); const ur = ul.getBoundingClientRect();
    return [...ul.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > ur.right + 0.5).slice(0,6).map(e => e.tagName + ' "' + (e.textContent||'').slice(0,40) + '" ' + String(e.className).slice(0,80) + ' r=' + Math.round(e.getBoundingClientRect().right) + '/' + Math.round(ur.right)); });
  console.log(r.join('\n'));
  const el = p.locator('main ul.divide-y > li').first(); await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: 'card-fr-200.png' });
  await b.close();
})();
