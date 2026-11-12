// Custom actions for the bug demo, referenced from narration.json with { "call": "<name>" }.

import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./app/index.html', import.meta.url), 'utf8');

/** Serve the demo app at http://demo.local and make the save endpoint fail slowly. */
export async function mockServer(page) {
  await page.route('http://demo.local/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/passengers') {
      await new Promise((r) => setTimeout(r, 14000));
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"name too long"}' });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
}
