/**
 * eyes.ts - where the eyes are on each cast sprite facing the viewer, so a Halloween mask's eye holes sit on them.
 *
 * Generated once from the sprites (dark-and-white holes in the face, paired;
 * a few read off by hand where hair or glasses fooled that) and checked by
 * eye on every sprite. Fractions of the standing sprite's width and height;
 * a walk frame is drawn on its standing sprite's canvas, so they hold for the
 * frames too. `spacing` is the distance between the two pupils. Only
 * characters that can wear a mask are listed (not the ones in full costume),
 * and only the front poses (a mask is not drawn from behind). A sprite not
 * listed (a custom one) gets its mask placed from the measured head instead.
 * Each entry can be nudged and sized by hand in /?fithelper, which exports
 * this table again.
 */

export interface EyeLine {
  /** Midpoint between the eyes, 0..1 from the left */
  x: number
  /** Eye line, 0..1 from the top */
  y: number
  /** Distance between the pupils, 0..1 of the sprite's width */
  spacing: number
  /**
   * The mask's width, 0..1 of the sprite's width, when it was sized by hand
   * (/?fithelper); without it the mask is sized from `spacing`
   */
  width?: number
  /** The mask's tilt in degrees (clockwise), when set by hand (/?fithelper) */
  rot?: number
}

/** By standing sprite name without its extension: `<character>-front-left` / `-front-right` */
export const EYES: Readonly<Record<string, EyeLine>> = {
  'Frontend-dev-1-front-left': { x: 0.578, y: 0.169, spacing: 0.180 },
  'Frontend-dev-1-front-right': { x: 0.414, y: 0.169, spacing: 0.180 },
  'dev-1-front-left': { x: 0.577, y: 0.198, spacing: 0.212, width: 0.749 },
  'dev-1-front-right': { x: 0.423, y: 0.198, spacing: 0.212, width: 0.749 },
  'dev-2-front-left': { x: 0.490, y: 0.192, spacing: 0.205 },
  'dev-2-front-right': { x: 0.508, y: 0.192, spacing: 0.205 },
  'employee-1-front-left': { x: 0.640, y: 0.151, spacing: 0.156, width: 0.542 },
  'employee-1-front-right': { x: 0.338, y: 0.151, spacing: 0.156, width: 0.542 },
  'employee-2-front-left': { x: 0.708, y: 0.196, spacing: 0.263, width: 0.632 },
  'employee-2-front-right': { x: 0.275, y: 0.204, spacing: 0.263, width: 0.657 },
  'employee-3-front-left': { x: 0.649, y: 0.136, spacing: 0.202 },
  'employee-3-front-right': { x: 0.352, y: 0.132, spacing: 0.202 },
  'explore-1-front-left': { x: 0.666, y: 0.139, spacing: 0.215, width: 0.639 },
  'explore-1-front-right': { x: 0.334, y: 0.147, spacing: 0.216, width: 0.642 },
  'security-audit-1-front-left': { x: 0.697, y: 0.142, spacing: 0.214 },
  'security-audit-1-front-right': { x: 0.301, y: 0.142, spacing: 0.214 },
}
