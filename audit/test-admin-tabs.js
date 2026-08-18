const { chromium } = require("playwright");

async function testTabs() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => console.log(`[BROWSER CONSOLE ${msg.type()}]:`, msg.text()));
  page.on("pageerror", (err) => console.log("[BROWSER ERROR]:", err));

  console.log("Navigating to login...");
  await page.goto("https://passport.metis.gold/login", { waitUntil: "networkidle" });
  await page.fill("input[type=email]", "izzyblast2010@gmail.com");
  await page.fill("input[type=password]", "dos999999");
  console.log("Submitting login form...");
  await page.click("button[type=submit]");
  await page.waitForTimeout(6000);
  console.log("Current URL after 6s:", page.url());

  const bodyText = await page.$eval("body", el => el.innerText);
  console.log("Body text snippet:", bodyText.slice(0, 400).replace(/\n/g, " "));

  if (!page.url().includes("/admin")) {
    console.log("Did not redirect to /admin! Attempting direct navigation to /admin...");
    await page.goto("https://passport.metis.gold/admin", { waitUntil: "networkidle" });
    console.log("URL after direct goto /admin:", page.url());
    const adminBody = await page.$eval("body", el => el.innerText);
    console.log("Admin body:", adminBody.slice(0, 400).replace(/\n/g, " "));
  }

  await page.waitForTimeout(3000);

  // Check the tabs
  const tabButtons = await page.$$("aside nav button");
  console.log("Found sidebar tab buttons:", tabButtons.length);

  for (let i = 0; i < tabButtons.length; i++) {
    const text = await tabButtons[i].textContent();
    console.log(`\n--- Clicking Tab ${i}: ${text.replace(/\s+/g, ' ')} ---`);
    await tabButtons[i].click();
    await page.waitForTimeout(1000);

    const heading = await page.$eval("main header h2", el => el.textContent);
    console.log("Main Header H2:", heading);

    const mainContent = await page.$eval("main", el => el.innerText);
    console.log("Main content preview:", mainContent.slice(0, 300).replace(/\n/g, ' | '));
  }

  await browser.close();
}

testTabs().catch(console.error);
