// Scoring rules (HANDOFF §5). Pure functions, unit-tested.
//
// Every face is data (FACES below): its printed rings, its spots and how it is scored. Everything
// else (ring edges, scoring zones, keypad, colours, labels) is derived from that one entry.

export const DISTANCES = [7, 10, 18, 25, 30, 40, 50, 60, 70, 90];
export const ARROWS_PER_END_MIN = 1;
export const ARROWS_PER_END_MAX = 12;
export const DEFAULT_ARROWS_PER_END = 3;
export const isValidArrowsPerEnd = (n) => Number.isInteger(n) && n >= ARROWS_PER_END_MIN && n <= ARROWS_PER_END_MAX;
export const ARROW_VALUES = ['X', 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 'M'];
export const GRADES = [1, 2, 3, 4, 5];

/**
 * Three-spot sheets: spot centres in face units (one spot's radius = 100). Triple: three spots in a
 * column, top to bottom. Vegas: a triangle, top then bottom left, bottom right. Centres are 1.1 spot
 * diameters apart (22 cm on the 40 cm sheet, whose spots are 20 cm across; the 60 cm sheet scales).
 */
const TRIPLE = [
  [0, -220],
  [0, 0],
  [0, 220],
];
const VEGAS = [
  [0, -127],
  [-110, 63],
  [110, 63],
];

/**
 * The faces, by id. `low`: the lowest printed ring (1 on a full face, 6 on a 10–6 spot, 5 on the WA
 * 6-ring face); the printed rings 10…low are of equal width and fill the face's radius, and the X
 * ring is half a ring wide. `spots`: the spot centres of a multi-spot sheet. `compound`: scored with
 * the WA compound inner 10 (WA Book 2 7.2.2.3: only the X ring scores 10, the rest of the 10 ring
 * scores 9, and there is no X). `setup`: offered for a new session; the others stay valid for the
 * sessions that have them.
 */
const PLAIN_FACES = {
  40: { size: 40, low: 1, setup: true },
  '40s': { size: 40, low: 6, setup: true },
  '40t': { size: 40, low: 6, spots: TRIPLE, setup: true },
  '40v': { size: 40, low: 6, spots: VEGAS, setup: true },
  60: { size: 60, low: 1, setup: true },
  '60s': { size: 60, low: 6, setup: true },
  // not offered for a new session any more; kept for the sessions that have it
  '60t': { size: 60, low: 6, spots: TRIPLE },
  '60v': { size: 60, low: 6, spots: VEGAS, setup: true },
  80: { size: 80, low: 1, setup: true },
  // the WA 80 cm 6-ring face (rings 10 to 5), used for the 50 m compound round
  '80r': { size: 80, low: 5, setup: true },
  // the centre of the 80 cm face printed out to the 6 ring: not a WA face, kept for older sessions
  '80s': { size: 80, low: 6 },
  122: { size: 122, low: 1, setup: true },
};

/** The indoor faces also come in a compound version (WA "-C" faces): the same id with a 'c'. */
const COMPOUND_OF = ['40', '40s', '40t', '40v', '60', '60s', '60t', '60v'];
/** Only the 40 cm compound faces are offered for a new session; the 60 cm ones stay for old sessions. */
const COMPOUND_SETUP_SIZE = 40;

export const FACES = {
  ...PLAIN_FACES,
  ...Object.fromEntries(
    COMPOUND_OF.map((id) => {
      const plain = PLAIN_FACES[id];
      return [`${id}c`, { ...plain, compound: true, setup: !!plain.setup && plain.size === COMPOUND_SETUP_SIZE }];
    }),
  ),
};

export const FACE_IDS = Object.keys(FACES);
/** Faces offered for a new session. */
export const SETUP_FACES = FACE_IDS.filter((id) => FACES[id].setup);

/** A face no longer offered, and the one a new session gets instead. */
export const REPLACED_FACES = { '80s': '80r', '60t': '60', '60c': '60', '60sc': '60s', '60tc': '60', '60vc': '60v' };

const faceOf = (face) => FACES[face] || FACES['122'];

/**
 * The real radius, in cm, of one spot's 100 face units (its outermost printed ring): the rings are
 * size / 20 wide (2 cm on a 40 cm face), and the spot is printed from the 10 out to its lowest ring.
 * 122 cm face: 61; 40 cm triple: 10; WA 80 cm 6-ring face: 24.
 */
export function spotRadiusCm(face) {
  const f = faceOf(face);
  return ((11 - f.low) * f.size) / 20;
}

/** Whether a face is scored with the WA compound inner 10. */
export const isCompoundFace = (face) => !!faceOf(face).compound;

/**
 * The compound or the standard version of a face, for a new session; the face itself when that
 * version is not offered (a 60 cm face has no compound version for a new session).
 */
