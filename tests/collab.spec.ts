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

    // A resizes it from the panel -> both see the new size.
    await a.page.getByTestId('item-width').fill('140')
    await a.page.getByTestId('item-depth').fill('190')
    await a.page.getByTestId('item-depth').press('Enter')
    await expect(aBed).toHaveAttribute('data-width', '140')
    await expect(aBed).toHaveAttribute('data-height', '190')
    await expect(bBed).toHaveAttribute('data-width', '140', { timeout: 10_000 })
    await expect(bBed).toHaveAttribute('data-height', '190', { timeout: 10_000 })

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

test('visitors are counted once each and see the room under "Shared with you"', async ({ users }) => {
  test.setTimeout(120_000)
  const [a, b] = await users(2)
  const name = testName('Visits room')
  try {
    const id = await createRoom(a.page, name)
    await waitEditable(a.page)
    // Creator alone: no people badge.
    await a.page.goto('/rooms')
    const aCard = a.page.getByTestId('room-card').filter({ hasText: name })
    await expect(aCard).toBeVisible({ timeout: 15_000 })
    await expect(aCard.getByTestId('room-people')).toHaveCount(0)

    // B visits twice: counted once (the visit write is idempotent).
    for (let i = 0; i < 2; i++) {
      await b.page.goto(`/rooms/${id}`)
      await waitEditable(b.page)
    }
    await expect(aCard.getByTestId('room-people')).toHaveText('2', { timeout: 15_000 })
    await b.page.goto('/rooms')
    await expect(b.page.getByTestId('room-card').filter({ hasText: name })).toBeVisible({ timeout: 15_000 })
    await a.page.reload()
    await expect(aCard.getByTestId('room-people')).toHaveText('2', { timeout: 15_000 })
  } finally {
    await deleteRooms(a.page, [name])
  }
})

