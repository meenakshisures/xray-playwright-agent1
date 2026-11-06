import type { Locator, Page } from '@playwright/test';

export class CheckboxesPage {
  readonly first: Locator;
  readonly second: Locator;

  constructor(private readonly page: Page) {
    const checkboxes = page.getByRole('checkbox');
    this.first = checkboxes.nth(0);
    this.second = checkboxes.nth(1);
  }

  async open(): Promise<void> {
    await this.page.goto('/checkboxes');
  }
}
