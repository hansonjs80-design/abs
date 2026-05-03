import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173/shockwave');
  await page.waitForSelector('.shockwave-week');
  
  // Go to April
  const buttons = await page.$$('.header-nav-btn');
  await buttons[0].click(); // click `<`
  await new Promise(r => setTimeout(r, 2000));
  
  // Get cell content for April 30 (Week 4, Day 3)
  const cellContent = await page.evaluate(() => {
    const week4 = document.querySelectorAll('.shockwave-week')[4];
    if (!week4) return "NO_WEEK_4";
    const day3Col1 = week4.querySelectorAll('.shockwave-day')[3].querySelectorAll('.sw-cell')[4];
    return day3Col1 ? day3Col1.innerText : "NO_CELL";
  });
  
  console.log("April 30th Week 4 Day 3 Col 1 content:", cellContent);
  
  await browser.close();
})();
