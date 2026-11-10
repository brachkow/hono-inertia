import { readFile, writeFile } from 'node:fs/promises';
import { test as base, expect } from '@playwright/test';
import type { ExampleOptions } from '../playwright.config';

const test = base.extend<ExampleOptions>({
  homePage: ['', { option: true }],
});

const ORIGINAL_HEADING = /Hello from/;
const EDITED_HEADING = /Hot reload from/;

const markWindow = () => {
  (window as Window & { inertiaMarker?: boolean }).inertiaMarker = true;
};
const readMarker = () =>
  (window as Window & { inertiaMarker?: boolean }).inertiaMarker === true;

// The dev server's HTML must keep /@vite/client and, for React, the Refresh
// preamble, or edits only show up after a manual reload
test('updates a page in place after its source changes', async ({
  page,
  homePage,
}) => {
  const file = new URL(`../../${homePage}`, import.meta.url);
  const original = await readFile(file, 'utf8');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    ORIGINAL_HEADING,
  );
  await page.evaluate(markWindow);

  try {
    await writeFile(file, original.replace('Hello from', 'Hot reload from'));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      EDITED_HEADING,
    );
    expect(await page.evaluate(readMarker)).toBe(true);
  } finally {
    await writeFile(file, original);
  }
});
