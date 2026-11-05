import { expect, test } from '@playwright/test';
import { menu } from './helpers';

// ADR-084 / 086: dragging in the colour picker is one undo step per use of the picker, also when
// the colour input keeps its focus between two uses (no new focus event).
test('each use of the track colour picker is one undo step', async ({ page }) => {
  await page.goto('/');
  const color = page.locator('.inspector input[type="color"]');
  await expect(color).toBeVisible();
  const original = await color.inputValue();
  const pick = async (values: string[]) => {
    // live "input" events while dragging, then the native "change" when the picker closes
    await color.evaluate((el: HTMLInputElement, vs: string[]) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (const v of vs) {
        set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, values);
  };
  await color.focus();
  await pick(['#ff0000', '#ee0000', '#dd0000']);
  await pick(['#0000ff', '#0000ee']); // focus never left the input
  await expect(color).toHaveValue('#0000ee');
  await menu(page, '編集', /^元に戻す/);
  await expect(color).toHaveValue('#dd0000');
  await menu(page, '編集', /^元に戻す/);
  await expect(color).toHaveValue(original);
});
