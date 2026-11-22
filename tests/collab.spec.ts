/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { createRoom, deleteRooms, dragBy, testName, waitEditable } from './rooms.helpers'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('API status page renders loading success and error states', async ({ users }) => {
  const [user] = await users(1)
  let shouldFail = false
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    if (shouldFail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
      })
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()
  await expect(user.page.getByText('2 integrations available.')).toBeVisible()

  shouldFail = true
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect(user.page.getByText('Catalog unavailable')).toBeVisible()
  await expect(user.page.getByText('Showing the last loaded catalog')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('API status page shows local retry after first-load API failure', async ({ users }) => {
  const [user] = await users(1)
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Could not load API data')).toBeVisible()
  await expect(user.page.getByText('Retried 1 time automatically.')).toBeVisible()

  const retryButton = user.page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

// ---------------------------------------------------------------------------
// Roomly: realtime room editing
// ---------------------------------------------------------------------------

test('two users edit the same room layout in real time', async ({ users }) => {
  test.setTimeout(120_000)
  const [a, b] = await users(2)
  const name = testName('Shared bedroom')
  try {
    const id = await createRoom(a.page, name)
    await waitEditable(a.page)

    // B opens the shared URL and can edit too (authenticated-link model).
    await b.page.goto(`/rooms/${id}`)
    await expect(b.page.getByTestId('room-title')).toHaveText(name)
    await waitEditable(b.page)

    // Presence: each sees the other.
    await expect(a.page.getByTestId('peer-avatars')).toBeVisible({ timeout: 15_000 })
    await expect(b.page.getByTestId('peer-avatars')).toBeVisible({ timeout: 15_000 })

    // A adds a bed -> B sees it.
    await a.page.getByTestId('add-bed').click()
    const aBed = a.page.locator('[data-testid="furniture"][data-kind="bed"]')
    const bBed = b.page.locator('[data-testid="furniture"][data-kind="bed"]')
    await expect(aBed).toHaveCount(1)
    await expect(bBed).toHaveCount(1, { timeout: 10_000 })

    // A drags it -> B sees the new position (room coordinates, not pixels).
    const before = await aBed.getAttribute('data-x')
    await dragBy(a.page, aBed, -120, 0)
    await expect.poll(() => aBed.getAttribute('data-x')).not.toBe(before)
    const movedX = await aBed.getAttribute('data-x')
    await expect.poll(() => bBed.getAttribute('data-x'), { timeout: 10_000 }).toBe(movedX)

    // A rotates -> B sees rotation.
    await a.page.getByTestId('rotate-right').click()
    await expect(aBed).toHaveAttribute('data-rot', '90')
    await expect(bBed).toHaveAttribute('data-rot', '90', { timeout: 10_000 })

    // B adds a desk (auto-selected) -> A sees it; B deletes it -> A sees it gone.
    const aDesk = a.page.locator('[data-testid="furniture"][data-kind="desk"]')
    await b.page.getByTestId('add-desk').click()
    await expect(aDesk).toHaveCount(1, { timeout: 10_000 })
    await b.page.getByTestId('delete-item').click()
    await expect(aDesk).toHaveCount(0, { timeout: 10_000 })
    await expect(aBed).toHaveCount(1)

    // The room now appears on B's dashboard under "Shared with you".
    await b.page.goto('/rooms')
    await expect(b.page.getByText('Shared with you')).toBeVisible({ timeout: 15_000 })
    await expect(b.page.getByTestId('room-card').filter({ hasText: name })).toBeVisible()
  } finally {
    await deleteRooms(a.page, [name])
  }
})

test('layout persists across refresh, and separate rooms do not share furniture', async ({ users }) => {
  test.setTimeout(120_000)
  const [a] = await users(1)
  const n1 = testName('Room one')
  const n2 = testName('Room two')
  try {
    const id1 = await createRoom(a.page, n1)
    await waitEditable(a.page)
    await a.page.getByTestId('add-sofa').click()
    const sofa = a.page.locator('[data-testid="furniture"][data-kind="sofa"]')
    await expect(sofa).toHaveCount(1)
    await dragBy(a.page, sofa, 0, 80)
    await a.page.getByTestId('rotate-right').click()
    await expect(sofa).toHaveAttribute('data-rot', '90')
    const y = await sofa.getAttribute('data-y')

    // Refresh: same position and rotation come back from the CanvasRoom.
    await a.page.reload()
    await expect(sofa).toHaveCount(1, { timeout: 15_000 })
    await expect(sofa).toHaveAttribute('data-rot', '90')
    await expect(sofa).toHaveAttribute('data-y', y!)

    // A second room starts empty and its edits don't leak into the first.
    const id2 = await createRoom(a.page, n2)
    expect(id2).not.toBe(id1)
    await waitEditable(a.page)
    await expect(a.page.getByTestId('furniture')).toHaveCount(0)
    await a.page.getByTestId('add-chair').click()
    await expect(a.page.getByTestId('furniture')).toHaveCount(1)

    await a.page.goto(`/rooms/${id1}`)
    await expect(a.page.locator('[data-testid="furniture"][data-kind="sofa"]')).toHaveCount(1, { timeout: 15_000 })
    await expect(a.page.locator('[data-testid="furniture"][data-kind="chair"]')).toHaveCount(0)
  } finally {
    await deleteRooms(a.page, [n1, n2])
  }
})

test('undo reverts the last move for the user who made it', async ({ users }) => {
  test.setTimeout(90_000)
  const [a] = await users(1)
  const name = testName('Undo room')
  try {
    await createRoom(a.page, name)
    await waitEditable(a.page)
    await a.page.getByTestId('add-chair').click()
    const chair = a.page.locator('[data-testid="furniture"][data-kind="chair"]')
    await expect(chair).toHaveCount(1)
    const x0 = await chair.getAttribute('data-x')
    await dragBy(a.page, chair, 100, 0)
    await expect.poll(() => chair.getAttribute('data-x')).not.toBe(x0)
    await a.page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => chair.getAttribute('data-x'), { timeout: 10_000 }).toBe(x0)
    await a.page.getByRole('button', { name: 'Redo' }).click()
    await expect.poll(() => chair.getAttribute('data-x'), { timeout: 10_000 }).not.toBe(x0)
  } finally {
    await deleteRooms(a.page, [name])
  }
})
