const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const urls = ['', '?keyword=zzzzqqq', '?q=zzzzqqq', '?page=-1', '?page=abc', '?page=2', '?page=999', '?page=2.5', '?sort=xxx', '?sort=salary', '?salaryMin=abc', '?salaryMin=4000&salaryMax=2000', '?category=bogus', '?location=Nowhere', '?keyword=' + 'a'.repeat(500), '?date=24h'];
  for (const u of urls) {
    const r = await p.goto('http://localhost:3100/pl/oferty-pracy' + u, { waitUntil: 'networkidle' });
    const info = await p.evaluate(() => {
      const count = [...document.querySelectorAll('p[aria-live]')].map(e => e.textContent).filter(Boolean)[0];
      const cards = document.querySelectorAll('main ul.divide-y > li').length;
      const pag = document.querySelector('nav[aria-label] [aria-current="page"]')?.textContent;
      const pagLinks = [...document.querySelectorAll('nav[aria-label] ul li a')].map(a=>a.textContent).join(',');
      const chips = [...document.querySelectorAll('a[aria-label]')].map(a=>a.getAttribute('aria-label')).filter(x=>x.includes(':')).join(' | ');
      const empty = document.querySelector('.border-dashed')?.textContent;
      const title = document.title;
      return { count, cards, pag, pagLinks, chips: chips.slice(0,200), empty, title };
    });
    console.log(r.status(), u.slice(0,40), JSON.stringify(info));
  }
  await b.close();
})();
