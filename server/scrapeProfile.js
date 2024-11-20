import puppeteer from 'puppeteer';

export async function scrapeProfile(username) {
  console.log(`Starting scraping for username: ${username}`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  try {
    await page.goto(`https://twitter.com/${username}`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait for profile elements
    await page.waitForSelector('[data-testid="UserName"]', { timeout: 60000 });

    const profile = await page.evaluate(() => {
      const displayNameEl = document.querySelector('[data-testid="UserName"]');
      const joinDateEl = document.querySelector('span[data-testid="UserJoinDate"]');
      const avatarEl = document.querySelector('img[data-testid="UserAvatar"]');

      return {
        displayName: displayNameEl ? displayNameEl.textContent.split('\n')[0].trim() : null,
        joinedDate: joinDateEl ? joinDateEl.textContent.replace('Joined ', '') : null,
        avatarUrl: avatarEl ? avatarEl.src : null,
      };
    });

    console.log(`Scraping successful for ${username}: ${JSON.stringify(profile)}`);
	profile.username = username
    return profile;
  } catch (error) {
    console.error(`Error scraping profile for ${username}:`, error);
    throw error;
  } finally {
    await page.close();
    await browser.close();
  }
}
