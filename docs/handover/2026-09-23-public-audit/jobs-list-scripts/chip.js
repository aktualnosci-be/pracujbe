const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 320, height: 640 } });
  for (const kw of ['vrachtwagenchauffeursopleidingscentrum', 'https://www.example.be/vacature/12345', 'heftruckchauffeur met rijbewijs C en ervaring']) {
    await p.goto('http://localhost:3100/nl/oferty-pracy?keyword=' + encodeURIComponent(kw) + '&location=' + encodeURIComponent('Sint-Pieters-Leeuw-Industriezone'), { waitUntil: 'networkidle' });
    console.log(kw, await p.evaluate(() => document.documentElement.scrollWidth));
  }
  await p.screenshot({ path: 'chip320.png' });
  await b.close();
})();
