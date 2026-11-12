/**
 * hatFit.ts - hand-set nudges for the Santa hat and the witch hat on each cast sprite.
 *
 * A hat is placed from the head measured on the sprite itself (src/hat.ts);
 * where that lands a little off (big hair, a turned head), an entry here moves
 * and sizes it for that one sprite. Keys are the standing sprite's name
 * without extension or season suffix (`<character>-<front|rear>-<left|right>`),
 * so a walk frame and a seasonal copy wear the same nudge. `dx` / `dy` are
 * fractions of the sprite's width / height (down is positive), `size`
 * multiplies the hat's width and `rot` tilts it. Written by /?fithelper's Export.
 */

/** A hand-set correction to one sprite's hat */
export interface HatNudge {
  dx: number
  dy: number
  size: number
  /** Tilt in degrees, clockwise, about the hat's bottom centre */
  rot?: number
}

/** Which hat a nudge is for */
export type HatKind = 'santa' | 'witch'

export const HAT_FIT: Readonly<Record<HatKind, Readonly<Record<string, HatNudge>>>> = {
  santa: {
    'dev-1-front-left': { dx: -0.020, dy: 0.020, size: 1.125, rot: -13 },
    'dev-1-front-right': { dx: 0.024, dy: 0.016, size: 1.125, rot: 15 },
    'dev-1-rear-left': { dx: 0.020, dy: 0.000, size: 1.082, rot: -1 },
    'dev-1-rear-right': { dx: -0.032, dy: 0.000, size: 1.082 },
    'dev-2-front-left': { dx: -0.032, dy: 0.000, size: 1.125, rot: -9 },
    'dev-2-front-right': { dx: 0.040, dy: 0.000, size: 1.082, rot: 10 },
    'dev-2-rear-left': { dx: 0.012, dy: 0.008, size: 1.125, rot: -6 },
    'dev-2-rear-right': { dx: 0.000, dy: 0.000, size: 1.125, rot: 5 },
    'employee-1-front-left': { dx: -0.008, dy: 0.024, size: 1.082, rot: -21 },
    'employee-1-front-right': { dx: 0.004, dy: 0.024, size: 1.082, rot: 20 },
    'employee-1-rear-left': { dx: 0.024, dy: 0.024, size: 1.125 },
    'employee-1-rear-right': { dx: -0.016, dy: 0.028, size: 1.125 },
    'employee-3-front-left': { dx: -0.020, dy: 0.020, size: 1.125, rot: -17 },
    'employee-3-front-right': { dx: 0.028, dy: 0.024, size: 1.082, rot: 15 },
    'employee-3-rear-left': { dx: 0.040, dy: 0.020, size: 1.125 },
    'employee-3-rear-right': { dx: -0.036, dy: 0.024, size: 1.125 },
    'explore-1-front-left': { dx: -0.020, dy: 0.012, size: 1.125, rot: -26 },
    'explore-1-front-right': { dx: 0.028, dy: 0.020, size: 1.125, rot: 20 },
    'explore-1-rear-left': { dx: 0.016, dy: 0.028, size: 1.125 },
    'explore-1-rear-right': { dx: -0.008, dy: 0.032, size: 1.125 },
    'security-audit-1-front-left': { dx: 0.000, dy: 0.000, size: 1.000, rot: -20 },
    'security-audit-1-front-right': { dx: 0.000, dy: 0.000, size: 1.000, rot: 20 },
  },
  witch: {
    'dev-2-front-left': { dx: -0.036, dy: -0.012, size: 1.082 },
    'dev-2-front-right': { dx: 0.040, dy: -0.012, size: 1.082 },
    'dev-2-rear-left': { dx: 0.024, dy: -0.020, size: 1.082 },
    'dev-2-rear-right': { dx: -0.020, dy: -0.020, size: 1.082 },
  },
}
