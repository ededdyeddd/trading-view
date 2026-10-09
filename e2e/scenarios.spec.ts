/**
 * The three study scenarios (PRD, Appendix C, block 9) in both panels, end to end:
 * study setup → run → submit through the panel UI → Done → auto-check says "yes".
 * Also compares the time to submit the Market order (scenario 1) between the panels.
 */
import { expect, test, type Page } from '@playwright/test';

type Panel = 'current' | 'new';

async function startRun(page: Page, panel: Panel, scenario: 1 | 2 | 3, pid: string) {
  await page.goto('/?study=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?study=1');
  await page.getByTestId('study-pid').fill(pid);
  await page.getByTestId(`study-panel-${panel}`).check();
  // keep only the scenario under test
  const boxes = page.locator('input[type=checkbox]');
  for (let i = 0; i < 3; i++) if (i + 1 !== scenario) await boxes.nth(i).uncheck();
  await page.getByTestId('study-start').click();
  await expect(page.getByTestId('study-task')).toBeVisible();
  // open the order ticket from the bottom panel
  await page.getByTestId('bottom-trade').click();
  await expect(page.getByTestId('order-panel')).toBeVisible();
}

async function finish(page: Page) {
  await page.getByTestId('study-done').click();
  await expect(page.getByTestId('study-results')).toBeVisible();
  return page.evaluate(() => JSON.parse(localStorage.getItem('study:v1') ?? 'null'));
}

async function pickMenu(page: Page, trigger: string, label: string) {
  await page.getByTestId(trigger).click();
  await page.getByRole('menuitem', { name: label, exact: false }).first().click();
}

const flows: Record<Panel, Record<1 | 2 | 3, (page: Page) => Promise<void>>> = {
  new: {
    1: async (page) => {
      await page.getByTestId('nt-qty').fill('100');
      await page.getByTestId('nt-sl-toggle').click();
      await page.getByTestId('nt-sl-input').fill('197.50');
      await page.getByTestId('nt-tp-toggle').click();
      await page.getByTestId('nt-tp-input').fill('211.00');
      await page.getByTestId('nt-submit').click();
    },
    2: async (page) => {
      await page.getByTestId('nt-type-limit').click();
      await page.getByTestId('nt-price').fill('199.00');
      await pickMenu(page, 'nt-qty-unit', 'Risk USD');
      await page.getByTestId('nt-qty').fill('400');
      await page.getByTestId('nt-qty-caption-action').click(); // "Turn on stop loss to calculate shares"
      await page.getByTestId('nt-sl-input').fill('195.00');
      await page.getByTestId('nt-tp-toggle').click();
      await page.getByTestId('nt-tp-input').fill('207.00');
      await expect(page.getByTestId('nt-qty-caption')).toHaveText('Real risk 400.00 USD · Margin 398.00 USD');
      await expect(page.getByTestId('nt-submit')).toContainText('100 AAPL · LMT 199.00 · till');
      await page.getByTestId('nt-submit').click();
    },
    3: async (page) => {
      await page.getByTestId('nt-side-sell').click();
      await page.getByTestId('nt-type-limit').click();
      const bid = Number((await page.getByTestId('nt-side-sell').locator('span').last().innerText()).replace(/,/g, ''));
      await page.getByTestId('nt-price').fill((bid + 1).toFixed(2));
      await page.getByTestId('nt-qty').fill('10');
      await page.getByTestId('nt-submit').click();
    },
  },
  current: {
    1: async (page) => {
      await page.getByTestId('type-market').click();
      await page.getByTestId('qty-input').fill('100');
      await page.getByTestId('sl-toggle').click();
      await pickMenu(page, 'sl-unit', 'Price');
      await page.getByTestId('sl-input').fill('197.50');
      await page.getByTestId('tp-toggle').click();
      await page.getByTestId('tp-input').fill('211.00');
      await page.getByTestId('submit-order').click();
    },
    2: async (page) => {
      await page.getByTestId('type-limit').click();
      await page.getByTestId('price-input').fill('199.00');
      await pickMenu(page, 'qty-unit', 'Risk USD');
      await page.getByTestId('qty-input').fill('400');
      await page.getByTestId('sl-toggle').click();
      await pickMenu(page, 'sl-unit', 'Price');
      await page.getByTestId('sl-input').fill('195.00');
      await page.getByTestId('tp-toggle').click();
      await page.getByTestId('tp-input').fill('207.00');
      await page.getByTestId('submit-order').click();
    },
    3: async (page) => {
      await page.getByTestId('side-sell').click();
      await page.getByTestId('type-limit').click();
      const bid = Number((await page.getByTestId('side-sell').locator('span').last().innerText()).replace(/,/g, ''));
      await page.getByTestId('price-input').fill((bid + 1).toFixed(2));
      await page.getByTestId('submit-order').click();
    },
  },
};

const timings: Record<Panel, number | null> = { current: null, new: null };
const all: string[] = [];

for (const panel of ['current', 'new'] as const) {
  for (const scenario of [1, 2, 3] as const) {
    test(`${panel} · scenario ${scenario}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

      await startRun(page, panel, scenario, `e2e-${panel}-${scenario}`);
      await flows[panel][scenario](page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e-results/${panel}-scenario-${scenario}.png` });
      const session = await finish(page);
      const run = session.runs[0];
      expect(run.result, JSON.stringify(run.lastDraft)).toMatchObject({ pass: true, mismatches: [] });
      expect(run.submits).toBe(1);
      if (scenario === 1) timings[panel] = run.msOpenToSubmit;
      all.push(`${panel} · scenario ${scenario}: open → submit ${run.msOpenToSubmit} ms, validation errors ${run.validationErrors}`);

      // the journal exports
      const csv = await page.evaluate(async () => (await import('/src/study/studyStore.ts')).sessionCsv(JSON.parse(localStorage.getItem('study:v1')!)));
      expect(csv.split('\n')[1]).toContain(`${panel},${scenario},yes`);
      expect(errors).toEqual([]);
    });
  }
}

test('Market: time to submit in `new` is not worse than in `current`', async () => {
  test.skip(timings.current === null || timings.new === null, 'scenario 1 runs did not record timings');
  console.log(all.join('\n'));
  console.log(`time open → submit, scenario 1: current ${timings.current} ms, new ${timings.new} ms`);
  expect(timings.new!).toBeLessThanOrEqual(timings.current!);
});
