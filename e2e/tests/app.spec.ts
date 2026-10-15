import { expect, test } from '@playwright/test';

// Set on window before a navigation: it survives only if Inertia swaps the
// page client-side instead of the browser loading a new document.
const markWindow = () => {
  (window as Window & { inertiaMarker?: boolean }).inertiaMarker = true;
};
const readMarker = () =>
  (window as Window & { inertiaMarker?: boolean }).inertiaMarker === true;

// React separates adjacent text nodes with <!-- --> and Vue marks fragments with
// comments, so the raw HTML is compared without them
const HTML_COMMENT = /<!--.*?-->/g;
const SSR_HEADING = /<h1>Hello from \w+<\/h1>/;
const HOME_HEADING = /Hello from \w+/;

test.describe('server-side rendering', () => {
  test('sends the rendered page in the initial HTML', async ({ request }) => {
    const response = await request.get('/');
    const html = await response.text();

    expect(html).toContain('data-server-rendered');
    expect(html.replaceAll(HTML_COMMENT, '')).toMatch(SSR_HEADING);
  });

  test('does not serve the build manifest', async ({ request }) => {
    // The server reads it at build time; serving it would list every page
    // and source path
    const response = await request.get('/.vite/manifest.json');

    expect(response.status()).toBe(404);
  });

  test('hydrates the server-rendered page', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      HOME_HEADING,
    );
    await expect(page.getByTestId('app-name')).not.toBeEmpty();
  });
});

test.describe('navigation', () => {
  test('visits pages without a full reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(markWindow);

    await page.getByRole('link', { name: 'Users' }).click();

    await expect(page).toHaveURL('/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    expect(await page.evaluate(readMarker)).toBe(true);
  });

  test('restores the previous page on back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL('/users');

    await page.goBack();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      HOME_HEADING,
    );
  });
});

test.describe('props', () => {
  test('loads deferred props after the page renders', async ({ page }) => {
    await page.goto('/users');

    await expect(page.getByTestId('activity')).toContainText('Ada signed in');
  });

  test('fetches optional props on a partial reload', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByTestId('stats')).toHaveCount(0);

    await page.getByRole('button', { name: 'Load stats' }).click();

    await expect(page.getByTestId('stats')).toHaveText('9 users in total');
  });

  test('appends merge props instead of replacing them', async ({ page }) => {
    await page.goto('/users');
    const users = page.getByTestId('users').getByRole('listitem');
    await expect(users).toHaveCount(3);

    await page.getByRole('button', { name: 'Load more' }).click();

    await expect(users).toHaveCount(6);
    await expect(users.first()).toHaveText('Ada Lovelace');
  });
});

test.describe('forms', () => {
  test('shows validation errors', async ({ page }) => {
    await page.goto('/contact');

    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByTestId('error')).toHaveText('Name is required');
  });

  test('redirects with a flash message after a valid submit', async ({
    page,
  }) => {
    await page.goto('/contact');

    await page.getByLabel('Name').fill('Ada');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('flash')).toHaveText('Thanks, Ada');
  });

  test('shows a flash message only once', async ({ page }) => {
    await page.goto('/contact');
    await page.getByLabel('Name').fill('Ada');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('flash')).toBeVisible();

    await page.reload();

    await expect(page.getByTestId('flash')).toHaveCount(0);
  });
});
