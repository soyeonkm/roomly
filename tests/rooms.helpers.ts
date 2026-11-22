import { expect, type Page } from '@playwright/test'

export const testName = (label: string) => `__test-${Date.now()}__ ${label}`

/** Create a room through the dashboard; returns its id. */
export async function createRoom(page: Page, name: string, widthM = '4', lengthM = '3.5') {
  await page.goto('/rooms')
  const form = page.getByTestId('create-room-form')
  await form.getByLabel('Name').fill(name)
  await form.getByLabel('Width (m)').fill(widthM)
  await form.getByLabel('Length (m)').fill(lengthM)
  await expect(form.getByRole('button', { name: 'Create room' })).toBeEnabled({ timeout: 15_000 })
  await form.getByRole('button', { name: 'Create room' }).click()
  await page.waitForURL(/\/rooms\/[^/]+$/, { timeout: 15_000 })
  await expect(page.getByTestId('room-title')).toHaveText(name)
  return page.url().split('/rooms/')[1]
}

/** Wait until the canvas AUTH frame says this user can write (poll, don't actionability-wait). */
export async function waitEditable(page: Page) {
  await expect
    .poll(() => page.getByTestId('room-editor').getAttribute('data-can-write'), { timeout: 30_000, intervals: [500] })
    .toBe('true')
}

export async function deleteRooms(page: Page, names: string[]) {
  await page.goto('/rooms')
  page.on('dialog', (d) => d.accept())
  for (const name of names) {
    const btn = page.getByRole('button', { name: `Delete ${name}` })
    try {
      await btn.click({ force: true, timeout: 10_000 })
      await expect(btn).toHaveCount(0, { timeout: 10_000 })
    } catch { /* best-effort cleanup */ }
  }
}

/** Drag an element by (dx, dy) screen pixels. */
export async function dragBy(page: Page, selector: ReturnType<Page['locator']>, dx: number, dy: number) {
  const box = await selector.boundingBox()
  if (!box) throw new Error('element not visible')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 })
  await page.mouse.move(x + dx, y + dy, { steps: 5 })
  await page.mouse.up()
}
