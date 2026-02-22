# Arena FPS Prototype

https://blocks-arena.vercel.app/

NOTE: This repo is in an in-progress state as of Feb 2026. The game features randomization for blocks dropping from sky onto the floor, buggy player jumping and ability to hop onto blocks, and basic projectile shooting with the equipped wep, in first person view for FPS style. The game does not include player body (hovering firearm) or proper collision control. 

It is possible that this repo could be discontinued in favor of a better game engine framework to build from. 



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
