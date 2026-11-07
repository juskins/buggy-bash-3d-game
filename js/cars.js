// Handling for each car. Ratings (1-5) are only for the garage screen.
export const CARS = {
  buggy: {
    name: 'Beach Buggy',
    icon: '🏎️',
    blurb: 'Balanced all-rounder',
    ratings: { speed: 3, accel: 3, handling: 3 },
    stats: { maxSpeed: 38, boostSpeed: 54, accel: 24, yaw: 2.2, grip: 9, halfW: 0.95, halfL: 1.75, inertia: 1.8, restitution: 0.35 },
  },
  sprinter: {
    name: 'Sprinter',
    icon: '🚗',
    blurb: 'Fastest on the straights, slides in corners',
    ratings: { speed: 5, accel: 2, handling: 2 },
    stats: { maxSpeed: 43, boostSpeed: 59, accel: 20, yaw: 1.8, grip: 6.5, halfW: 1.0, halfL: 1.85, inertia: 2.0, restitution: 0.3 },
  },
  truck: {
    name: 'Monster Truck',
    icon: '🛻',
    blurb: 'Heavy and grippy, shrugs off bumps',
    ratings: { speed: 2, accel: 3, handling: 4 },
    stats: { maxSpeed: 33, boostSpeed: 49, accel: 22, yaw: 2.0, grip: 11, halfW: 1.4, halfL: 1.9, inertia: 3.4, restitution: 0.18 },
  },
  kart: {
    name: 'Go-Kart',
    icon: '🏁',
    blurb: 'Quick off the line and razor sharp',
    ratings: { speed: 2, accel: 5, handling: 5 },
    stats: { maxSpeed: 35, boostSpeed: 51, accel: 31, yaw: 2.8, grip: 10, halfW: 0.72, halfL: 1.3, inertia: 1.1, restitution: 0.4 },
  },
};

export const DEFAULT_CAR = 'buggy';
