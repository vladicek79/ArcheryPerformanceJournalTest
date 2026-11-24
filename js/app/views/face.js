// Target face drawing shared by the Log tab and the session detail (SVG, face radius = 100 units).
import { s } from '../../core/dom.js';
import { isSpotFace, isMultiSpot, spotCentres, ringEdges, zoneOf } from '../scoring.js';

export const VB = 101; // viewBox half-size; the face radius is 100

const FILL = { gold: '#FFE11A', red: '#D22B2B', blue: '#00A2E8', black: '#1A1A1A', white: '#FFFFFF' };

export function faceRings(face) {
  const ring = (r, fill, stroke, sw = 0.6) => s('circle', { r, fill, stroke, 'stroke-width': sw });
  const [xEdge, ...edges] = ringEdges(face);
  // a spot is drawn with bolder lines, its rings being wider
  const spot = isSpotFace(face);
  const rings = edges
    .map((edge, k) => {
      const fill = FILL[zoneOf(10 - k)];
      const stroke = fill === FILL.black ? '#FFFFFF' : '#14181C';
      return ring(edge * 100, fill, stroke, spot ? 0.8 : 0.6);
    })
    .reverse();
  const m = spot ? 2 : 1.5;
  return [
    ...rings,
    ring(xEdge * 100, 'none', '#14181C', spot ? 0.6 : 0.5),
    s('path', { d: `M-${m} 0h${2 * m}M0 -${m}v${2 * m}`, stroke: '#14181C', 'stroke-width': spot ? 0.6 : 0.5 }),
  ];
}

/** The whole sheet: one face, or three spots for the triple and Vegas faces. */
export function faceSheet(face) {
  if (!isMultiSpot(face)) return faceRings(face);
  return spotCentres(face).map(([cx, cy]) => s('g', { transform: `translate(${cx} ${cy})` }, faceRings(face)));
}

/** viewBox that fits the sheet with a 1-unit margin. */
export function faceViewBox(face) {
  const c = spotCentres(face);
  const xs = c.map(([x]) => x);
  const ys = c.map(([, y]) => y);
  const minX = Math.min(...xs) - VB;
  const minY = Math.min(...ys) - VB;
  return `${minX} ${minY} ${Math.max(...xs) + VB - minX} ${Math.max(...ys) + VB - minY}`;
}
