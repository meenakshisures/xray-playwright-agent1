import type { Locator, Page } from '@playwright/test';

export class DropdownPage {
  readonly dropdown: Locator;
  readonly placeholderOption: Locator;
  readonly option2: Locator;

  constructor(private readonly page: Page) {
    this.dropdown = page.getByRole('combobox');
    this.placeholderOption = this.dropdown.getByRole('option', { name: 'Please select an option' });
    this.option2 = this.dropdown.getByRole('option', { name: 'Option 2' });
  }

  async open(): Promise<void> {
    await this.page.goto('/dropdown');
  }

  async selectOption2(): Promise<void> {
    await this.dropdown.selectOption({ label: 'Option 2' });
  }
}