export function withCompound(face, compound) {
  const plain = String(face).replace(/c$/, '');
  const id = compound ? `${plain}c` : plain;
  return id in FACES && (!compound || FACES[id].setup) ? id : face;
}

/** Smart defaults: picking a distance suggests the usual face (arrows per end stay as set). */
export const DISTANCE_DEFAULTS = {
  7: { face: '80' },
  10: { face: '80' },
  18: { face: '40t' },
  25: { face: '60' },
  30: { face: '80' },
  40: { face: '122' },
  50: { face: '122' },
  60: { face: '122' },
  70: { face: '122' },
  90: { face: '122' },
};

const KIND_LABELS = { 1: '', 6: ' 10–6', 5: ' 10–5' };

export function faceLabel(face) {
  const f = FACES[face];
  if (!f) return `${face} cm`;
  const kind = f.spots === TRIPLE ? ' triple' : f.spots === VEGAS ? ' Vegas' : KIND_LABELS[f.low];
  return `${f.size} cm${kind}${f.compound ? ' · compound' : ''}`;
}

/** Faces printed only to an inner ring (10–6 spots, the 6-ring face): scored from 10 to their lowest ring. */
export function isSpotFace(face) {
  return faceOf(face).low > 1;
}

/** Number of printed scoring rings of a face (10 to its lowest ring). */
const ringCount = (face) => 11 - faceOf(face).low;

export const SPOT_CENTRES = Object.fromEntries(FACE_IDS.filter((id) => FACES[id].spots).map((id) => [id, FACES[id].spots]));

export function isMultiSpot(face) {
  return face in SPOT_CENTRES;
}

/** Centres of the spots on a sheet; a single face has one at the origin. */
export function spotCentres(face) {
  return SPOT_CENTRES[face] || [[0, 0]];
}

/**
 * The spot suggested for the arrow in slot `cursor` of an end on a triple or Vegas sheet (a hint only:
 * any spot can be shot at). Slot n suggests spot n; when that spot is already used by another arrow
 * of the end (or there is no spot n), the first spot not used yet; when all are used, they repeat.
 * Null on a single face.
 */
export function suggestedSpot(face, arrows, cursor) {
  if (!isMultiSpot(face)) return null;
  const count = spotCentres(face).length;
  const used = new Set(arrows.filter((a, i) => i !== cursor && a.spot != null).map((a) => a.spot));
  if (cursor < count && !used.has(cursor)) return cursor;
  const free = Array.from({ length: count }, (_, i) => i).find((i) => !used.has(i));
  return free ?? cursor % count;
}

/**
 * Which spot a point on the sheet belongs to (the nearest centre). `sx`, `sy` are sheet coordinates
 * normalised to one spot's radius. Returns the position relative to that spot's centre, which is what
 * is stored and scored; `spot` is null on single faces.
 */
export function locateOnSheet(sx, sy, face) {
  const centres = spotCentres(face);
  let best = 0;
  centres.forEach(([cx, cy], i) => {
    const [bx, by] = centres[best];
    if (Math.hypot(sx - cx / 100, sy - cy / 100) < Math.hypot(sx - bx / 100, sy - by / 100)) best = i;
  });
  const [cx, cy] = centres[best];
  return { spot: isMultiSpot(face) ? best : null, x: sx - cx / 100, y: sy - cy / 100 };
}

/** Where a logged arrow sits on the sheet, in face units (for drawing). */
export function sheetPoint(arrow, face) {
  const [cx, cy] = spotCentres(face)[arrow.spot ?? 0] || [0, 0];
  return { x: cx + arrow.x * 100, y: cy + arrow.y * 100 };
}

/** Numeric value: X = 10, M = 0, empty = 0. */
export function arrowValue(v) {
  if (v === 'X') return 10;
  if (v === 'M' || v == null) return 0;
  return Number(v);
}

export function isValidArrowValue(v) {
  return ARROW_VALUES.includes(v);
}

/**
 * The printed rings of a face as fractions of its radius, the X ring first and the face's edge (1)
 * last: printed ring k (k ≥ 1) is the 10 − (k − 1) ring.
 */
export function ringEdges(face) {
  const n = ringCount(face);
  return [1 / (2 * n), ...Array.from({ length: n }, (_, k) => (k + 1) / n)];
}

/**
 * How a face is scored: zones from the centre out, each with its outer edge (a fraction of the radius)
 * and its value. The innermost zone includes its edge line; the others score the lower (outer) ring on
 * a line. Standard: X, 10, 9 … the lowest ring. Compound: the X ring scores 10, the rest of the 10 ring
 * and the 9 ring score 9, then as printed.
 */
export function scoringZones(face) {
  const [xEdge, ...edges] = ringEdges(face);
  const printed = edges.map((edge, k) => ({ edge, value: 10 - k }));
  if (!isCompoundFace(face)) return [{ edge: xEdge, value: 'X' }, ...printed];
  return [{ edge: xEdge, value: 10 }, ...printed.slice(1)];
}

