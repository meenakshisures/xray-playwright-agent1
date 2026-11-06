import { expect, test } from '@playwright/test';
import { LoginPage } from '../../app-model/theinternet/pages/LoginPage';
import { SecurePage } from '../../app-model/theinternet/pages/SecurePage';

// @ir-hash 123d03edb920
test('ID-1 Valid login succeeds', async ({ page }) => {
  const login = new LoginPage(page);
  await login.open();

  // @covers ID-1:ID-1-e1
  await expect(login.username).toBeVisible();
  await login.login('tomsmith', 'SuperSecretPassword!');

  // @covers ID-1:ID-1-e2
  await expect(page).toHaveURL(/\/secure$/);
  // @covers ID-1:ID-1-e2
  await expect(login.message('You logged into a secure area!')).toBeVisible();
});

// @ir-hash b87d047073ee
test('ID-2 Invalid password is rejected', async ({ page }) => {
  const login = new LoginPage(page);
  await login.open();

  // @covers ID-2:ID-2-e1
  await expect(login.username).toBeVisible();
  await login.login('tomsmith', 'wrong');

  // @covers ID-2:ID-2-e2
  await expect(login.message('Your password is invalid!')).toBeVisible();
  // @covers ID-2:ID-2-e2
  await expect(page).toHaveURL(/\/login$/);
});

// @ir-hash 3aec2c9956e5
test('ID-3 Invalid username is rejected', async ({ page }) => {
  const login = new LoginPage(page);
  await login.open();

  // @covers ID-3:ID-3-e1
  await expect(login.username).toBeVisible();
  await login.login('nobody', 'x');

  // @covers ID-3:ID-3-e2
  await expect(login.message('Your username is invalid!')).toBeVisible();
});

// @ir-hash 236044fbb163
test('ID-4 Logout returns to login', async ({ page }) => {
  const login = new LoginPage(page);
  const secure = new SecurePage(page);
  await login.open();
  await login.login('tomsmith', 'SuperSecretPassword!');

  // @covers ID-4:ID-4-e1
  await expect(page).toHaveURL(/\/secure$/);
  // @covers ID-4:ID-4-e1
  await expect(secure.heading).toHaveText('Secure Area');
  await secure.logout();

  // @covers ID-4:ID-4-e2
  await expect(page).toHaveURL(/\/login$/);
  // @covers ID-4:ID-4-e2
  await expect(login.message('You logged out of a secure area!')).toBeVisible();
});
