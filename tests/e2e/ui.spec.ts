import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
}
const width = (page: Page) => page.locator('#outline').evaluate(element => element.getBoundingClientRect().width);

test('app information, privacy and help work offline without changing the document', async ({ page, context }, testInfo) => {
  await openApp(page);
  await page.locator('#source-tab').click();
  await page.locator('#markdown-input').fill('# 下書き\n\n内容はそのまま。');
  await context.setOffline(true);
  await page.locator('#version-button').click();
  const dialog = page.getByRole('dialog', { name: 'ヘルプ・アプリ情報' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'アプリ情報', exact: true })).toBeFocused();
  await expect(page.locator('#info-about')).toContainText('shiori markdown editor 1.0.0');
  await expect(page.locator('#info-about')).toContainText('Copyright © 2026 テバ開発');
  expect(await page.locator('.info-logo').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('about.png') });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#info-tab-privacy')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#info-about')).toBeHidden();
  await expect(page.locator('#info-privacy')).toContainText('開発者のサーバーへ送信する機能、アクセス解析、広告機能はありません');
  await expect(page.locator('#info-privacy')).toContainText('表示のON/OFFにかかわらず');
  await expect(dialog.locator('a[href^="mailto:"]')).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(page.locator('#info-help')).toBeVisible();
  await expect(page.locator('#info-help')).toContainText('見出しペイン');
  await page.keyboard.press('Home');
  await expect(page.locator('#info-tab-about')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#info-tab-help')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#version-button')).toBeFocused();
  await expect(page.locator('#markdown-input')).toHaveValue('# 下書き\n\n内容はそのまま。');
  await expect(page.locator('#dirty-mark')).toBeVisible();
  await page.keyboard.press('F1');
  await expect(page.locator('#info-help')).toBeVisible();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).last().click();
  await page.locator('#file-menu summary').click();
  await page.locator('#help-button').click();
  await expect(page.locator('#info-help')).toBeVisible();
  await expect(page.locator('.shortcut-list kbd').filter({ hasText: /^\\$/ })).toHaveCount(1);
  await expect(page.locator('#file-menu')).not.toHaveAttribute('open');
  await page.keyboard.press('Escape');
  await expect(page.locator('#file-menu summary')).toBeFocused();
});

test('information dialog stays usable on a narrow screen and in dark mode', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openApp(page);
  await page.locator('#file-menu summary').click();
  await page.locator('#theme-button').click();
  await page.locator('#version-button').click();
  for (const name of ['アプリ情報', 'プライバシー', '使い方']) {
    await page.getByRole('tab', { name, exact: true }).click();
    const bounds = await page.locator('#help-dialog').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
    expect(await page.locator('#help-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const panel = page.locator('[role="tabpanel"]:visible');
    await panel.focus();
    await page.keyboard.press('Control+End');
    await expect(page.locator('.info-footer button')).toBeInViewport();
  }
  await page.screenshot({ path: testInfo.outputPath('help-narrow-dark.png') });
  await page.locator('.info-footer button').click();
  await expect(page.locator('#help-dialog')).toBeHidden();
});

test('outline width can be dragged, remembered, hidden and reset', async ({ page }, testInfo) => {
  await openApp(page);
  await page.locator('#source-tab').click();
  await page.locator('#markdown-input').fill('# 長い見出しも読みやすい幅に調整できます\n\n本文。');
  await expect(page.locator('#outline-list a')).toContainText('長い見出し');
  const original = await width(page);
  const separator = page.getByRole('separator', { name: '見出しペインの幅' });
  const bounds = (await separator.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 160, bounds.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => width(page)).toBe(original + 160);
  await expect(separator).toHaveAttribute('aria-valuenow', String(original + 160));
  await expect(page.locator('#app')).not.toHaveClass(/resizing-outline/);
  await page.screenshot({ path: testInfo.outputPath('outline-expanded.png') });
  await expect(page.locator('#document-status')).not.toContainText('自動保存中');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => width(page)).toBe(original + 160);
  await page.locator('#toggle-outline').click();
  await expect(separator).toBeHidden();
  await page.locator('#toggle-outline').click();
  await expect.poll(() => width(page)).toBe(original + 160);
  await separator.dblclick();
  await expect.poll(() => width(page)).toBe(original);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => width(page)).toBe(original);
});

test('keyboard resizing is bounded and a smaller window preserves room for editing', async ({ page }) => {
  await openApp(page);
  const separator = page.getByRole('separator', { name: '見出しペインの幅' });
  await separator.focus();
  await page.keyboard.press('End');
  const expanded = await width(page);
  await page.keyboard.press('ArrowRight');
  expect(await width(page)).toBe(expanded);
  await page.setViewportSize({ width: 640, height: 800 });
  await expect.poll(() => width(page)).toBeLessThan(expanded);
  expect(await page.locator('.editor-area').evaluate(element => element.clientWidth)).toBeGreaterThanOrEqual(280);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1360, height: 980 });
  await expect.poll(() => width(page)).toBe(expanded);
  await page.keyboard.press('Home');
  const minimum = await width(page);
  await page.keyboard.press('ArrowLeft');
  expect(await width(page)).toBe(minimum);
  await page.keyboard.press('ArrowRight');
  expect(await width(page)).toBe(minimum + 10);
  await page.keyboard.press('Shift+ArrowRight');
  expect(await width(page)).toBe(minimum + 50);
  await page.emulateMedia({ media: 'print' });
  await expect(separator).toBeHidden();
});

test('cancelled pointer resizing restores the previous width', async ({ page }) => {
  await openApp(page);
  const original = await width(page);
  const separator = page.getByRole('separator', { name: '見出しペインの幅' });
  const bounds = (await separator.boundingBox())!;
  await page.mouse.move(bounds.x + 3, bounds.y + 50);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, bounds.y + 50);
  expect(await width(page)).toBeGreaterThan(original);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await width(page)).toBe(original);
  await expect(page.locator('#app')).not.toHaveClass(/resizing-outline/);
});

for (const stored of ['"wide"', '{}', '1e300', '-1000']) {
  test(`invalid or extreme saved width stays within the window: ${stored}`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('shiori:outlineWidth', value), stored);
    await page.setViewportSize({ width: 390, height: 700 });
    await openApp(page);
    await page.locator('#toggle-outline').click();
    const actual = await width(page);
    expect(actual).toBeGreaterThanOrEqual(125);
    expect(actual).toBeLessThanOrEqual(203);
    expect(await page.locator('.editor-area').evaluate(element => element.clientWidth)).toBeGreaterThanOrEqual(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
