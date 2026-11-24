// The setup of the last session of each shooting kind (training, competition, blank bale), kept on
// this device (settings.lastSetup, not synced). The Shooting page starts every field from it; it is
// written when a session of that kind starts.
import { DISTANCE_DEFAULTS, FACE_IDS, isValidArrowsPerEnd, DEFAULT_ARROWS_PER_END } from './scoring.js';

/** The kinds of shooting on the Shooting page: their session types. */
export const SHOOTING_KINDS = ['training', 'competition', 'blank'];

/** Arrow goals offered for a blank bale session (0 = none). */
export const ARROW_GOALS = [30, 60, 90, 120];
export const ARROW_GOAL_MAX = 10000;

const scoredDefault = () => ({ distance: 18, face: '40t', arrowsPerEnd: DEFAULT_ARROWS_PER_END, grading: true, gear: null });

/** A fresh device: 18 m on the triple, 3 arrows, M / S grading on; equipment = the active setup (gear null). */
export const defaultLastSetup = () => ({
  training: scoredDefault(),
  competition: { ...scoredDefault(), round: '', conditions: '' },
  blank: { goal: null, gear: null },
});

const isStr = (v) => typeof v === 'string';

/** One scored kind's values, each checked; a bad or missing value falls back to the default. */
function scored(v, base) {
  const o = v && typeof v === 'object' ? v : {};
  const distance = Number.isFinite(o.distance) && o.distance > 0 ? o.distance : base.distance;
  const face = FACE_IDS.includes(o.face) ? o.face : (DISTANCE_DEFAULTS[distance]?.face ?? base.face);
  return {
    ...base,
    distance,
    face,
    arrowsPerEnd: isValidArrowsPerEnd(o.arrowsPerEnd) ? o.arrowsPerEnd : base.arrowsPerEnd,
    grading: typeof o.grading === 'boolean' ? o.grading : base.grading,
    gear: isStr(o.gear) ? o.gear : null,
    ...('round' in base ? { round: isStr(o.round) ? o.round : '', conditions: isStr(o.conditions) ? o.conditions : '' } : {}),
  };
}

/**
 * Settings' lastSetup in the per-kind shape, whatever was stored: the per-kind map (checked), or the
 * single object of schema 7 and earlier (it applies to training and competition).
 */
export function normalizeLastSetup(value) {
  const d = defaultLastSetup();
  const v = value && typeof value === 'object' ? value : {};
  const perKind = SHOOTING_KINDS.some((k) => k in v);
  const blank = perKind && v.blank && typeof v.blank === 'object' ? v.blank : {};
  return {
    training: scored(perKind ? v.training : v, d.training),
    competition: scored(perKind ? v.competition : v, d.competition),
    blank: {
      goal: isGoal(blank.goal) ? blank.goal : null,
      gear: isStr(blank.gear) ? blank.gear : null,
    },
  };
}

/** An arrow goal: a whole number from 1 to ARROW_GOAL_MAX (null = no goal). */
export const isGoal = (n) => Number.isInteger(n) && n >= 1 && n <= ARROW_GOAL_MAX;

/** The last setup of one kind. */
/**
 * The equipment choice to remember from a session's equipment fields: the setup it took a copy of,
 * 'none' when it has no equipment, null when its equipment is not a setup's.
 */
export const gearChoiceOf = ({ gear, gearSnapshotId } = {}) => gearSnapshotId || (gear ? null : 'none');

export const lastSetupOf = (settings, kind) => normalizeLastSetup(settings?.lastSetup)[kind];

/** Settings patch remembering `values` as the last setup of `kind` (the other kinds are kept). */
export function rememberSetup(settings, kind, values) {
  const all = normalizeLastSetup(settings?.lastSetup);
  return { lastSetup: normalizeLastSetup({ ...all, [kind]: { ...all[kind], ...values } }) };
}