test('two first visits at the same moment are both recorded (no lost update)', async ({ users }) => {
  test.skip(
    loadAllTestAccounts().length < 3,
    'Needs 3 test accounts (creator + 2 simultaneous visitors). Add one with `npx deepspace test accounts create`.',
  )
  test.setTimeout(120_000)
  const [a, b, c] = await users(3)
  const name = testName('Race room')
  try {
    const id = await createRoom(a.page, name)
    await waitEditable(a.page)
    await a.page.goto('/rooms')
    // Both open the room at once — the old JSON-list write could keep only one of them.
    await Promise.all([b.page.goto(`/rooms/${id}`), c.page.goto(`/rooms/${id}`)])
    await Promise.all([waitEditable(b.page), waitEditable(c.page)])
    const aCard = a.page.getByTestId('room-card').filter({ hasText: name })
    await expect(aCard.getByTestId('room-people')).toHaveText('3', { timeout: 15_000 })
    for (const u of [b, c]) {
      await u.page.goto('/rooms')
      await expect(u.page.getByTestId('room-card').filter({ hasText: name })).toBeVisible({ timeout: 15_000 })
    }
  } finally {
    await deleteRooms(a.page, [name])
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

test('furniture size: panel and canvas agree, input is clamped, walls hold, undo and reload keep it', async ({ users }) => {
  test.setTimeout(120_000)
  const [a] = await users(1)
  const name = testName('Resize room')
  const page = a.page
  const width = page.getByTestId('item-width')
  const depth = page.getByTestId('item-depth')
  const footprint = page.getByTestId('item-footprint')
  const desk = page.locator('[data-testid="furniture"][data-kind="desk"]')
  const setSize = async (input: typeof width, v: string) => { await input.fill(v); await input.press('Enter') }
  const expectSize = async (w: string, h: string) => {
    await expect(desk).toHaveAttribute('data-width', w)
    await expect(desk).toHaveAttribute('data-height', h)
    await expect(width).toHaveValue(w)
    await expect(depth).toHaveValue(h)
  }
  try {
    await createRoom(page, name) // 4 m × 3.5 m
    await waitEditable(page)
    await page.getByTestId('add-desk').click()

    // Preset size shows identically in the inputs, the footprint label and the canvas.
    await expectSize('120', '60')
    await expect(footprint).toHaveText('120 × 60 cm')
    await expect(desk).toHaveAttribute('data-x', '200')

    // Growing keeps the center when it still fits.
    await setSize(width, '200')
    await expectSize('200', '60')
    await expect(footprint).toHaveText('200 × 60 cm')
    await expect(desk).toHaveAttribute('data-x', '200')

    // Out-of-range clamps; blank reverts to the current size.
    await setSize(width, '3')
    await expectSize('10', '60')
    await setSize(depth, '99999')
    await expectSize('10', '3000')
    await setSize(depth, '')
    await expectSize('10', '3000')
    await setSize(width, '200')
    await setSize(depth, '60')
    await expectSize('200', '60')

    // Push it against the right wall, then grow it: it's pulled back inside, never past the wall.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
    await expect(desk).toHaveAttribute('data-x', '300')
    await setSize(width, '300')
    await expectSize('300', '60')
    await expect(desk).toHaveAttribute('data-x', '250') // right edge 400 = room width
    await expect(page.getByText('Extends past the walls.')).toHaveCount(0)

    // Rotation swaps the footprint, not the item's own width/depth.
    await page.getByTestId('rotate-right').click()
    await expect(desk).toHaveAttribute('data-rot', '90')
    await expectSize('300', '60')
    await expect(footprint).toHaveText('60 × 300 cm')

    // Undo rotate, then undo resize (size and the wall pull-in revert together); redo both.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(desk).toHaveAttribute('data-rot', '0', { timeout: 10_000 })
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(desk).toHaveAttribute('data-width', '200', { timeout: 10_000 })
    await expect(desk).toHaveAttribute('data-x', '300')
    await expect(width).toHaveValue('200')
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(desk).toHaveAttribute('data-width', '300', { timeout: 10_000 })
    await expect(desk).toHaveAttribute('data-x', '250')
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(desk).toHaveAttribute('data-rot', '90', { timeout: 10_000 })

    // Switching selection shows each item's own size.
    await page.getByTestId('add-chair').click()
    await expect(width).toHaveValue('50')
    await expect(depth).toHaveValue('50')

    // Reload: size comes back from the CanvasRoom, and the panel matches.
    await page.reload()
    await expect(desk).toHaveCount(1, { timeout: 15_000 })
    await expect(desk).toHaveAttribute('data-width', '300')
    await expect(desk).toHaveAttribute('data-height', '60')
    await expect(desk).toHaveAttribute('data-rot', '90')
    await desk.click()
    await expectSize('300', '60')
    await expect(footprint).toHaveText('60 × 300 cm')

    // An edit typed without Enter isn't lost when you click away.
    await width.fill('280')
    await page.getByRole('application', { name: 'Room floor plan' }).click({ position: { x: 5, y: 5 } })
    await expect(page.getByTestId('room-panel')).toBeVisible()
    await expect(desk).toHaveAttribute('data-width', '280')
    // ...or when you click straight onto another piece.
    const chair = page.locator('[data-testid="furniture"][data-kind="chair"]')
    await chair.click()
    await expect(width).toHaveValue('50')
    await width.fill('70')
    await desk.click()
    await expect(width).toHaveValue('280')
    await expect(chair).toHaveAttribute('data-width', '70')
    await expect(desk).toHaveAttribute('data-width', '280')
  } finally {
    await deleteRooms(page, [name])
  }
})

test('custom furniture: user names it and sets its size (default 120 × 60); it syncs and persists', async ({ users }) => {
  test.setTimeout(120_000)
  const [a, b] = await users(2)
  const name = testName('Custom room')
  const custom = (page: typeof a.page) => page.locator('[data-testid="furniture"][data-kind="custom"]')
  try {
    const id = await createRoom(a.page, name)
    await waitEditable(a.page)
    await b.page.goto(`/rooms/${id}`)
    await waitEditable(b.page)

    await a.page.getByTestId('add-custom').click()
    const form = a.page.getByTestId('custom-form')
    await expect(form.getByLabel('Width (cm)')).toHaveValue('120')
    await expect(form.getByLabel('Depth (cm)')).toHaveValue('60')
    // A name is required.
    await expect(form.getByRole('button', { name: 'Add to room' })).toBeDisabled()
    await form.getByLabel('Name').fill('  Bookshelf  ')
    await form.getByLabel('Width (cm)').fill('80')
    await form.getByLabel('Depth (cm)').fill('30')
    await form.getByRole('button', { name: 'Add to room' }).click()
    await expect(form).toBeHidden()

    // Canvas, panel and the peer all agree on name and size.
    await expect(custom(a.page)).toHaveCount(1)
    await expect(custom(a.page)).toHaveAttribute('data-width', '80')
    await expect(custom(a.page)).toHaveAttribute('data-height', '30')
    await expect(custom(a.page)).toContainText('Bookshelf')
    await expect(a.page.getByTestId('item-label')).toHaveText('Bookshelf')
    await expect(a.page.getByTestId('item-width')).toHaveValue('80')
    await expect(a.page.getByTestId('item-footprint')).toHaveText('80 × 30 cm')
    await expect(custom(b.page)).toHaveCount(1, { timeout: 10_000 })
    await expect(custom(b.page)).toContainText('Bookshelf')
    await expect(custom(b.page)).toHaveAttribute('data-width', '80')

    // A second one with the defaults untouched is 120 × 60; the form reset after the first.
    await a.page.getByTestId('add-custom').click()
    await expect(form.getByLabel('Name')).toHaveValue('')
    await form.getByLabel('Name').fill('Piano')
    await form.getByRole('button', { name: 'Add to room' }).click()
    const piano = custom(a.page).filter({ hasText: 'Piano' })
    await expect(piano).toHaveAttribute('data-width', '120')
    await expect(piano).toHaveAttribute('data-height', '60')

    // Custom pieces resize like any other, and survive a reload.
    await a.page.getByTestId('item-width').fill('150')
    await a.page.getByTestId('item-width').press('Enter')
    await expect(piano).toHaveAttribute('data-width', '150')

    // Rename from the panel: canvas, panel and the peer follow; undo restores the old name.
    const nameInput = a.page.getByTestId('item-name')
    await expect(nameInput).toHaveValue('Piano')
    await nameInput.fill('Upright piano')
    await nameInput.press('Enter')
    await expect(a.page.getByTestId('item-label')).toHaveText('Upright piano')
    await expect(custom(a.page).filter({ hasText: 'Upright piano' })).toHaveCount(1)
    await expect(custom(b.page).filter({ hasText: 'Upright piano' })).toHaveCount(1, { timeout: 10_000 })
    await a.page.getByRole('button', { name: 'Undo' }).click()
    await expect(a.page.getByTestId('item-label')).toHaveText('Piano', { timeout: 10_000 })
    await expect(nameInput).toHaveValue('Piano')
    await expect(custom(b.page).filter({ hasText: /^Piano$/ })).toHaveCount(1, { timeout: 10_000 })

    // Blank reverts; a name typed without Enter is kept when clicking away.
    await nameInput.fill('   ')
    await nameInput.press('Enter')
    await expect(nameInput).toHaveValue('Piano')
    await nameInput.fill('Grand piano')
    await a.page.getByRole('application', { name: 'Room floor plan' }).click({ position: { x: 5, y: 5 } })
    await expect(a.page.getByTestId('room-panel')).toBeVisible()
    const grand = custom(a.page).filter({ hasText: 'Grand piano' })
    await expect(grand).toHaveCount(1)
    await expect(custom(b.page).filter({ hasText: 'Grand piano' })).toHaveCount(1, { timeout: 10_000 })

    // Presets have no name field.
    await a.page.getByTestId('add-chair').click()
    await expect(a.page.getByTestId('item-panel')).toBeVisible()
    await expect(nameInput).toHaveCount(0)
    await a.page.getByTestId('delete-item').click()

    await a.page.reload()
    await expect(custom(a.page)).toHaveCount(2, { timeout: 15_000 })
    await expect(grand).toHaveAttribute('data-width', '150')
    await grand.click()
    await expect(a.page.getByTestId('item-label')).toHaveText('Grand piano')
  } finally {
    await deleteRooms(a.page, [name])
  }
})

test('custom furniture form: validation, cancel, names in warnings, undo', async ({ users }) => {
  test.setTimeout(120_000)
  const [a] = await users(1)
  const page = a.page
  const name = testName('Custom form room')
  const form = page.getByTestId('custom-form')
  const custom = page.locator('[data-testid="furniture"][data-kind="custom"]')
  const submit = form.getByRole('button', { name: 'Add to room' })
  try {
    await createRoom(page, name)
    await waitEditable(page)

    // Whitespace-only names don't count.
    await page.getByTestId('add-custom').click()
    await form.getByLabel('Name').fill('    ')
    await expect(submit).toBeDisabled()

    // Escape cancels: nothing is added.
    await form.getByLabel('Name').press('Escape')
    await expect(form).toBeHidden()
    await expect(custom).toHaveCount(0)

    // Out-of-range size clamps to 10 cm; a blank size falls back to the default.
    await page.getByTestId('add-custom').click()
    await form.getByLabel('Name').fill('Lamp')
    await form.getByLabel('Width (cm)').fill('3')
    await form.getByLabel('Depth (cm)').fill('')
    await submit.click()
    const lamp = custom.filter({ hasText: 'Lamp' })
    await expect(lamp).toHaveAttribute('data-width', '10')
    await expect(lamp).toHaveAttribute('data-height', '60')

    // Sizes off the 10 cm grid are allowed (85 × 33).
    await page.getByTestId('add-custom').click()
    await form.getByLabel('Name').fill('Stool')
    await form.getByLabel('Width (cm)').fill('85')
    await form.getByLabel('Depth (cm)').fill('33')
    await submit.click()
    const stool = custom.filter({ hasText: 'Stool' })
    await expect(stool).toHaveAttribute('data-width', '85')
    await expect(stool).toHaveAttribute('data-height', '33')
    await page.getByTestId('delete-item').click()
    await expect(stool).toHaveCount(0)

    // Long names are capped at 40 characters and keep their case in the panel.
    await page.getByTestId('add-custom').click()
    await form.getByLabel('Name').fill('Grandma Piano ' + 'x'.repeat(60))
    await submit.click()
    await expect(page.getByTestId('item-label')).toHaveText(/^Grandma Piano x+$/)
    expect((await page.getByTestId('item-label').textContent())!.length).toBe(40)
    await expect(page.getByTestId('delete-item')).toContainText('Remove Grandma Piano')

    // Both sit at the room's center, so they overlap; warnings name them as typed.
    await expect(page.getByText(/Overlaps\s*Lamp/)).toBeVisible()
    await page.getByRole('application', { name: 'Room floor plan' }).click({ position: { x: 5, y: 5 } }) // deselect
    await expect(page.getByTestId('layout-warnings')).toContainText('Lamp: overlapping')
    await expect(page.getByTestId('layout-warnings')).toContainText('Grandma Piano')

    // Undo removes the last custom piece; redo brings it back with its name.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(custom).toHaveCount(1, { timeout: 10_000 })
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(custom).toHaveCount(2, { timeout: 10_000 })
    await expect(custom.filter({ hasText: 'Grandma Piano' })).toHaveCount(1)
  } finally {
    await deleteRooms(page, [name])
  }
})

test('view-only users (canWrite=false) see live edits but cannot change anything', async ({ users }) => {
  test.setTimeout(120_000)
  const [a, b] = await users(2)
  const name = testName('View-only room')
  try {
    const id = await createRoom(a.page, name)
    await waitEditable(a.page)
    await a.page.getByTestId('add-bed').click()
    const aBed = a.page.locator('[data-testid="furniture"][data-kind="bed"]')
    await expect(aBed).toHaveCount(1)

    // Every signed-in user is a `member` today, so force B's canvas into the
    // viewer state the server would send: rewrite the AUTH frame to canWrite=false.
    await b.page.routeWebSocket(/\/ws\/canvas\//, (ws) => {
      const server = ws.connectToServer()
      server.onMessage((m) => {
        if (typeof m === 'string') {
          const msg = JSON.parse(m)
          if (msg.type === 'auth') msg.payload.canWrite = false
          ws.send(JSON.stringify(msg))
        } else ws.send(m)
      })
      ws.onMessage((m) => server.send(m))
    })
    await b.page.goto(`/rooms/${id}`)
    const bBed = b.page.locator('[data-testid="furniture"][data-kind="bed"]')
    await expect(bBed).toHaveCount(1, { timeout: 15_000 })
    await expect(b.page.getByTestId('connection-status')).toHaveText('View only', { timeout: 15_000 })
    await expect(b.page.getByTestId('room-editor')).toHaveAttribute('data-can-write', 'false')

    // Every edit control is disabled.
    for (const kind of ['bed', 'sofa', 'desk', 'chair', 'dresser', 'rug', 'custom']) {
      await expect(b.page.getByTestId(`add-${kind}`)).toBeDisabled()
    }
    await expect(b.page.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await expect(b.page.getByRole('button', { name: 'Redo' })).toBeDisabled()

    // B can still select (to inspect), but rotate/delete are disabled and drag/keys do nothing.
    const x0 = await bBed.getAttribute('data-x')
    await dragBy(b.page, bBed, 120, 0)
    await expect(b.page.getByTestId('item-panel')).toBeVisible()
    await expect(b.page.getByTestId('rotate-right')).toBeDisabled()
    await expect(b.page.getByTestId('delete-item')).toBeDisabled()
    await b.page.keyboard.press('r')
    await b.page.keyboard.press('Delete')
    await b.page.keyboard.press('ArrowRight')
    await b.page.waitForTimeout(1000)
    await expect(bBed).toHaveAttribute('data-x', x0!)
    await expect(bBed).toHaveAttribute('data-rot', '0')
    await expect(bBed).toHaveCount(1)
    // ...and nothing B tried reached A.
    await expect(aBed).toHaveAttribute('data-x', x0!)
    await expect(aBed).toHaveAttribute('data-rot', '0')

    // B still receives A's live edits.
    await a.page.getByTestId('rotate-right').click()
    await expect(bBed).toHaveAttribute('data-rot', '90', { timeout: 10_000 })

    // Size inputs are read-only for B, but follow A's resize while B has the bed selected.
    await expect(b.page.getByTestId('item-width')).toBeDisabled()
    await expect(b.page.getByTestId('item-depth')).toBeDisabled()
    await a.page.getByTestId('item-width').fill('140')
    await a.page.getByTestId('item-width').press('Enter')
    await expect(bBed).toHaveAttribute('data-width', '140', { timeout: 10_000 })
    await expect(b.page.getByTestId('item-width')).toHaveValue('140')
    await expect(b.page.getByTestId('item-footprint')).toHaveText('200 × 140 cm') // rotated 90°
  } finally {
    await deleteRooms(a.page, [name])
  }
})
