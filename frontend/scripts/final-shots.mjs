import { chromium } from "@playwright/test";
const b = await chromium.launch();
for (const [route, name, wait] of [["/supply","dispatch",9000],["/command","command",9000],["/supply/fleet","fleet",8000]]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("http://127.0.0.1:3000" + route, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `../docs/v2-shots/final-${name}.png` });
  console.log("shot", name);
  await p.close();
}
await b.close();
