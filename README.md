# Buggy Bash 3D

A 3D arcade racer for [start.ng](https://start.ng). Pick a track and a car, then race three laps with glowing crates for speed boosts, obstacles to bump into, and a leaderboard for best lap and race time.

**Tracks:** Tropical Beach, Desert Canyon, Neon City (dusk) and Moonlit Island (night).
**Cars:** Beach Buggy (balanced), Sprinter (fast, slides), Monster Truck (heavy, grippy) and Go-Kart (quick and sharp).

Built with [three.js](https://threejs.org) (r160, vendored in `vendor/`). It's a static site: no build step, no server.

## Controls

| Key | Action |
| --- | --- |
| W / Up | Accelerate |
| S / Down | Brake, then reverse |
| A D / Left Right | Steer |
| Space | Handbrake drift |
| R | Back on track |
| P / Esc | Pause / resume |
| T | Restart race |
| M | Mute |

Touch screens get on-screen buttons.

## How it works

- `js/track.js`: the closed-loop centre line (a Catmull-Rom spline) and nearest-point queries.
- `js/car.js`: the car models, the driver (drawn from the player's start.ng character) and the vehicle physics. The chassis is a rigid body: contact points on the car are tested against the sand berm along the track edge and against rocks and palms, and each hit applies a linear and angular impulse, so the car spins and scrapes along walls.
- `js/environments.js` and `js/world.js`: each track is a config (sky, light, ground, scenery, lamps); the world is built from it and rebuilt when you pick another.
- `js/cars.js`: handling stats for each car; `js/car.js` builds the models.
- `js/crates.js`: the floating crates. Each is a checkpoint with a boost; the next one has a beam of light.
- `js/startng.js`: player, scores and leaderboard through start.ng's connect page.
- `startng.json`: leaderboard columns (best lap, race time; lower is better).

Sign-in, scores and the leaderboard only work once the game is live at its `*.start.ng` address; opened locally it plays as a guest.

To run it locally, serve the folder with any static server (ES modules don't load from `file://`), for example `npx serve .`.
