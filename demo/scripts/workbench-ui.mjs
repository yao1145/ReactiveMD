/** Actions kept behind More options in the compact workbench. */
export async function clickWorkbenchAction(page, name) {
  const options = page.locator('.workbench-options');
  const button = options.getByRole('button', {name, exact: typeof name === 'string'});
  if (!await button.isVisible()) {
    if (!await options.evaluate(element => element.open)) await options.locator(':scope > summary').click();
  }
  await button.click();
}
