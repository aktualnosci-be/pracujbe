const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto('http://localhost:3100/pl/oferty-pracy?sort=salary', { waitUntil: 'networkidle' });
  await p.locator('[aria-labelledby="cookie-banner-title"] button').first().click().catch(()=>{});
  const sum = p.locator('div.hidden.lg\\:flex details summary');
  await sum.focus(); await p.keyboard.press('Enter');
  console.log('open', await p.evaluate(() => document.querySelector('div.hidden.lg\\:flex details').open));
  await p.keyboard.press('Escape');
  console.log('after esc open', await p.evaluate(() => document.querySelector('div.hidden.lg\\:flex details').open));
  await p.mouse.click(5, 700);
  console.log('after outside click open', await p.evaluate(() => document.querySelector('div.hidden.lg\\:flex details').open));
  const opts = await p.evaluate(() => [...document.querySelectorAll('div.hidden.lg\\:flex details a')].map(a => a.textContent + ' aria-current=' + a.getAttribute('aria-current') + ' color=' + getComputedStyle(a).color + ' fw=' + getComputedStyle(a).fontWeight));
  console.log(opts);
  // salary sort: check order of cards shows salary descending? and jobs without salary
  const sal = await p.evaluate(() => [...document.querySelectorAll('main ul.divide-y > li')].map(li => li.innerText.split('\n').filter(t=>/€/.test(t)).join(' ') || '(brak)'));
  console.log(sal);
  await b.close();
})();
