import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const STORY = '/iframe.html?id=demo--basic&viewMode=story';
const MANAGER = '/?path=/story/demo--basic';
const FETCHED = ['themes.json', 'default.json', 'locales.json'] as const;

// Tests share one Storybook per project; the last one edits a file, so keep them in order.
test.describe.configure({ mode: 'serial' });

interface Tracked {
  requests: Record<(typeof FETCHED)[number], number>;
  addonErrors: string[];
}

/** Counts requests for the fixture's JSON files and collects errors logged by the addon. */
function track(target: Page | BrowserContext): Tracked {
  const tracked: Tracked = { requests: { 'themes.json': 0, 'default.json': 0, 'locales.json': 0 }, addonErrors: [] };
  target.on('request', (request) => {
    const name = path.basename(new URL(request.url()).pathname) as (typeof FETCHED)[number];
    if (FETCHED.includes(name)) tracked.requests[name]++;
  });
  const listen = (page: Page) =>
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('[async-globals]')) {
        tracked.addonErrors.push(message.text());
      }
    });
  if ('newPage' in target) target.on('page', listen);
  else listen(target);
  return tracked;
}

async function readStory(page: Page) {
  const themed = page.locator('#themed');
  await themed.waitFor({ timeout: 30_000 });
  return {
    theme: await themed.getAttribute('data-theme'),
    color: await themed.getAttribute('data-color'),
    themes: await themed.getAttribute('data-themes'),
    locales: await themed.getAttribute('data-locales'),
    story: await page.locator('#story').textContent(),
  };
}

const RESOLVED = {
  theme: 'forest',
  color: 'rgb(0, 128, 0)',
  themes: '2',
  locales: 'English (fallback)',
  story: 'story theme: forest',
};

test('resolves the functions before the story renders', async ({ page }) => {
  const tracked = track(page);

  await page.goto(STORY);

  expect(await readStory(page)).toEqual(RESOLVED);
  expect(tracked.requests).toEqual({ 'themes.json': 1, 'default.json': 1, 'locales.json': 1 });
  expect(tracked.addonErrors).toEqual([]);
});

test('a refresh reuses cached values and a new session fetches again', async ({ page, browser }) => {
  await page.goto(STORY);
  await readStory(page);
  const tracked = track(page);

  await page.reload();

  expect(await readStory(page)).toEqual(RESOLVED);
  expect(tracked.requests).toEqual({ 'themes.json': 0, 'default.json': 0, 'locales.json': 0 });

  const session = await browser.newContext();
  try {
    const fresh = track(session);
    const freshPage = await session.newPage();
    await freshPage.goto(STORY);

    expect(await readStory(freshPage)).toEqual(RESOLVED);
    expect(fresh.requests).toEqual({ 'themes.json': 1, 'default.json': 1, 'locales.json': 1 });
  } finally {
    await session.close();
  }
});

test('ignores and removes values cached by an earlier launch', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      sessionStorage.setItem('async-globals:earlier-launch:initialGlobals.theme', '"ocean"');
      sessionStorage.setItem('async-globals:earlier-launch:globals.theme', '"ocean"');
    }
  });

  await page.goto(STORY);

  expect(await readStory(page)).toEqual(RESOLVED);
  const keys = await page.evaluate(() => Object.keys(sessionStorage));
  expect(keys.filter((key) => key.includes('earlier-launch'))).toEqual([]);
  expect(keys.filter((key) => key.startsWith('async-globals:')).length).toBeGreaterThan(0);
});

test('the toolbar lists the loaded items and selecting one updates the story', async ({ page }) => {
  const tracked = track(page);
  await page.goto(MANAGER);
  const preview = page.frameLocator('#storybook-preview-iframe');
  await preview.locator('#themed').waitFor({ timeout: 30_000 });

  // Storybook 7–9 label toolbar buttons with `title`, Storybook 10 with `aria-label` (which includes the selection).
  await page.locator('button[title="Theme"], button[aria-label^="Theme"]').first().click();
  await expect(page.getByText('Forest', { exact: true }).first()).toBeVisible();
  await page.getByText('Ocean', { exact: true }).first().click();

  await expect(preview.locator('#themed')).toHaveAttribute('data-theme', 'ocean');
  await expect(preview.locator('#themed')).toHaveAttribute('data-color', 'rgb(0, 0, 255)');

  await page.locator('button[title="Locale"], button[aria-label^="Locale"]').first().click();
  await expect(page.getByText('English (fallback)', { exact: true }).first()).toBeVisible();
  expect(tracked.addonErrors).toEqual([]);
});

test('editing preview.tsx in dev reloads with resolved globals', async ({ page }, testInfo) => {
  const { fixture, mode } = testInfo.project.metadata as { fixture: string; mode: string };
  test.skip(mode !== 'dev', 'dev server only');

  const file = path.join('fixtures', fixture, '.storybook', 'preview.tsx');
  const original = fs.readFileSync(file, 'utf8');
  const tracked = track(page);
  await page.goto(STORY);
  await readStory(page);

  try {
    fs.writeFileSync(file, original.replace('data-version="1"', 'data-version="2"'));
    await expect(page.locator('#themed[data-version="2"]')).toBeVisible({ timeout: 30_000 });
    expect(await readStory(page)).toEqual(RESOLVED);
  } finally {
    fs.writeFileSync(file, original);
  }
  // Let the restore finish reloading before the server is stopped.
  await expect(page.locator('#themed[data-version="1"]')).toBeVisible({ timeout: 30_000 });
  expect(tracked.addonErrors).toEqual([]);
});
