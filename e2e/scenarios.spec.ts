/**
 * The three test scenarios (PRD, Appendix C) in both panels, end to end: open the ticket, fill it through
 * the panel UI, submit, and check the order the paper engine received. Plus the floating panel switch.
 */
import { expect, test, type Page } from '@playwright/test';

type Panel = 'current' | 'new';
type Order = { side: string; type: string; qty: number; limitPrice?: number; stopLoss?: number; takeProfit?: number; tif: string; role: string };

async function open(page: Page, panel: Panel) {
  await page.goto(`/?panel=${panel}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/?panel=${panel}`);
  await page.getByTestId('bottom-trade').click();
  await expect(page.getByTestId('order-panel')).toHaveAttribute('data-variant', panel);
}

/** The last entry order the engine accepted. */
async function lastOrder(page: Page): Promise<Order> {
  return page.evaluate(() => {
    const engine = JSON.parse(localStorage.getItem('paper-trading:v1') ?? 'null').engine;
    return engine.orders.filter((o: { role: string; status: string }) => o.role === 'entry' && o.status !== 'rejected').at(-1);
  });
}

async function pickMenu(page: Page, trigger: string, label: string) {
  await page.getByTestId(trigger).click();
  await page.getByRole('menuitem', { name: label, exact: false }).first().click();
}

async function bid(page: Page, testId: string) {
  return Number((await page.getByTestId(testId).locator('span').last().innerText()).replace(/,/g, ''));
}

const scenarios: { title: string; flows: Record<Panel, (page: Page) => Promise<number | void>>; check: (o: Order, bidAtSubmit?: number) => void }[] = [
  {
    title: '1 · buy 100 AAPL at market, SL 197.50, TP 211.00',
    flows: {
      new: async (page) => {
        await page.getByTestId('nt-qty').fill('100');
        await page.getByTestId('nt-sl-toggle').click();
        await page.getByTestId('nt-sl-input').fill('197.50');
        await page.getByTestId('nt-tp-toggle').click();
        await page.getByTestId('nt-tp-input').fill('211.00');
        await page.getByTestId('nt-submit').click();
      },
      current: async (page) => {
        await page.getByTestId('type-market').click();
        await page.getByTestId('qty-input').fill('100');
        await page.getByTestId('sl-toggle').click();
        await pickMenu(page, 'sl-unit', 'Price');
        await page.getByTestId('sl-input').fill('197.50');
        await page.getByTestId('tp-toggle').click();
        await page.getByTestId('tp-input').fill('211.00');
        await page.getByTestId('submit-order').click();
      },
    },
    check: (o) => expect(o).toMatchObject({ side: 'buy', type: 'market', qty: 100, stopLoss: 197.5, takeProfit: 211 }),
  },
  {
    title: '2 · buy limit 199.00 risking 400 USD, SL 195.00, TP 207.00',
    flows: {
      new: async (page) => {
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
      current: async (page) => {
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
    },
    check: (o) => expect(o).toMatchObject({ side: 'buy', type: 'limit', qty: 100, limitPrice: 199, stopLoss: 195, takeProfit: 207, tif: 'week' }),
  },
  {
    title: '3 · sell limit 1 USD above the market for a week',
    flows: {
      new: async (page) => {
        await page.getByTestId('nt-side-sell').click();
        await page.getByTestId('nt-type-limit').click();
        await page.getByTestId('nt-price').fill(((await bid(page, 'nt-side-sell')) + 1).toFixed(2));
        await page.getByTestId('nt-qty').fill('10');
        const b = await bid(page, 'nt-side-sell');
        await page.getByTestId('nt-submit').click();
        return b;
      },
      current: async (page) => {
        await page.getByTestId('side-sell').click();
        await page.getByTestId('type-limit').click();
        await page.getByTestId('price-input').fill(((await bid(page, 'side-sell')) + 1).toFixed(2));
        const b = await bid(page, 'side-sell');
        await page.getByTestId('submit-order').click();
        return b;
      },
    },
    check: (o, b) => {
      expect(o).toMatchObject({ side: 'sell', type: 'limit', tif: 'week' });
      // the simulated market moves while the fields are filled
      expect(Math.abs((o.limitPrice ?? 0) - ((b ?? 0) + 1))).toBeLessThanOrEqual(0.25);
    },
  },
];

for (const panel of ['current', 'new'] as const) {
  for (const s of scenarios) {
    test(`${panel} · ${s.title}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await open(page, panel);
      const b = await s.flows[panel](page);
      await expect.poll(() => lastOrder(page)).toBeTruthy();
      s.check(await lastOrder(page), b ?? undefined);
      await page.screenshot({ path: `e2e-results/${panel}-scenario-${s.title[0]}.png` });
      expect(errors).toEqual([]);
    });
  }
}

test('floating switch toggles the order panel; the panel is open by default', async ({ page }) => {
  await open(page, 'current');
  await page.getByTestId('panel-switch-new').click();
  await expect(page.getByTestId('order-panel')).toHaveAttribute('data-variant', 'new');
  await expect(page.getByTestId('nt-type-market')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('panel-switch-current').click();
  await expect(page.getByTestId('order-panel')).toHaveAttribute('data-variant', 'current');
  // the choice survives a reload without URL parameters; the order panel is open by default
  await page.getByTestId('panel-switch-new').click();
  await page.goto('/');
  await expect(page.getByTestId('order-panel')).toHaveAttribute('data-variant', 'new');
});
