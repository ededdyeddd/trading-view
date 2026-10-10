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
        await page.getByTestId('nt-type-market').click();
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
        await pickMenu(page, 'nt-qty-unit', 'Risk USD'); // starts at the default, 1% of balance
        await page.getByTestId('nt-qty').click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('400');
        await expect(page.getByTestId('nt-sl-toggle')).toHaveAttribute('aria-checked', 'true'); // Risk USD turns SL on
        await page.getByTestId('nt-sl-input').fill('195.00');
        await page.getByTestId('nt-tp-toggle').click();
        await page.getByTestId('nt-tp-input').fill('207.00');
        await expect(page.getByTestId('nt-qty-caption')).toHaveText('Margin 398.00 USD · Tick 1.00 USD');
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
  // the new panel opens on Limit
  await expect(page.getByTestId('nt-type-limit')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('panel-switch-current').click();
  await expect(page.getByTestId('order-panel')).toHaveAttribute('data-variant', 'current');
  // the choice survives a reload without URL parameters; the order panel is open by default
  await page.getByTestId('panel-switch-new').click();
  await page.goto('/');
  await expect(page.getByTestId('order-panel')).toHaveAttribute('data-variant', 'new');
});

test('new · live placeholders: a click substitutes the grey value, selected, and typing replaces it', async ({ page }) => {
  await open(page, 'new');
  const qty = page.getByTestId('nt-qty');
  await expect(qty).toHaveAttribute('placeholder', '1');
  await qty.click();
  await expect(qty).toHaveValue('1');
  expect(await qty.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 1]);
  await page.keyboard.type('100');
  await expect(qty).toHaveValue('100');

  // A switched-off SL shows its default (−2% from Ask); a click turns it on with that value selected.
  const sl = page.getByTestId('nt-sl-input');
  const placeholder = await sl.getAttribute('placeholder');
  expect(placeholder).toMatch(/^\d+\.\d{2}$/);
  await sl.click({ force: true });
  await expect(page.getByTestId('nt-sl-toggle')).toHaveAttribute('aria-checked', 'true');
  expect(await sl.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart! === el.value.length && el.value.length > 0)).toBe(true);

  // Menus show live values; risk units need a stop loss.
  await page.getByTestId('nt-sl-toggle').click();
  await page.getByTestId('nt-qty-unit').click();
  await expect(page.getByRole('menuitem', { name: /Risk USD/ })).toContainText('Needs SL');
  await expect(page.getByRole('menuitem', { name: /^Shares/ })).toContainText('100');
});

test('new · risk sizing: Risk USD turns SL on; default risk 1% of balance; SL shows Risk USD / Risk % balance disabled, the TP menu is unchanged; an SL in Risk USD switches to price', async ({ page }) => {
  await open(page, 'new');
  await page.getByTestId('nt-qty').fill('100');
  await page.getByTestId('nt-sl-toggle').click();
  await pickMenu(page, 'nt-sl-unit', 'Risk USD');
  await expect(page.getByTestId('nt-sl-unit')).toContainText('Risk USD');
  const risk = await page.getByTestId('nt-sl-input').inputValue();

  await pickMenu(page, 'nt-qty-unit', 'Risk USD');
  await expect(page.getByTestId('nt-qty')).toHaveValue('1,000.00');
  // turning SL off in risk mode: no link under the field, the button names the reason
  await page.getByTestId('nt-sl-toggle').click();
  await expect(page.getByTestId('nt-qty-caption-action')).toHaveCount(0);
  await expect(page.getByTestId('nt-submit')).toContainText('Set stop loss to calculate size');
  await page.getByTestId('nt-sl-toggle').click();
  await expect(page.getByTestId('nt-sl-toggle')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('nt-sl-unit')).toContainText('price');
  await expect(page.getByTestId('nt-sl-input')).toHaveValue(/^\d+\.\d{2}$/);
  expect(await page.getByTestId('nt-sl-input').inputValue()).not.toBe(risk);

  // SL: the risk items stay in the menu but cannot be picked.
  await page.getByTestId('nt-sl-unit').click();
  for (const label of [/^Risk USD/, /^Risk % balance/]) {
    const item = page.getByRole('menuitem', { name: label });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAttribute('title', 'Not available while quantity is in Risk USD');
    await item.click({ force: true });
  }
  await expect(page.getByTestId('nt-sl-unit')).toContainText('price');
  await page.keyboard.press('Escape');

  // TP: the menu does not change.
  await page.getByTestId('nt-tp-toggle').click();
  await page.getByTestId('nt-tp-unit').click();
  for (const label of [/^Reward USD/, /^Reward % balance/]) {
    await expect(page.getByRole('menuitem', { name: label })).not.toHaveAttribute('aria-disabled', 'true');
  }
  await page.keyboard.press('Escape');
});

