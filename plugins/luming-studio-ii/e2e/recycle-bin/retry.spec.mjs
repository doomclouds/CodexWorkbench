import { expect, failNextRecycleBinRead, screenshot, test } from "../support/studio.mjs";

test("[TRASH-ERR-01] 回收站读取失败后重试并显示实际作品", async ({ page, studio }, testInfo) => {
  const title = "重试后的回收站白板";
  const active = "工作台保留白板";
  await studio.seedBoards([{ title, trashed: true }, { title: active }]);

  await page.goto(studio.url);
  await expect(page.getByRole("button", { name: "打开白板：" + active })).toBeVisible();
  await failNextRecycleBinRead(page, studio);
  await page.getByRole("button", { name: "筛选作品", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "回收站", exact: true }).click();
  const retry = page.getByRole("button", { name: "重试", exact: true });
  await expect(retry).toBeVisible();
  await screenshot(page, testInfo, "trash-load-failed");

  await retry.click();
  await expect(page.getByRole("button", { name: "恢复作品：" + title, exact: true })).toBeVisible();
  await expect(retry).toBeHidden();
  await screenshot(page, testInfo, "trash-retry-restored");
});
