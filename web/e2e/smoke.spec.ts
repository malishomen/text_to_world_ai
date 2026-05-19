import { test, expect, type ConsoleMessage } from '@playwright/test';

// All tests assume the dev server is running with:
//   NEXT_PUBLIC_DEV_FAKE_AI=1
//   NEXT_PUBLIC_MAX_GENERATION_MS=10000
// (configured in playwright.config.ts webServer.env).
//
// In DEV_FAKE_AI mode, /loading-dream skips the LLM/SD/TRELLIS pipeline,
// writes a fallback gameConfig, and navigates to /play after ~3s.

test('home page loads, shows "DreamCraft" header, no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DreamCraft' })).toBeVisible();
  // Allow page to settle (network idle) so any async errors surface.
  await page.waitForLoadState('networkidle');
  expect(consoleErrors).toEqual([]);
});

test('submitting a dream navigates to /loading-dream', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Describe your dream')
    .fill('a neon forest of glass trees and a giant moon');
  await page.getByRole('button', { name: /Craft My Game/i }).click();
  await page.waitForURL('**/loading-dream', { timeout: 5_000 });
  expect(page.url()).toContain('/loading-dream');
});

test('in DEV_FAKE_AI mode, the flow lands on /play within 10s', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your dream').fill('a neon forest');
  await page.getByRole('button', { name: /Craft My Game/i }).click();
  await page.waitForURL('**/play', { timeout: 10_000 });
  expect(page.url()).toContain('/play');
});

test('canvas element exists and has a WebGL2 context on /play', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your dream').fill('a neon forest');
  await page.getByRole('button', { name: /Craft My Game/i }).click();
  await page.waitForURL('**/play', { timeout: 10_000 });

  // Canvas might be created a moment after /play mounts (dynamic import).
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  const hasWebGL2 = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('webgl2');
    return ctx !== null;
  });
  expect(hasWebGL2).toBe(true);
});

test('export button opens a dialog titled "Export to Godot"', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your dream').fill('a neon forest');
  await page.getByRole('button', { name: /Craft My Game/i }).click();
  await page.waitForURL('**/play', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Export to Godot' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Export to Godot')).toBeVisible();
});

test('Escape key closes the export dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your dream').fill('a neon forest');
  await page.getByRole('button', { name: /Craft My Game/i }).click();
  await page.waitForURL('**/play', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Export to Godot' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('at 390x844 (mobile), no horizontal scroll and <details> summary is visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Describe your dream').fill('a neon forest');
  await page.getByRole('button', { name: /Craft My Game/i }).click();
  await page.waitForURL('**/play', { timeout: 10_000 });

  // Wait for canvas so layout has settled.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  // <summary> shown on mobile inside <details>
  await expect(page.locator('summary').first()).toBeVisible();
});

test('at 768x1024 (tablet), no horizontal scroll and sidebar is 256px wide on the right', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await page.getByLabel('Describe your dream').fill('a neon forest');
  await page.getByRole('button', { name: /Craft My Game/i }).click();
  await page.waitForURL('**/play', { timeout: 10_000 });

  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  // Sidebar is the <aside> element; on md+ it's w-64 (256px) on the right.
  const aside = page.locator('aside').first();
  await expect(aside).toBeVisible();
  const box = await aside.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(Math.round(box.width)).toBe(256);
    // Right rail on desktop: aside is at the right edge of the viewport.
    expect(Math.round(box.x + box.width)).toBeGreaterThanOrEqual(760);
  }
});

test('corrupted localStorage gameConfig causes /play to redirect to /', async ({ page }) => {
  await page.goto('/');
  // Seed localStorage from same origin.
  await page.evaluate(() => {
    localStorage.setItem('dreamText', 'test');
    localStorage.setItem('gameConfig', '{not valid');
  });
  await page.goto('/play');
  await page.waitForURL('**/', { timeout: 5_000 });
  expect(new URL(page.url()).pathname).toBe('/');
});

test('direct hit on /play with empty localStorage redirects to /', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/play');
  await page.waitForURL('**/', { timeout: 5_000 });
  expect(new URL(page.url()).pathname).toBe('/');
});

test('direct hit on /loading-dream without dreamText redirects to /', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/loading-dream');
  await page.waitForURL('**/', { timeout: 5_000 });
  expect(new URL(page.url()).pathname).toBe('/');
});
