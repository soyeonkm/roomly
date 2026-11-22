# Roomly

Plan a shared room with your roommate in real time. Sketch the floor plan, drop in furniture, and see each other's changes and cursors live.

**Live:** https://roomly.app.space

## Features

- **Rooms with real dimensions.** Create a room in metres; everything inside is measured in centimetres on a 10 cm grid.
- **Furniture.** Beds, desks, sofas, chairs, dressers and rugs. Drag to move, rotate, and edit width/depth in the side panel.
- **Custom furniture.** Name your own piece and give it a size (defaults to 120 × 60). Rename it later from the panel.
- **Doors and windows.** They snap to the nearest wall and slide along it. Doors show their swing and can be flipped.
- **Layout check.** Flags pieces that overlap, stick out past a wall, or block a door's swing.
- **Live collaboration.** Edits sync instantly. You can see other people's cursors and what they have selected.
- **Undo/redo** for your own changes.
- **Sharing.** Send the room link. Anyone signed in who opens it can edit, and it shows up under "Shared with you" on their dashboard.
- **Export.** Download the floor plan as a JPEG. Selection outlines and other people's cursors are left out.

### Keyboard

| Key | Action |
|---|---|
| Arrow keys | Nudge 10 cm (Shift: 50 cm). Doors/windows slide along their wall |
| `R` / `Shift+R` | Rotate |
| `Delete` / `Backspace` | Remove |
| `Esc` | Deselect |
| `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z` | Undo / redo |

## Stack

- React + Vite + Tailwind on the front end
- [DeepSpace](https://docs.deep.space) SDK on Cloudflare Workers and Durable Objects:
  - **RecordRoom** for room metadata and visits (typed collections with per-role permissions)
  - **CanvasRoom** for the furniture in each room (one canvas per room)
  - **PresenceRoom** for live cursors and selections
- Vitest for unit tests, Playwright for multi-user browser tests

## Running it

Needs Node 22+.

```sh
npm install
npx deepspace auth login
npm run dev            # local dev server
```

Checks:

```sh
npm run type-check
npm run lint
npm run test:unit      # geometry unit tests
npm run test:e2e       # multi-user browser tests
```

The browser tests sign in real test accounts and run with up to three users at once. Create the accounts once with `npx deepspace test accounts create`. The three-user test skips itself if fewer than three accounts exist.

## How it works / design choices

**Furniture lives in the canvas, not the database.** Room metadata (name, size) is a record. The furniture is shapes on a per-room CanvasRoom, which already handles real-time sync and per-user undo. Each shape stores its centre and unrotated size in cm, so rotating never moves a piece.

**Optimistic updates with "server wins".** CanvasRoom doesn't echo moves, resizes or updates back to the person who made them. So the client keeps its own unconfirmed edits in an overlay, and each field remembers the server value it replaced. When the server's value changes from that (someone else edited it, or an undo snapshot arrived), the server wins. This keeps two people editing the same piece from fighting each other.

**Doors and windows are stored as wall + distance along it.** I store `{ wall, along }` instead of x/y and calculate the position from the room size. Moving a door to a different wall is then a single update, which means a single undo step (the SDK has no batching). Doors also stay on their wall when the room is resized.

**Visits are one row per user.** At first, "who has opened this room" was a JSON list on the room record. Two people opening a room for the first time at the same moment could overwrite each other (read-modify-write race). Now each user writes only their own row (`roomId:userId`), and the visitor is the server-set `createdBy`, so nothing is shared and nothing gets lost. There's a three-user test that opens a room simultaneously to check this.

**Edits aren't lost when you click away.** A typed size or name saves on Enter, on blur, and when the panel closes. It also saves to the piece you were editing, even if you've already selected another one.

## Security

Permissions are enforced on the server, not just in the UI:

- Room pages require sign-in. Signed-out connections can't read rooms or visits, and the canvas/presence sockets require a valid login token.
- Only the creator can delete a room. Other members can only change its name and size.
- Furniture data from other users is treated as untrusted. Types are checked against an allowlist, numbers are coerced, sizes are clamped, and names are capped at 40 characters and rendered as text.

## Known limitations

- **Rooms aren't private.** Sharing is link-based, but any signed-in user can technically list and edit every room. Invite-only rooms would need per-room permissions on both the records and the canvas.
- Room size is validated in the UI but not on the server. The editor clamps it when drawing, so bad values can't break anything.
- Undo history is per connection, so it resets when you reload.