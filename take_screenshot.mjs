import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.launch({ 
      headless: "new",
      defaultViewport: { width: 1440, height: 900 }
    });
    const page = await browser.newPage();
    
    console.log('Navigating to http://localhost:5173/shockwave-stats...');
    await page.goto('http://localhost:5173/shockwave-stats', { waitUntil: 'networkidle0' });
    
    // Check if we got redirected to login
    const url = page.url();
    if (url.includes('login')) {
      console.log('Redirected to login page. Attempting to bypass or wait...');
      // Since we don't have credentials in the script, we might just screenshot the login page
      // Or we can try to inject a fake token if the app supports it, but let's just screenshot whatever is there for now.
    }
    
    // Wait an extra second for animations or data to load
    await new Promise(r => setTimeout(r, 2000));
    
    const screenshotPath = '/Users/joohansol/.gemini/antigravity/brain/2872096b-3736-47f3-9da5-62eceec40df5/actual_ui_screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    console.log('Screenshot saved to:', screenshotPath);
    await browser.close();
  } catch (err) {
    console.error('Error taking screenshot:', err);
  }
})();
