# Visual upgrade — The Insider

This is a client presentation update. Server rules, networking, simulation, scenario data, Tiled geometry, collision, badge permissions, task completion and terminal input have not changed.

[View the office preview](office-upgrade-preview.png).

## Architecture inspected

- **Renderer:** Phaser 3.90 (`game/OfficeScene.ts`) reads the existing Tiled map through `parseOfficeMap`. React draws panels; xterm.js draws the terminal.
- **Movement/camera:** `game/PhaserView.tsx` sends keyboard intentions through `store.ts`. The scene interpolates server positions and follows the current player. The existing 1× camera zoom is retained.
- **Multiplayer:** Colyseus `OfficeRoom.ts` publishes public state at the existing tick rate. `visibility.ts` constructs public identities, desk/door state, personal tasks and each player's own card.
- **Collision/access:** `shared/src/map.ts`, server `doors.ts` and `mapCheck.ts` own solid tiles, furniture footprints, interaction distances, badge access and reachability. None were edited.
- **Original characters:** circles plus triangular facing markers, with no sprite animation.
- **Original roster:** employee selection on the start screen; no in-game directory. The new directory uses only the already-public employee choices and bodies.

## Implemented

- Department flooring with carpet weave or wood seams, floor inlays, continuous wall panels, exterior windows, restrained strip lighting and framed wall charts.
- Individually drawn shelves, files, server racks, meeting tables, chairs, plants, sofas, printers, sinks and CCTV monitor banks. Solid furnishings use the existing map object bounds; no new obstacles or fake interactable objects were added.
- Framed security doors, detailed readers, camera housings and readable department signs. Existing monitor and badge-state colors remain meaningful. A thin teal outline identifies the same nearby target used by the existing E-key prompt.
- Eight cosmetic character variants with different hair, clothing details, glasses, headscarf/headphones and department accents. Each has dedicated front/back/left/right idle and walking frames. Animation follows actual interpolated movement; standing against a wall does not run a walking cycle. Names remain visible, with a small teal marker for the current player.
- Shared portraits on employee selection and a compact in-game directory. The directory shows name, public department, current-player marker and public physical presence/workstation status. Clicking a row changes only its visual selection.
- Navy/charcoal task panels, teal commands, compact top bar, keyboard footer, notices, interaction prompts and a dark personal onboarding card.
- Desktop panels occupy reserved rails outside the canvas. At narrower desktop widths, the directory moves below tasks. A ResizeObserver keeps the Phaser viewport fitted when panel layout changes.

## Assets and reference differences

`characterArt.ts` contains **original temporary pixel-art placeholders**, generated as 128×160 canvas sheets: four 32×40 frames per direction, four directions. The same source supplies portrait thumbnails. `officeArt.ts` contains the procedural office artwork. There is no image-generation dependency, external image download or concept-sheet cropping at runtime.

The supplied `office-map.png` and `characters.png` remain untouched and are not loaded by the game. Their navy/teal palette, department accents and office-worker silhouettes informed the design.

Production artist-authored sprite sheets and richer environment textures are still optional replacement work. The current procedural art is simpler and less densely furnished than the reference. Extra lounge furniture and separate meeting/cafeteria rooms were not added because those would change the existing collision/layout. The real scenario's names, departments and room plan are preserved, including its combined cafeteria/meeting room.

There is no elimination or voice state in the current public protocol, so no invented Alive/Eliminated or microphone indicators are shown. Hacker identities, meetings and voting are not implemented in this project phase; this update does not add or alter game rules for them. No private card, task, credential, bot identity or developer data is used by the roster.

## Files

- `packages/client/src/game/OfficeScene.ts` — sprite display, animation and interaction styling.
- `packages/client/src/game/officeArt.ts` — new procedural map furnishings/materials.
- `packages/client/src/game/characterArt.ts` — new temporary sprite frames and portraits.
- `packages/client/src/game/PhaserView.tsx` — canvas resize handling only; keyboard code unchanged.
- `packages/client/src/ui/panels.tsx` — employee portraits, roster and HUD markup.
- `packages/client/src/styles.css` — interface styling and responsive layout.
- `e2e/design.spec.ts` — two-client synchronization and visual integration checks.
- `playwright.config.ts` — serialize browser files because they share one office and employee choices.
- `e2e/screenshots/*.png` — refreshed existing smoke-test screenshots.
- `docs/design/office-upgrade-preview.png` — full-office review capture.
- `README.md` and this document — artwork/status and delivery notes.

## Verification and running

Use Node.js 20+ with the repository's pnpm version. From the project root:

```sh
pnpm install
pnpm dev
```

Open **http://localhost:5173**. Choose an employee, close the card with **C**, move with **WASD/arrows**, and use **E** at a desk or reader. **T** toggles tasks. **Esc** leaves a terminal. Open a second browser/tab and choose a different employee to share the office.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

If needed, install the browser once with `pnpm exec playwright install chromium`. Existing dependencies also allow `npm run dev`, `npm run typecheck`, `npm test`, `npm run build` and `npm run e2e`.

Browser checks retain the original terminal/switch-user/badge-denial scenarios and add public state agreement across two clients, movement in all four directions, roster selection/disconnect updates, and canvas/panel bounds at 1920×1080, 1280×800 and 1024×768 at the existing 1× zoom. Generated review captures are under `test-results/design/`; smoke captures are under `e2e/screenshots/`.

### Recorded results — 16 November 2026

- Type checking: passed across all five packages.
- Vitest: **218/218 tests passed**, 19 files, including collision/map checks, doors/access, bots/tasks, CCTV, visibility over a real connection and the three-hour simulated soak.
- Playwright: **4/4 tests passed**, including the new two-client visual integration scenario.
- The visual integration check also passed again after the final sprite-frame edge cleanup (16.7 seconds).
- Production Vite build: passed.
- `git diff --check`: passed. No changes under `packages/server`, `packages/shared`, `packages/engine`, `maps` or `scenarios`.
- Screenshots inspected at the three desktop sizes, in all four movement directions, at the terminal, and in a full-office overview. A security-room sign overlap found during review was corrected.

The first Vitest run had one 5-second bot-simulation timeout while the build ran concurrently; the normal suite passed on rerun without changing tests or gameplay. Chromium had to be installed for the browser checks. Windows sandbox profile restrictions required running those checks outside the sandbox.
