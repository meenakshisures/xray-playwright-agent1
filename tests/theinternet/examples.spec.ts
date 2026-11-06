import { expect, test } from '@playwright/test';
import { AddRemoveElementsPage } from '../../app-model/theinternet/pages/AddRemoveElementsPage';
import { CheckboxesPage } from '../../app-model/theinternet/pages/CheckboxesPage';
import { DropdownPage } from '../../app-model/theinternet/pages/DropdownPage';

// @ir-hash 5ed9a7576a7a
test('ID-5 Add and remove elements', async ({ page }) => {
  const elements = new AddRemoveElementsPage(page);
  await elements.open();

  // @covers ID-5:ID-5-e1
  await expect(elements.addElementButton).toBeVisible();
  // @covers ID-5:ID-5-e1
  await expect(elements.deleteButtons).toHaveCount(0);

  await elements.addElement();
  await elements.addElement();

  // @covers ID-5:ID-5-e2
  await expect(elements.deleteButtons).toHaveCount(2);
  await elements.deleteButtons.first().click();

  // @covers ID-5:ID-5-e3
  await expect(elements.deleteButtons).toHaveCount(1);
});

// @ir-hash f4c2cb72dda0
test('ID-6 Checkbox states', async ({ page }) => {
  const checkboxes = new CheckboxesPage(page);
  await checkboxes.open();

  // @covers ID-6:ID-6-e1
  await expect(checkboxes.first).not.toBeChecked();
  // @covers ID-6:ID-6-e1
  await expect(checkboxes.second).toBeChecked();

  await checkboxes.first.click();
  await checkboxes.second.click();

  // @covers ID-6:ID-6-e2
  await expect(checkboxes.first).toBeChecked();
  // @covers ID-6:ID-6-e2
  await expect(checkboxes.second).not.toBeChecked();
});

// @ir-hash c8e7b93683e7
test('ID-7 Dropdown selection', async ({ page }) => {
  const dropdown = new DropdownPage(page);
  await dropdown.open();

  // @covers ID-7:ID-7-e1
  await expect(dropdown.placeholderOption).toHaveJSProperty('selected', true);
  await dropdown.selectOption2();

  // @covers ID-7:ID-7-e2
  await expect(dropdown.option2).toHaveJSProperty('selected', true);
});