test.describe('new · price field defaults and validation (frozen AAPL 201.56 / 201.57)', () => {
  async function openFrozen(page: Page) {
    await page.goto('/?panel=new&freeze=1');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/?panel=new&freeze=1');
    await expect(page.getByTestId('order-panel')).toHaveAttribute('data-variant', 'new');
  }
  const price = (page: Page) => page.getByTestId('nt-price');
  const caption = (page: Page) => page.getByTestId('nt-price-caption');

  test('empty with a grey round placeholder (Limit 1%, Stop 1.5%); a click substitutes it; the button waits for a price', async ({ page }) => {
    await openFrozen(page);
    const right = page.getByTestId('order-panel');
    await expect(price(page)).toHaveValue('');
    await expect(price(page)).toHaveAttribute('placeholder', '199.00');
    await expect(right).toContainText('Ask − 2.57');
    await expect(page.getByTestId('nt-submit')).toBeDisabled();
    await expect(page.getByTestId('nt-submit')).toContainText('Enter price and quantity');
    await page.getByTestId('nt-type-stop').click();
    await expect(price(page)).toHaveAttribute('placeholder', '205.00');
    await expect(right).toContainText('Ask + 3.43');
    await page.getByTestId('nt-side-sell').click();
    await expect(price(page)).toHaveAttribute('placeholder', '198.00');
    await expect(right).toContainText('Bid − 3.56');
    await page.getByTestId('nt-type-limit').click();
    await expect(price(page)).toHaveAttribute('placeholder', '204.00');
    await expect(right).toContainText('Bid + 2.44');
    await price(page).click();
    await expect(price(page)).toHaveValue('204.00');
    await expect(caption(page)).toHaveCount(0);
  });

  test('⇆ switches price ↔ signed offset, keeps the order price and changes the label', async ({ page }) => {
    await openFrozen(page);
    const label = page.getByTestId('nt-price-label');
    const swap = page.getByTestId('nt-price-swap');
    await expect(label).toHaveText('Limit price');
    await expect(swap).toHaveAttribute('title', 'Enter as offset from Ask');
    await price(page).fill('199.00');
    await swap.click();
    await expect(label).toHaveText('Offset from Ask');
    await expect(price(page)).toHaveValue('−2.57');
    await expect(page.getByTestId('order-panel')).toContainText('199.00');
    await expect(swap).toHaveAttribute('title', 'Enter as price');
    await price(page).fill('-3');
    await expect(page.getByTestId('order-panel')).toContainText('198.57');
    await swap.click();
    await expect(label).toHaveText('Limit price');
    await expect(price(page)).toHaveValue('198.57');
    await page.getByTestId('nt-side-sell').click();
    await swap.click();
    await expect(label).toHaveText('Offset from Bid');
  });

  test('a typed price is validated 600 ms after the last keystroke, kept on a side change and re-validated', async ({ page }) => {
    await openFrozen(page);
    await price(page).fill('201.60');
    await expect(caption(page)).toHaveCount(0); // not yet committed
    await expect(caption(page)).toHaveText('Fills now: price is above Ask');
    // Buy → Sell: the value stays, now a valid Sell Limit above Bid.
    await page.getByTestId('nt-side-sell').click();
    await expect(price(page)).toHaveValue('201.60');
    await expect(caption(page)).toHaveCount(0);
    // A sell stop above Bid triggers now.
    await page.getByTestId('nt-type-stop').click();
    await expect(caption(page)).toHaveText('Triggers now: price is above Bid');
  });

  test('blur commits at once; a seen warning does not block the submit', async ({ page }) => {
    await openFrozen(page);
    await price(page).fill('202.00');
    await page.getByTestId('nt-qty').click(); // blur
    await expect(caption(page)).toHaveText('Fills now: price is above Ask', { timeout: 300 });
    await page.getByTestId('nt-qty').fill('1');
    await page.getByTestId('nt-submit').click();
    await expect.poll(() => lastOrder(page)).toMatchObject({ type: 'limit', limitPrice: 202 });
  });
});

