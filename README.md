# Arena FPS Prototype

Fast 3D first-person shooter sandbox built with open source libraries:
- `three.js` for rendering and FPS camera controls
- `cannon-es` for rigid-body physics and collisions
- `vite` for local dev/build tooling

## Current features
- Circular arena with physical wall collision
- Single-player FPS controls
- Mouse look + pointer lock
- `WASD` movement and additional `Q/E` strafe inputs
- `Space` jump with physics gravity
- Left-click projectile shooting
- Physics-enabled cube targets for shooting practice

## Run

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Roadmap (next)
- Core systems cleanup for deterministic server-authoritative multiplayer
- Lobby + mode rule presets:
  - `1v1v1`
  - `1v1`
  - `2v2`
  - `3v3`
- Health, respawns, match timer, score tracking
- Netcode transport + server simulation and reconciliation
