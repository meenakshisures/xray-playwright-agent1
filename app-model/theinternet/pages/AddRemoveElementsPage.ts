import type { Locator, Page } from '@playwright/test';

export class AddRemoveElementsPage {
  readonly addElementButton: Locator;
  readonly deleteButtons: Locator;

  constructor(private readonly page: Page) {
    this.addElementButton = page.getByRole('button', { name: 'Add Element' });
    this.deleteButtons = page.getByRole('button', { name: 'Delete' });
  }

  async open(): Promise<void> {
    await this.page.goto('/add_remove_elements/');
  }

  async addElement(): Promise<void> {
    await this.addElementButton.click();
  }
}
