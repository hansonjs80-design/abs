import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.launch({ 
      headless: "new",
      defaultViewport: { width: 1440, height: 900 }
    });
    const page = await browser.newPage();
    
    console.log('Navigating to http://localhost:5173/shockwave-stats...');
    await page.goto('http://localhost:5173/shockwave-stats', { waitUntil: 'networkidle2' });
    
    // Check if we are on the login page by looking for the #email input
    const emailInput = await page.$('#email');
    if (emailInput) {
      console.log('Login page detected. Attempting to log in as admin...');
      await page.type('#email', 'admin');
      await page.type('#password', '1');
      await page.click('.login-btn');
      console.log('Login form submitted. Waiting for transition to home page...');
      await new Promise(r => setTimeout(r, 3000));
      
      console.log('Clicking the shockwave tab...');
      await page.waitForSelector('.top-tab--shockwave');
      await page.click('.top-tab--shockwave');
    } else {
      console.log('Already logged in. Clicking the shockwave tab...');
      await page.waitForSelector('.top-tab--shockwave');
      await page.click('.top-tab--shockwave');
    }
    
    // Wait for the scheduler to render
    console.log('Waiting for content to load...');
    await new Promise(r => setTimeout(r, 4000));
    
    // Right click on a cell to trigger the context menu
    // We target a cell inside the calendar grid to be sure it's the scheduler cell.
    const cell = await page.$('.calendar-grid .sw-cell');
    if (cell) {
      console.log('Found a scheduler cell. Right clicking...');
      const rect = await cell.boundingBox();
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, { button: 'right' });
      await new Promise(r => setTimeout(r, 1500)); // wait for context menu animation
      
      console.log('Hovering over body part menu item to trigger submenu...');
      await page.hover('.context-menu-body-item');
      await new Promise(r => setTimeout(r, 1000)); // wait for submenu transition
    } else {
      console.log('No scheduler cell found.');
      // Try fallback to any .sw-cell if .calendar-grid version not found
      const fallbackCell = await page.$('.sw-cell');
      if (fallbackCell) {
        console.log('Found fallback cell. Right clicking...');
        const rect = await fallbackCell.boundingBox();
        await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, { button: 'right' });
        await new Promise(r => setTimeout(r, 1500));
        
        console.log('Hovering over body part menu item...');
        await page.hover('.context-menu-body-item');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    const currentUrl = page.url();
    console.log('Current URL is:', currentUrl);
    
    const screenshotPath = '/Users/joohansol/.gemini/antigravity-ide/brain/e9853654-f148-44ec-af82-8a2ac335334d/actual_ui_screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: false }); // viewport only since menu is local
    
    console.log('Screenshot saved to:', screenshotPath);
    await browser.close();
  } catch (err) {
    console.error('Error taking screenshot:', err);
  }
})();