test.describe('new · partial exits (Exit levels screen), frozen AAPL 201.56 / 201.57', () => {
  async function openFrozen(page: Page) {
    await page.goto('/?panel=new&freeze=1');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/?panel=new&freeze=1');
    await expect(page.getByTestId('order-panel')).toHaveAttribute('data-variant', 'new');
  }
  const exitOrders = (page: Page) =>
    page.evaluate(() => {
      const engine = JSON.parse(localStorage.getItem('paper-trading:v1') ?? 'null').engine;
      return engine.orders
        .filter((o: { role: string; status: string }) => o.role !== 'entry' && o.status === 'working')
        .map((o: { role: string; qty: number; limitPrice?: number; stopPrice?: number }) => [o.role, o.qty, o.limitPrice ?? o.stopPrice]);
    });

  test('"Add partial exit" opens the screen with Level 2; Confirm shows the levels on the panel; the order carries one TP / SL pair per level', async ({ page }) => {
    await openFrozen(page);
    await page.getByTestId('nt-type-market').click();
    await page.getByTestId('nt-qty').fill('100');
    await expect(page.getByTestId('nt-partial-exit')).toHaveCount(0); // only with a take profit on
    await page.getByTestId('nt-sl-toggle').click();
    await page.getByTestId('nt-tp-toggle').click();
    await page.getByTestId('nt-partial-exit').click();

    await expect(page.getByTestId('exit-levels')).toBeVisible();
    await expect(page.getByTestId('nt-levels-order')).toHaveText('Buy Market 100 @ 201.57');
    await expect(page.getByTestId('nt-l1-qty')).toHaveValue('50.00'.replace('.00', ''));
    await expect(page.getByTestId('nt-level-2-qty')).toHaveValue('50');
    // Level 2: 40 shares, its own TP / SL; Level 1 keeps 60
    await page.getByTestId('nt-level-2-qty').fill('40');
    await expect(page.getByTestId('nt-l1-qty')).toHaveValue('60');
    await page.getByTestId('nt-p2-tp-input').fill('203.00');
    await page.getByTestId('nt-p2-sl-input').fill('198.00');
    await expect(page.getByTestId('nt-levels-rr')).not.toHaveText('—');
    await page.getByTestId('nt-levels-confirm').click();

    // the Exits block now lists the levels (Figma 4135:149017) instead of the SL / TP fields
    await expect(page.getByTestId('exit-levels')).toHaveCount(0);
    await expect(page.getByTestId('nt-sl-input')).toHaveCount(0);
    await expect(page.getByTestId('nt-protected-value')).toHaveText('100.00%');
    await expect(page.getByTestId('nt-level-row-1')).toContainText('Level 1 ∙ 60%');
    await expect(page.getByTestId('nt-level-row-2')).toContainText('TP 40 @ 203.00 ∙ SL 40 @ 198.00');
    await expect(page.getByTestId('nt-summary')).toContainText('2 exits');
    await expect(page.getByTestId('nt-summary')).toContainText('TP up to +');
    await page.getByTestId('nt-submit').click();
    const orders = await exitOrders(page);
    expect(orders).toContainEqual(['tp', 40, 203]);
    expect(orders).toContainEqual(['sl', 40, 198]);
    expect(orders.filter((o: [string, number]) => o[1] === 60)).toHaveLength(2);
  });

  test('trash on a level removes it; trash on Level 1 promotes the next level; the last trash brings back the SL / TP fields', async ({ page }) => {
    await openFrozen(page);
    await page.getByTestId('nt-type-market').click();
    await page.getByTestId('nt-qty').fill('100');
    await page.getByTestId('nt-sl-toggle').click();
    await page.getByTestId('nt-tp-toggle').click();
    await page.getByTestId('nt-partial-exit').click();
    await page.getByTestId('nt-levels-confirm').click();
    await page.getByTestId('nt-partial-exit').click(); // a third level
    await page.getByTestId('nt-levels-confirm').click();
    await expect(page.getByTestId('nt-level-row-3')).toBeVisible();
    await page.getByTestId('nt-level-row-3-remove').click();
    await expect(page.getByTestId('nt-level-row-3')).toHaveCount(0);
    await page.getByTestId('nt-level-row-1-remove').click(); // Level 2 becomes the only level
    await expect(page.getByTestId('nt-level-row-1')).toHaveCount(0);
    await expect(page.getByTestId('nt-sl-input')).toBeVisible();
  });

  test('Discard restores the exits; shares ⇆ % keeps the quantity; a level over the position blocks Confirm', async ({ page }) => {
    await openFrozen(page);
    await page.getByTestId('nt-type-market').click();
    await page.getByTestId('nt-qty').fill('100');
    await page.getByTestId('nt-sl-toggle').click();
    await page.getByTestId('nt-tp-toggle').click();
    await page.getByTestId('nt-partial-exit').click();
    await page.getByTestId('nt-level-2-swap').click();
    await expect(page.getByTestId('nt-level-2-qty')).toHaveValue('50.00');
    await page.getByTestId('nt-level-2-qty').fill('100');
    await expect(page.getByTestId('nt-levels-confirm')).toBeDisabled();
    await expect(page.getByTestId('nt-levels-error')).toHaveText('Level 1 has no shares left');
    await page.getByTestId('nt-levels-discard').click();
    await expect(page.getByTestId('nt-sl-input')).toBeVisible(); // Discard: back to the plain SL / TP fields
    await expect(page.getByTestId('nt-submit')).toBeEnabled();
  });
});
