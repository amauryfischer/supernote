import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) =>
  logs.push(`[reqfail] ${r.url()} — ${r.failure()?.errorText}`),
);

await page.goto("http://localhost:3200/", { waitUntil: "networkidle" }).catch((e) => {
  logs.push(`[goto] ${e.message}`);
});
await page.waitForTimeout(8000);

const body = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 500),
  rootChildren: document.getElementById("root")?.children.length ?? -1,
  html: document.getElementById("root")?.innerHTML.slice(0, 300) ?? "(no #root)",
}));

console.log("=== BODY ===");
console.log(JSON.stringify(body, null, 2));
console.log("=== LOGS ===");
for (const l of logs) console.log(l);

await browser.close();
