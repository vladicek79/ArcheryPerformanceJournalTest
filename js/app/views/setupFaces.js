// The faces offered for a new session (scoring.js SETUP_FACES) seen as the APL setup shows them:
// a size (segmented control), a kind (pills: full, 10–6, 10–5, triple, Vegas) and, on the indoor
// faces, the scoring (standard or compound inner 10). Presentation only: the session still stores
// the face id ('40t', '60sc', '122', ...).
import { SETUP_FACES } from '../scoring.js';

const KINDS = ['full', 'six', 'ring6', 'triple', 'vegas'];
const SUFFIX = { full: '', six: 's', ring6: 'r', triple: 't', vegas: 'v' };
const KIND_OF = { '': 'full', s: 'six', r: 'ring6', t: 'triple', v: 'vegas' };

/** '40tc' → { size: 40, kind: 'triple', compound: true }; null for an id that is not a face. */
export function faceParts(face) {
  const m = /^(\d+)([srtv]?)(c?)$/.exec(String(face ?? ''));
  return m ? { size: Number(m[1]), kind: KIND_OF[m[2]], compound: m[3] === 'c' } : null;
}

/** { 40, 'triple' } → '40t'; with `compound`, '40tc'. */
export const faceId = (size, kind, compound = false) => `${size}${SUFFIX[kind]}${compound ? 'c' : ''}`;

/** The sizes offered, smallest first: [40, 60, 80, 122]. */
export const FACE_SIZES = [...new Set(SETUP_FACES.map((f) => faceParts(f).size))].sort((a, b) => a - b);

/** The kinds offered for a size, in the order full, 10–6, 10–5, triple, Vegas. */
export function kindsForSize(size) {
  const offered = new Set(
    SETUP_FACES.map(faceParts)
      .filter((p) => p.size === size)
      .map((p) => p.kind),
  );
  return KINDS.filter((k) => offered.has(k));
}

/** Whether a size and kind is also offered with the compound inner 10. */
export const hasCompound = (size, kind) => SETUP_FACES.includes(faceId(size, kind, true));

/**
 * The face after picking another size: the same kind when that size has it, else its first kind;
 * compound scoring is kept where the new face has it.
 */
export function faceForSize(size, current) {
  const parts = faceParts(current);
  const kinds = kindsForSize(size);
  const kind = kinds.includes(parts?.kind) ? parts.kind : kinds[0];
  return faceId(size, kind, !!parts?.compound && hasCompound(size, kind));
}

/** The face after picking another kind of the same size, keeping compound scoring where it exists. */
export function faceForKind(kind, current) {
  const { size, compound } = faceParts(current);
  return faceId(size, kind, compound && hasCompound(size, kind));
}
