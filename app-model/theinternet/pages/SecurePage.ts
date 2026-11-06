import type { Locator, Page } from '@playwright/test';

export class SecurePage {
  readonly heading: Locator;
  readonly logoutLink: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Secure Area', exact: true });
    this.logoutLink = page.getByRole('link', { name: 'Logout', exact: true });
  }

  async logout(): Promise<void> {
    await this.logoutLink.click();
  }
}
