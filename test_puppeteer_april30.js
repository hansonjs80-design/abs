import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Go to Shockwave Calendar
  await page.goto('http://localhost:5173/shockwave', { waitUntil: 'networkidle2' });
  
  // Click '<' to go to April
  await page.click('button.shockwave-month-nav-btn:first-child');
  await page.waitForTimeout(2000);
  
  // Scrape all cells
  const data = await page.evaluate(() => {
    const results = [];
    // Find Week 4
    const weeks = document.querySelectorAll('.shockwave-week');
    if (weeks.length > 4) {
      const week4 = weeks[4];
      // Find Day 3 (Thursday)
      const days = week4.querySelectorAll('.shockwave-day');
      if (days.length > 3) {
        const thursday = days[3];
        const dayHeader = thursday.querySelector('.sw-day-header-cell').innerText;
        results.push(`Header: ${dayHeader}`);
        
        // Find all rows in Thursday
        const rows = thursday.querySelectorAll('.sw-schedule-row');
        rows.forEach((row, rIdx) => {
          const cells = row.querySelectorAll('.sw-cell');
          cells.forEach((cell, cIdx) => {
            const text = cell.innerText.trim();
            if (text) {
              results.push(`Row ${rIdx}, Col ${cIdx}: ${text}`);
            }
          });
        });
      }
    }
    return results;
  });
  
  console.log("April 30th (Week 4, Day 3) Cells:");
  console.log(data.join('\n'));
  
  await browser.close();
})();