/**
 * Score a tap given its position normalised to the face radius (x, y in [-1, 1], centre 0,0).
 * A tap exactly on a ring line scores the lower ring (the X line counts as the X).
 */
export function scoreFromPoint(x, y, face) {
  return scoringZoneAt(x, y, face)?.value ?? 'M';
}

/**
 * The scoring zone a point lies in, by the rule of scoreFromPoint: its value and its inner and
 * outer edges (fractions of the radius). On a compound face the outer 10 ring and the 9 ring are
 * one zone (both score 9). Null off the face.
 */
export function scoringZoneAt(x, y, face) {
  const d = round9(Math.hypot(x, y));
  return zoneAt(face, (z, i) => (i === 0 ? d <= round9(z.edge) : d < round9(z.edge)));
}

/** The first scoring zone (from the centre out) that `inside(zone, index)` accepts, with its inner edge; null when none does. */
function zoneAt(face, inside) {
  const zones = scoringZones(face);
  const k = zones.findIndex(inside);
  if (k < 0) return null;
  return { value: zones[k].value, inner: k > 0 ? zones[k - 1].edge : 0, edge: zones[k].edge };
}

/**
 * The width of the shaft (mm) an arrow is drawn and scored with: an Easton ACE 670 (0.212 in), a
 * typical indoor shaft. An arrow's position (x, y) is the middle of its shaft.
 */
export const SHAFT_MM = 5.4;

/** An arrow's radius on a face, as a fraction of one spot's radius (0.027 on a 40 cm face). */
export function arrowRadius(face, shaftMm = SHAFT_MM) {
  return shaftMm / 2 / (spotRadiusCm(face) * 10);
}

/**
 * The scoring zone of an arrow whose shaft's middle is at x, y, by the rule of the sport: a shaft
 * touching a ring's line scores that (higher) ring, so the shaft's edge nearest the centre decides,
 * and an edge exactly on a line touches it. Same shape as scoringZoneAt; null when the whole shaft
 * is off the face.
 */
export function arrowZoneAt(x, y, face, shaftMm = SHAFT_MM) {
  const d = round9(Math.max(0, Math.hypot(x, y) - arrowRadius(face, shaftMm)));
  return zoneAt(face, (z) => d <= round9(z.edge));
}

/**
 * The values of every scoring zone an arrow's hole lies in or touches (its middle at x, y): one for
 * an arrow clear of the lines, two for a line cutter. Empty when the whole hole is off the face.
 */
export function zonesTouched(x, y, face, shaftMm = SHAFT_MM) {
  const d = Math.hypot(x, y);
  const r = arrowRadius(face, shaftMm);
  const [near, far] = [round9(Math.max(0, d - r)), round9(d + r)];
  return scoringZones(face)
    .filter((z, i, zones) => near <= round9(z.edge) && far >= round9(i > 0 ? zones[i - 1].edge : 0))
    .map((z) => z.value);
}

/** The score of an arrow whose shaft's middle is at x, y (arrowZoneAt's rule). */
export function scoreArrow(x, y, face, shaftMm = SHAFT_MM) {
  return arrowZoneAt(x, y, face, shaftMm)?.value ?? 'M';
}

// Guard against float noise such as 0.3 * 10 = 3.0000000000000004 or 0.7 * 10 = 6.999999999999999.
function round9(n) {
  return Math.round(n * 1e9) / 1e9;
}

/** Keys shown on the keypad for a face: its zone values, best first, and the miss. */
export function keypadValues(face) {
  return [...scoringZones(face).map((z) => z.value), 'M'];
}

/** The quick keypad of the Log: the best six values of the face and the miss. */
export function quickKeys(face) {
  return [...keypadValues(face).filter((k) => k !== 'M').slice(0, 6), 'M'];
}

/** WA zone name for a value, used as a CSS class suffix. */
export function zoneOf(v) {
  if (v == null) return 'empty';
  if (v === 'X' || v === 10 || v === 9) return 'gold';
  if (v === 8 || v === 7) return 'red';
  if (v === 6 || v === 5) return 'blue';
  if (v === 4 || v === 3) return 'black';
  if (v === 2 || v === 1) return 'white';
  return 'miss';
}

/**
 * The printed colour bands of a face from the centre out: each colour's outer edge (a fraction of the
 * radius). A full face: gold 0.2, red 0.4, blue 0.6, black 0.8, white 1; a 10–6 spot: gold 0.4, red
 * 0.8, blue 1.
 */
export function colourBands(face) {
  const [, ...edges] = ringEdges(face);
  const bands = [];
  edges.forEach((edge, k) => {
    const zone = zoneOf(10 - k);
    if (bands.length && bands[bands.length - 1].zone === zone) bands[bands.length - 1].edge = edge;
    else bands.push({ zone, edge });
  });
  return bands;
}
