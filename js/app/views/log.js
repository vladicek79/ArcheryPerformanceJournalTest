// Log tab: new session setup → arrow-by-arrow logging with the M/S grading sheet (HANDOFF §3).
import { h, s } from '../../core/dom.js';
import { confirmDialog } from './confirm.js';
import {
  scoreArrow,
  arrowRadius,
  locateOnSheet,
  sheetPoint,
  isMultiSpot,
  spotCentres,
  zoneOf,
  suggestedSpot,
  quickKeys,
} from '../scoring.js';
import { fmt } from '../stats.js';
import { endRows, sessionAverage, sessionCounts, sessionTotal, isEndComplete } from '../endSummary.js';
import * as L from '../sessionLogic.js';
import { T } from '../strings.js';
import { icons } from '../icons.js';
import { faceSheet, faceViewBox, VB } from './face.js';
import { SESSION_TYPES, TYPE_LABELS, sessionType, isGraded, countsArrows } from '../sessionTypes.js';
import { renderFormSetup } from './sessionSetup.js';
import { renderTypeChoice, renderStrengthChoice, renderShootingSetup } from './shootingSetup.js';
import { renderBlankRunning } from './blankBale.js';
import { renderGymSetup } from './gymSetup.js';
import { renderGymRunning } from './gymRunning.js';
import { SHOOTING_KINDS } from '../lastSetup.js';
import { sessionTimer } from './timer.js';
import { runningHeader } from './runningHeader.js';
import { groupSection } from './sessionOverview.js';
import { eyeToPinOf, shaftMmOf } from '../gearFields.js';
import * as APL from '../../ui/apl/index.js';
import { detectArrows } from '../photoDetect.js';
import { loadArrowNet, arrowsByNet } from '../arrowNet.js';
import { scanMethod } from './settingsScan.js';
import { drawArrowMarks, liveScan } from './liveScan.js';
import { watchScan } from './watchScan.js';
import { showWatchEnd } from './watchEnd.js';
import { ringPoints } from '../scanGeometry.js';
import { canScan, createScan } from '../scan.js';
import { loupeCorner, loupeBox } from '../loupePlacement.js';

/**
 * The ongoing sessions' questions to the archer, as dialogs (the `confirm` adapter of
 * ongoingSessions.js). A page that asked on its own sheet already passes `confirmed`, so its
 * question never comes here.
 */
export function askAboutOngoingSession(q) {
  // the open form session's questions name a type; the running session's carry the session
  return q.kind === 'save' || (q.kind === 'discard' && q.type) ? askAboutOpenFormSession(q) : askAboutRunningSession(q);
}

/** The running session's questions: replacing it, finishing it, discarding it. */
function askAboutRunningSession(q) {
  if (q.kind === 'replace') {
    return confirmDialog({
      title: 'A session is in progress',
      message: q.willFinish ? T.confirmReplaceFinish : T.confirmReplaceDiscard,
      confirmLabel: q.willFinish ? 'Finish & start' : 'Discard & start',
      danger: !q.willFinish,
    });
  }
  if (q.kind === 'finish') {
    return confirmDialog({
      title: 'Finish session?',
      message: `${TYPE_LABELS[sessionType(q.session)]} · ${q.ends} ${q.ends === 1 ? 'end' : 'ends'}. The session opens in History.`,
      confirmLabel: 'OK',
      icon: 'check',
    });
  }
  return confirmDialog({ title: 'Discard session?', message: T.confirmDiscard, confirmLabel: 'Discard', danger: true });
}

/** The open form session's questions: saving it, discarding it. */
function askAboutOpenFormSession(q) {
  if (q.kind === 'save') {
    // Save asks only OK / Cancel; the duration (from the timer) and the note are then edited on the
    // session's History page, which opens next.
    const { type, fields, minutes } = q;
    const facts = [
      countsArrows(type) ? `${fields.arrows || 0} ${fields.arrows === 1 ? 'arrow' : 'arrows'}` : null,
      minutes != null ? `${minutes} min` : null,
    ].filter(Boolean);
    return confirmDialog({
      title: 'Save session?',
      message: `${TYPE_LABELS[type]}${facts.length ? ` · ${facts.join(' · ')}` : ''}. The duration and a note can be changed on the next page.`,
      confirmLabel: 'OK',
      icon: 'check',
    });
  }
  return confirmDialog({
    title: 'Discard session?',
    // "blank bale session", but "SPT session": an abbreviation keeps its capitals
    message: `This ${TYPE_LABELS[q.type] === TYPE_LABELS[q.type].toUpperCase() ? TYPE_LABELS[q.type] : TYPE_LABELS[q.type].toLowerCase()} session is not saved, and its timer stops.`,
    confirmLabel: 'Discard',
    danger: true,
  });
}

export function renderLog(ctx) {
  const active = ctx.ongoing.running.get();
  // no session running (e.g. it was just finished or discarded): choose a type for a new one
  return active ? renderActive(ctx, active) : renderTypeChoice(ctx);
}

/**
 * New session: step 1 picks what you do (#/new); step 2 is the Shooting page
 * (#/new/shooting/<training|competition|blank>), Strength (#/new/strength-choice: SPT or gym), the
 * Gym setup (#/new/gym), or the form of SPT, mental or manual (#/new/<type>).
 * The old #/new/training, #/new/competition and #/new/blank lead to the Shooting page.
 */
export function renderNewSession(ctx, params = []) {
  const [type, kind] = params;
  if (type === 'strength-choice') return renderStrengthChoice(ctx);
  if (type === 'gym') return renderGymSetup(ctx);
  if (type === 'shooting') return renderShootingSetup(ctx, SHOOTING_KINDS.includes(kind) ? kind : 'training');
  if (SHOOTING_KINDS.includes(type)) {
    queueMicrotask(() => ctx.navigate(`new/shooting/${type}`, { replace: true }));
    return renderShootingSetup(ctx, type);
  }
  if (SESSION_TYPES.includes(type)) return renderFormSetup(ctx, type);
  return renderTypeChoice(ctx);
}

/** The running blank bale session (#/blank); none open: its setup on the Shooting page. */
export function renderBlankBale(ctx) {
  const open = ctx.ongoing.find('blank');
  if (open) return renderBlankRunning(ctx, open);
  queueMicrotask(() => ctx.navigate('new/shooting/blank', { replace: true }));
  return renderShootingSetup(ctx, 'blank');
}

/** The running gym session (#/gym); none open: the Gym setup page. */
export function renderGym(ctx) {
  const open = ctx.ongoing.find('gym');
  if (open) return renderGymRunning(ctx, open);
  queueMicrotask(() => ctx.navigate('new/gym', { replace: true }));
  return renderGymSetup(ctx);
}

/** Apply a session transition to the running session; the page is drawn again when it changed. */
function update(ctx, fn, { rerender = true } = {}) {
  const changed = ctx.ongoing.running.apply(fn);
  if (changed && rerender) ctx.rerender();
  return changed;
}

// ---------------------------------------------------------------- active session

// One polite live region for the whole app (it outlives the page's re-renders, so screen readers
// hear every announcement): "Arrow 2: 9" when an arrow is scored.
let liveRegion = null;
let announceTimer = 0;
function announce(text) {
  if (!liveRegion?.isConnected) {
    liveRegion = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    document.body.append(liveRegion);
  }
  // emptied first, so the same text is announced again; only the latest one is spoken
  clearTimeout(announceTimer);
  liveRegion.textContent = '';
  announceTimer = setTimeout(() => {
    liveRegion.textContent = text;
  }, 50);
}

/** Announce the score of arrow `i` (default: the selected arrow, the one that just received one). */
function announceArrow(ctx, i) {
  const s = ctx.ongoing.running.get();
  const at = i ?? s?.cursor;
  const a = s && L.shownEnd(s).arrows[at];
  if (a?.v != null) announce(T.arrowScored(at + 1, a.v));
}

function renderActive(ctx, session) {
  const { cursor } = session;
  const current = L.shownEnd(session); // the end on screen (the current one or a saved one)
  const viewing = session.view != null;
  const editing = L.isEditing(session);
  const endNo = L.viewIndex(session) + 1;
  const totalEnds = session.ends.length + 1;
  const picked = current.arrows[cursor];

  const enter = (v, x, y, spot) => {
    // the arrow receiving the score: without grading the selection moves on past it
    const target = L.scoreTarget(ctx.ongoing.running.get() ?? session);
    if (update(ctx, (cur) => L.enterScore(cur, v, x, y, spot))) announceArrow(ctx, target);
  };

  // session timer: tap to pause / resume
  // sessions started before the timer existed show it stopped at 0:00; one tap starts it
  const timerBtn = sessionTimer(session.timer, () =>
    update(ctx, (c) => (c.timer?.running ? L.pauseTimer(c) : L.resumeTimer(c))),
  );

  // the sheet open over the page: 'finish' or 'details'
  const { sheet, setSheet } = scoreSheet(ctx, session);

  // --- top: "End n" ("End n / m" on an earlier end), the timer and Finish
  const header = runningHeader({
    title: h(
      'h1',
      { class: 'score-title', 'aria-label': viewing ? `${T.endN(endNo)} of ${totalEnds}` : null },
      T.endN(endNo),
      viewing ? h('span', { class: 'end-of', 'aria-hidden': 'true' }, T.endOf(totalEnds)) : null,
    ),
    timer: timerBtn,
    finish: h(
      'button',
      { type: 'button', class: 'score-finish', 'aria-haspopup': 'dialog', onClick: () => setSheet('finish'), dataset: { fk: 'finish-open' } },
      T.finishShort,
    ),
  });

  // --- slot strip: one card per slot; tapping one makes it the selected arrow
  const graded = isGraded(session);
  // without grading a card holds just the score: six to a row (twelve arrows make two rows)
  const narrow = !graded;
  const compact = graded && current.arrows.length > 6;
  const cols = narrow ? 6 : compact ? 4 : current.arrows.length === 4 ? 2 : Math.min(3, current.arrows.length);
  const strip = h(
    'div',
    {
      class: ['slot-strip', compact && 'is-compact', narrow && 'is-narrow'],
      role: 'group',
      'aria-label': 'Arrows in this end',
      style: { '--slot-cols': String(cols) },
    },
    current.arrows.map((a, i) => {
      const active = i === cursor;
      // "M1 S2" once the arrow has a score or a grade ("–" for a grade not given yet); none when
      // the session is scored without grading
      const grades = graded && (a.v != null || a.m != null || a.s != null) ? `M${a.m ?? '–'} S${a.s ?? '–'}` : '';
      // graded on the watch: which numbered arrow this slot is (#3), shown until the slot is scored
      const no = a.no != null ? `#${a.no}` : '';
      return h(
        'div',
        { class: ['slot-card', active && 'is-active', active && editing && 'is-moving'] },
        h(
          'button',
          {
            type: 'button',
            class: 'slot-pick',
            'aria-label': `${T.arrowN(i + 1)}${no ? ` (arrow ${no})` : ''}${a.v == null ? ', empty' : `, ${a.v}`}${a.m ? `, M${a.m}` : ''}${a.s ? `, S${a.s}` : ''}${active ? ', selected' : ''}`,
            'aria-pressed': String(active),
            dataset: { fk: `slot-${i}` },
            onClick: () => update(ctx, (cur) => L.selectArrow(cur, i)),
          },
          h('span', { class: `score-chip z-${zoneOf(a.v)}`, 'aria-hidden': 'true' }, a.v == null ? no || String(i + 1) : String(a.v)),
          grades ? h('span', { class: 'slot-card-grades', 'aria-hidden': 'true' }, grades) : null,
        ),
        // only the selected, scored arrow: × empties its score, position and grades (today's Clear)
        active && a.v != null
          ? h(
              'button',
              {
                type: 'button',
                class: 'slot-clear',
                'aria-label': T.clearArrow(i + 1),
                onClick: () => update(ctx, L.clearArrow),
                dataset: { fk: 'clear-arrow' },
              },
              h('span', { class: 'slot-clear-dot', 'aria-hidden': 'true' }, icons.close()),
            )
          : null,
      );
    }),
  );

  // --- the face (multi-spot sheets: the spot suggested for an empty selected arrow is outlined)
  const hintSpot = picked.v == null ? suggestedSpot(session.face, current.arrows, cursor) : null;
  const input = targetInput(session, enter, {
    hintSpot,
    shaftMm: shaftMmOf(session, ctx.repo.list('setups')),
    onMove: (i, v, x, y, spot) => {
      if (update(ctx, (cur) => L.moveArrow(cur, i, v, x, y, spot))) announceArrow(ctx);
    },
  });

  // --- under the face: the score keypad (a score without a position, today's entry) and, when the
  // session is graded, the selected arrow's M / S grades
  const under = h(
    'div',
    { class: 'score-under' },
    APL.ScoreKeypad({
      label: 'Score without position',
      keys: quickKeys(session.face).map((k) => ({
        value: k,
        zone: zoneOf(k),
        ariaLabel: `Score ${k === 'M' ? 'miss' : k}`,
      })),
      value: picked.v,
      onKey: (k) => enter(k, null, null),
      fk: 'quick',
    }),
    graded ? gradePanel(session, { onGrade: (kind, g) => update(ctx, (c) => L.gradeArrow(c, kind, g)) }) : null,
  );

  // --- the end's let-downs and note (one sheet), and what to do next
  const chip = (label, fk, ...children) =>
    h(
      'button',
      { type: 'button', class: 'score-chip-btn', 'aria-haspopup': 'dialog', 'aria-label': label, onClick: () => setSheet('details'), dataset: { fk } },
      ...children,
    );
  const chips = h(
    'div',
    { class: 'score-chips' },
    chip(
      `${T.letDowns} ${current.ld}, correct ${current.cld}. ${T.endDetails(endNo)}`,
      'details-ld',
      T.letDowns,
      h('strong', null, `${current.ld} · ${current.cld}`),
    ),
    chip(`${T.noteForEnd}${current.note ? ' (written)' : ''}. ${T.endDetails(endNo)}`, 'details-note', icons.pencil(), 'Note', current.note ? h('span', { class: 'score-chip-dot', 'aria-hidden': 'true' }) : null),
  );

  // --- bottom bar, in thumb reach, four buttons of one size: Previous (end), Next (end), Watch (scan
  // the watch's code into this end: grades in a graded session, shot timing and heart rate in
  // every session) and Scan (the target) at the right. There is no Save end step (every change is saved as it is made): Next opens the
  // next end, and from the end being shot it needs at least one arrow, so empty ends do not pile
  // up. It turns accent once every slot of the end has a score.
  const prevBtn = h(
    'button',
    {
      type: 'button',
      class: 'score-prev',
      'aria-label': T.prevEnd,
      disabled: !L.canPrevEnd(session),
      onClick: () => update(ctx, L.prevEnd),
      dataset: { fk: 'end-prev' },
    },
    T.prevShort,
  );
  const nextEnd = () => {
    const saving = session.view == null;
    if (update(ctx, L.nextEnd) && saving) announce(T.endSaved(endNo, sessionTotal(ctx.ongoing.running.get())));
  };
  const nextBtn = h(
    'button',
    {
      type: 'button',
      class: ['score-next', isEndComplete(current) && 'is-ready'],
      'aria-label': T.nextEnd,
      disabled: !L.canNextEnd(session),
      onClick: nextEnd,
      dataset: { fk: 'end-next' },
    },
    T.nextShort,
  );

  const watchBtn = h(
    'button',
    {
      type: 'button',
      class: 'score-watch',
      'aria-label': `Scan the watch code into ${T.endN(endNo).toLowerCase()}`,
      onClick: () => scanWatch(ctx),
      dataset: { fk: 'watch-scan' },
    },
    icons.watch(),
    'Watch',
  );

  // --- the End n details sheet: let-downs, correct let-downs and the note (same handlers as before)
  const stepper = (key, label) =>
    APL.Section({
      label,
      id: `end-${key}`,
      children: APL.Stepper({
        label: label.toLowerCase(),
        value: current[key],
        min: 0,
        onChange: (v) => update(ctx, (c) => L.bump(c, key, v - current[key])),
        fk: key,
      }),
    });

  const detailsSheet = () => {
    const close = () => setSheet(null);
    return {
      onClose: close,
      returnFk: 'details-ld',
      node: APL.Dialog({
        sheet: true,
        title: T.endDetails(endNo),
        idPrefix: 'score-details',
        onClose: close,
        closeLabel: 'Close',
        children: h(
          'div',
          { class: 'end-details' },
          h('div', { class: 'apl-grid-2' }, stepper('ld', T.letDowns), stepper('cld', T.correctLetDowns)),
          APL.TextArea({
            label: T.noteForEnd,
            rows: 3,
            placeholder: T.notePh,
            value: current.note,
            fk: 'note',
            onInput: (e) => update(ctx, (c) => L.setNote(c, e.target.value), { rerender: false }),
          }),
          APL.Button({ children: 'Done', onClick: close, fk: 'details-done' }),
        ),
      }),
    };
  };

  // --- Total (reached by scrolling): the session's running total, then its ends: the end being
  // shot first (live, accent edge), then the earlier ones, newest first. Tapping one opens it.
  const shownIdx = L.viewIndex(session);
  const endCard = (r) =>
    h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          class: ['total-end', r.isCurrent && 'is-current', r.index === shownIdx && 'is-viewed'],
          'aria-label': `${r.isCurrent ? 'End being shot' : 'Open end'} ${r.n}: ${r.sum} points, average ${fmt(r.avg)}, let-downs ${r.ld}, correct ${r.cld}, total ${r.run}`,
          'aria-current': r.index === shownIdx ? 'true' : null,
          onClick: () => update(ctx, (c) => L.goToEnd(c, r.index)),
          dataset: { fk: `total-end-${r.n}` },
        },
        h('span', { class: 'total-end-no' }, `E${r.n}`),
        h(
          'span',
          { class: 'total-end-body' },
          h(
            'span',
            { class: 'total-end-arrows', 'aria-hidden': 'true' },
            r.arrows.map((a) => h('span', { class: `score-chip z-${zoneOf(a.v)}` }, a.v == null ? '–' : String(a.v))),
          ),
          h(
            'span',
            { class: 'total-end-meta' },
            [`⌀ ${fmt(r.avg)}`, graded && `M ${fmt(r.avgM)} · S ${fmt(r.avgS)}`, `${r.ld}/${r.cld}`, r.isCurrent && 'now'].filter(Boolean).join(' · '),
          ),
        ),
        h('span', { class: 'total-end-score' }, h('strong', null, String(r.sum)), h('span', null, `Σ ${r.run}`)),
      ),
    );
  const totalSection = h(
    'section',
    { class: 'score-total', 'aria-labelledby': 'score-total-title' },
    h(
      'div',
      { class: 'score-total-head' },
      h('h2', { id: 'score-total-title' }, T.total),
      h(
        'span',
        { class: 'score-total-figures' },
        h('span', { class: 'score-total-avg', 'aria-label': `average arrow ${fmt(sessionAverage(session))}` }, `⌀ ${fmt(sessionAverage(session))}`),
        h('strong', null, String(sessionTotal(session))),
      ),
    ),
    h('ol', { class: 'total-ends' }, endRows(session).reverse().map(endCard)),
  );

  return {
    content: h(
      'div',
      { class: 'apl-screen' },
      // the top bar (end, timer, Finish) stays on screen while Total is scrolled to
      header,
      h(
        'div',
        { class: 'apl-screen-body log-body' },
        h('section', { class: 'score-screen', 'aria-label': T.endN(endNo) }, strip, input, under, chips),
        totalSection,
        // all placed arrows so far on one face, with the group centre (nothing before the first one)
        groupSection(
          { ...session, ends: [...session.ends, session.current] },
          { filters: false, sight: { eyeToPinCm: eyeToPinOf(session, ctx.repo.list('setups')) }, shaftMm: shaftMmOf(session, ctx.repo.list('setups')) },
        ),
      ),
      APL.BottomBar({ children: h('div', { class: 'score-actions' }, prevBtn, nextBtn, watchBtn, photoButton(ctx, session)) }),
    ),
    overlay: sheet === 'details' ? detailsSheet() : scoreOverlay(ctx, session, { sheet, setSheet }),
  };
}

// ---------------------------------------------------------------- sheets over the scoring screen

/** The sheet open over the scoring screen (ui state `score`, kept per session). */
function scoreSheet(ctx, session) {
  const cur = ctx.ui.get().score;
  const sheet = cur?.id === session.id ? cur.sheet : null;
  return { sheet, setSheet: (next) => ctx.ui.set({ score: { id: session.id, sheet: next } }) };
}

/** The type of the running session (training or competition). */
const runningType = (ctx) => sessionType(ctx.ongoing.running.get() ?? {});

/** Finish (after the Finish sheet's yes): the overview opens with the review to write. */
async function finishFromPage(ctx) {
  ctx.ui.quietSet({ score: null });
  const res = await ctx.ongoing.finish(runningType(ctx), { confirmed: true });
  if (res.next) ctx.navigate(res.next, { replace: true });
  else ctx.rerender();
}

/** Discard (from the Finish sheet, after a yes to "Discard session?"): the session is deleted, the Dashboard opens. */
async function discardFromPage(ctx) {
  ctx.ui.quietSet({ score: null });
  const res = await ctx.ongoing.discard(runningType(ctx));
  if (res.next) ctx.navigate(res.next, { replace: true });
  else ctx.rerender();
}

function scoreOverlay(ctx, session, { sheet, setSheet }) {
  const close = () => setSheet(null);
  if (sheet === 'finish') return finishSheet(ctx, session, close);
  return null;
}

/** "End the session": Finish and save · Discard session (asks first) · Keep shooting. */
function finishSheet(ctx, session, close) {
  const c = sessionCounts(session);
  const clock = L.formatClock(L.timerElapsed(session.timer || { running: false, elapsedMs: 0 }));
  const summary = [
    `${c.ends} ${c.ends === 1 ? 'end' : 'ends'}`,
    `${c.arrows} ${c.arrows === 1 ? 'arrow' : 'arrows'}`,
    `total ${c.total}`,
    clock,
  ].join(' · ');
  return {
    onClose: close,
    returnFk: 'finish-open',
    node: APL.Dialog({
      sheet: true,
      title: T.endSession,
      idPrefix: 'score-finish',
      onClose: close,
      closeLabel: T.keepShooting,
      children: h(
        'div',
        { class: 'score-sheet' },
        h('p', { class: 'score-sheet-summary' }, summary),
        APL.Button({
          children: T.finishAndSave,
          leadingIcon: icons.check(),
          disabled: !L.canFinish(session),
          onClick: () => finishFromPage(ctx),
          fk: 'finish',
        }),
        h(
          'button',
          { type: 'button', class: 'score-danger-btn', onClick: () => discardFromPage(ctx), dataset: { fk: 'discard' } },
          icons.trash(),
          T.discardSession,
        ),
        h('button', { type: 'button', class: 'score-text-btn', onClick: close, dataset: { fk: 'keep-shooting' } }, T.keepShooting),
      ),
    }),
  };
}

// ---------------------------------------------------------------- the watch code

/**
 * Scan the watch code of an end (Arrow Grades on the archer's watch) into the shown end: the slots
 * get M, S, heart rate and the arrow number in arrow-number order, ready to be scored in that order.
 * Grades or scores already in the end are only replaced after a yes.
 */
async function scanWatch(ctx) {
  const code = await watchScan();
  if (!code) return;
  const session = ctx.ongoing.running.get();
  if (!session) return;
  const end = L.shownEnd(session);
  // a session without grading takes the shot timing and the heart rate only
  const ungraded = !isGraded(session);
  const dropped = ungraded && code.arrows.length > 0;
  if (ungraded) code.arrows = [];
  const n = code.arrows.length;
  if (!n && !code.trace && !code.detected?.length) {
    ctx.toast('The watch code has no arrows, no shots and no heart rate yet.');
    return;
  }
  if (n > end.arrows.length) {
    ctx.toast(`The watch code has ${n} arrows; this end has ${end.arrows.length} slots.`);
    return;
  }
  const touched = end.arrows.slice(0, n).some((a) => a.v != null || a.m != null || a.s != null);
  if (
    touched &&
    !(await confirmDialog({
      title: 'Replace the grades?',
      message: `The watch grades go into slots 1–${n} in arrow-number order (#${code.arrows.map((a) => a.no).join(', #')}). Grades already there are replaced; scores stay.`,
      confirmLabel: 'Replace',
    }))
  ) {
    return;
  }
  // grading on the watch is optional: an end closed without grades still brings its heart rate
  if (!update(ctx, (cur) => L.applyWatchGrades(cur, code))) return;
  if (dropped) ctx.toast('This session is without grading: the watch’s shot timing and heart rate were taken, its grades were not.');
  if (n) announce(`Watch grades for ${n} ${n === 1 ? 'arrow' : 'arrows'}: score them in the order #${code.arrows.map((a) => a.no).join(', #')}.`);
  // what the watch recorded through the end; OK goes on to scoring it
  const shown = ctx.ongoing.running.get();
  if (shown) await showWatchEnd(L.shownEnd(shown), { title: `${T.endN(L.viewIndex(shown) + 1)} · from the watch` });
}

// ---------------------------------------------------------------- the Scan

/**
 * Camera button: scan the target with the live camera (or take / pick a photo from there); arrows
 * found fill the end after a preview. Best effort: wrong ones are dragged on the picture
 * afterwards. Pictures are never stored in the journal; the raw one is kept (Google Photos, or a
 * download) when Settings › Scan says so (scanPhoto.js).
 */
function photoButton(ctx, session) {
  // the scoring screen's most used button: outlined in accent, next to Undo in the bottom bar
  return h(
    'button',
    {
      type: 'button',
      class: 'score-scan',
      'aria-label': 'Score arrows with the camera',
      disabled: !canScan(session),
      onClick: () => scanTarget(ctx),
      dataset: { fk: 'photo' },
    },
    icons.camera(),
    'Scan',
  );
}

/**
 * Scan the target into the shown end. The sequence (a full end first, the two looks at a photo,
 * the found arrows, Use) is scan.js's; this page lends it the camera, the photo, the detector and
 * the preview dialog.
 */
async function scanTarget(ctx) {
  // the arrows are scored and drawn as wide as the session's setup says
  const shaftMm = shaftMmOf(ctx.ongoing.running.get(), ctx.repo.list('setups'));
  const scan = createScan({
    running: ctx.ongoing.running,
    shaftMm,
    // the live camera: the archer fits the target in its frame and takes the photo
    camera: async (room) => {
      const got = await liveScan({ face: room.face });
      // the raw picture the arrows are read from is kept on the phone (a gallery photo is there
      // already); where no full-size photo could be taken it is the video frame, a canvas
      if (got?.taken) ctx.scanPhotos?.save(got.file instanceof HTMLCanvasElement ? { canvas: got.file } : got, room.face);
      return got;
    },
    openPhoto,
    detect: (canvas, room) =>
      detectArrows(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), room.face, room.empty, { spotHint: room.spotHint }),
    preview: ({ found, picture, again }) => previewFound(picture, found, { cancelLabel: again ? 'Back to camera' : 'Cancel' }),
    onChange: () => ctx.rerender(),
    // Settings › Scan › Arrows found by: the neural network reads the arrows again on the picture
    reread:
      scanMethod(ctx.repo.getSettings()) === 'network'
        ? async (canvas, res, room) =>
            arrowsByNet(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), res, room.face, room.empty, await loadArrowNet(), {
              spotHint: room.spotHint,
            })
        : null,
    onRereadFailed: (err) => {
      console.error(err);
      ctx.toast('The neural network is not available here (offline before it was ever downloaded?). The arrows are read by the rules.');
    },
    working: scanWorking(),
  });
  const res = await scan.start();
  if (res.status === 'used') ctx.rerender();
  else if (res.status === 'unreadable') ctx.toast('Could not open the photo.');
  else if (res.status === 'no-target') ctx.toast(res.error);
}

/**
 * What the Scan is doing between the camera closing and the found arrows being shown (a full-size
 * photo read, the neural network asked: some seconds on a phone): a screen of its own, so the
 * session page does not look as if the Scan was over. Called with a text to show or update it, with
 * null to take it away.
 */
function scanWorking() {
  let dialog = null;
  let label = null;
  return (text) => {
    if (text == null) {
      dialog?.close();
      dialog?.remove();
      dialog = null;
      return;
    }
    if (!dialog) {
      label = h('p', { class: 'scan-working-text' });
      dialog = h(
        'dialog',
        { class: 'scan-working', 'aria-label': 'Reading the target', role: 'status', 'aria-live': 'polite' },
        h('span', { class: 'scan-working-spinner', 'aria-hidden': 'true' }),
        label,
      );
      // nothing to cancel: the reading ends by itself
      dialog.addEventListener('cancel', (e) => e.preventDefault());
      document.body.append(dialog);
      dialog.showModal();
    }
    label.textContent = text;
  };
}

/** A photo opened for the Scan: a part of it is drawn on a canvas of its own (see createScan). */
async function openPhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw(box, scale) {
      const canvas = h('canvas', { class: 'photo-preview' });
      canvas.width = Math.round(box.w * scale);
      canvas.height = Math.round(box.h * scale);
      canvas
        .getContext('2d', { willReadFrequently: true })
        .drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
      return canvas;
    },
    close: () => bitmap.close(),
  };
}

/**
 * Show the picture with what was found (the face's rings, each arrow numbered with its score);
 * dragging a score label moves its arrow. Resolves with the archer's answer (Use / OK, or not).
 */
async function previewFound(canvas, found, { cancelLabel }) {
  const g = canvas.getContext('2d');
  // the clean photo is kept, so the marks can be drawn again when a label is dragged
  const photo = document.createElement('canvas');
  photo.width = canvas.width;
  photo.height = canvas.height;
  photo.getContext('2d').drawImage(canvas, 0, 0);
  // Where the detector thinks the scoring rings are: drawn over the photo, so a ring that does not
  // sit on the printed one shows at a glance.
  // (a ring as it lies in the picture: in perspective it is not the spot's ellipse scaled)
  const ringPath = (o, f) => {
    ringPoints(o, f).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
  };
  const redraw = () => {
    g.drawImage(photo, 0, 0);
    // while an arrow is dragged, the ring it is in right now is tinted
    const held = found.heldRing();
    if (held) {
      g.beginPath();
      ringPath(held.outer, held.edge);
      if (held.inner > 0) ringPath(held.outer, held.inner);
      g.fillStyle = 'rgba(0, 229, 255, 0.38)';
      g.fill('evenodd');
    }
    const line = Math.max(2, canvas.width / 220);
    g.strokeStyle = '#00e5ff';
    for (const s of found.spots) {
      found.rings.forEach((f) => {
        // the outer edge as before; the rings inside it thinner, so the photo stays readable
        g.lineWidth = f === 1 ? line : Math.max(1, line * 0.45);
        g.globalAlpha = f === 1 ? 1 : 0.8;
        g.beginPath();
        ringPath(s.outer, f);
        g.stroke();
      });
    }
    g.globalAlpha = 1;
    drawArrowMarks(g, found.spots, found.arrows, found.scores(), { active: found.held, long: true, arrowR: found.arrowR });
  };
  redraw();

  // --- dragging a score label moves its arrow: the line's end is the point of impact, the label
  // keeps its distance to it, and the score in the label follows the rings under the point
  const pictureXY = (ev) => {
    const r = canvas.getBoundingClientRect();
    // the canvas is shown with object-fit: contain, so it may be letterboxed inside its box
    const k = Math.max(canvas.width / r.width, canvas.height / r.height);
    return {
      x: (ev.clientX - (r.left + r.width / 2)) * k + canvas.width / 2,
      y: (ev.clientY - (r.top + r.height / 2)) * k + canvas.height / 2,
      k,
    };
  };
  let pointer = null; // the pointer holding a label
  canvas.addEventListener('pointerdown', (ev) => {
    if (!ev.isPrimary || ev.button > 0 || pointer !== null) return;
    const p = pictureXY(ev);
    // the nearest label (or its point of impact) within about a fingertip
    if (!found.grab(p, 26 * p.k)) return;
    ev.preventDefault();
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* pointer already gone */
    }
    pointer = ev.pointerId;
    if (navigator.vibrate) navigator.vibrate(15);
    redraw();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (pointer === null || ev.pointerId !== pointer) return;
    found.drag(pictureXY(ev));
    redraw();
  });
  const drop = (ev) => {
    if (pointer === null || ev.pointerId !== pointer) return;
    pointer = null;
    found.drop();
    redraw();
  };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);
  canvas.classList.add('is-adjustable');

  // Just the picture with the found arrows and the two buttons. Only when nothing was found does
  // the dialog say so (a picture without marks would explain nothing).
  return confirmDialog(
    found.arrows.length
      ? { title: `Found arrows: ${found.scores().join(', ')}`, bare: true, confirmLabel: 'Use', cancelLabel, body: canvas }
      : {
          title: 'No arrows found',
          message: 'Try a photo taken straight at the target, close enough that the face fills the picture.',
          confirmLabel: 'OK',
          cancelLabel,
          icon: 'camera',
          body: canvas,
        },
  );
}

// ---------------------------------------------------------------- target face

const LOUPE_SPAN = 24; // viewBox units shown in the magnifier (the face is 202 wide → ~3× zoom)
// A finger aiming a new arrow aims this many screen pixels above itself, so it never hides the point.
const AIM_OFFSET_PX = 64;
// A finger on the face is undecided at first: held still this long it aims; moved further than
// TOUCH_SLOP_PX before that, mostly up or down, it scrolls the page and places no arrow.
const AIM_HOLD_MS = 140;
const TOUCH_SLOP_PX = 10;
const LOUPE_SIZE = 132; // the loupe's lens, in px (base.css .loupe-lens, via --loupe-size)
const LOUPE_MAX_SHARE = 0.4; // …at most this share of the stage's width
// The spot an arrow was just placed on (multi-spot sheets): placing re-renders the page, and the new
// target starts zoomed on this spot and animates out to the whole sheet (the reverse of the zoom in).
let zoomOutFrom = null;

// An arrow on the face is drawn as the hole its shaft makes, at its real size (arrowRadius): it
// scores by the ring lines that hole touches. Its number sits on a label beside it, tied to the
// hole by a short line, so the label never hides which line the hole touches.
const LABEL_R = 5.2; // the number label's radius (face units: one spot's radius = 100)
const LABEL_GAP = 4; // between the hole's edge and the label's
const LABEL_BASELINE = 1.9; // the number's baseline below the label's centre

/** The arrow's radius on the face, in face units, for a shaft `shaftMm` wide. */
const holeRadius = (face, shaftMm) => arrowRadius(face, shaftMm) * 100;

/**
 * Where an arrow's label sits, from the hole's middle (face units): outwards from its spot's
 * centre (`x`, `y`: the arrow on its spot, one spot's radius = 1), up and to the right near the
 * centre, where outwards has no clear direction.
 */
function labelOffset(x, y, r) {
  const d = Math.hypot(x, y);
  const [ux, uy] = d < 0.12 ? [Math.SQRT1_2, -Math.SQRT1_2] : [x / d, y / d];
  const reach = r + LABEL_GAP + LABEL_R;
  return { x: ux * reach, y: uy * reach };
}

/** The leader line from the hole's edge to the label's, for a label at `off` (labelOffset). */
function leaderEnds(off, r) {
  const d = Math.hypot(off.x, off.y);
  const [ux, uy] = [off.x / d, off.y / d];
  return { x1: ux * r, y1: uy * r, x2: ux * (d - LABEL_R), y2: uy * (d - LABEL_R) };
}

/**
 * The parts of one arrow's mark, drawn round the hole's middle: the leader, the hole and the
 * numbered label. `parts` (optional) gets the elements, to move them while the arrow is dragged.
 */
function arrowMark(r, off, label, parts = {}) {
  parts.leader = s('line', { ...leaderEnds(off, r), stroke: '#E5007E', 'stroke-width': 1.1, 'stroke-linecap': 'round' });
  // a thin white rim the same on every zoom, so even a 122 cm face's tiny hole shows on any ring
  parts.hole = s('circle', {
    class: 'arrow-hole',
    r,
    fill: '#E5007E',
    stroke: '#FFFFFF',
    'stroke-width': 1,
    'vector-effect': 'non-scaling-stroke',
  });
  parts.text = s('text', { x: off.x, y: off.y + LABEL_BASELINE, 'text-anchor': 'middle', 'font-size': 5.6, 'font-weight': 700, fill: '#FFFFFF' }, label);
  parts.label = s('circle', { cx: off.x, cy: off.y, r: LABEL_R, fill: '#E5007E', stroke: '#FFFFFF', 'stroke-width': 1 });
  return [parts.leader, parts.hole, parts.label, parts.text];
}

/** Move the parts of arrowMark to a label at `off`. */
function placeLabel(parts, r, off) {
  for (const [k, v] of Object.entries(leaderEnds(off, r))) parts.leader.setAttribute(k, v);
  parts.label.setAttribute('cx', off.x);
  parts.label.setAttribute('cy', off.y);
  parts.text.setAttribute('x', off.x);
  parts.text.setAttribute('y', off.y + LABEL_BASELINE);
}

function arrowDots(session, shaftMm) {
  const at = (a) => sheetPoint(a, session.face);
  const r = holeRadius(session.face, shaftMm);
  // only the shown end's arrows: dots of the other ends lay under these and looked like arrows that
  // would not delete
  const cur = L.shownEnd(session)
    .arrows.map((a, i) => ({ a, i }))
    .filter(({ a }) => a.x != null);
  const movingIdx = L.isEditing(session) ? session.cursor : -1;
  return [
    ...cur.map(({ a, i }) =>
      s(
        'g',
        { transform: `translate(${at(a).x} ${at(a).y})`, opacity: i === movingIdx ? 0.55 : null, 'data-arrow': i },
        // the arrow being moved gets a dashed ring so you can see which one will change
        i === movingIdx
          ? s('circle', {
              r: r + 3,
              fill: 'none',
              stroke: '#E5007E',
              'stroke-width': 1.2,
              'stroke-dasharray': '2.5 2',
            })
          : null,
        ...arrowMark(r, labelOffset(a.x, a.y, r), String(i + 1)),
      ),
    ),
  ];
}

/**
 * Target face input. Touch (or press) shows a magnifier with the exact hit point and its score;
 * moving the finger fine-tunes the position; releasing registers the arrow. Cancel = no arrow.
 * Multi-spot sheets (triple, Vegas): the first tap zooms into the spot tapped, so it fills the
 * target area; the arrow is then placed on it the same way, and the view zooms back out.
 * A finger aims a little above itself (AIM_OFFSET_PX); the magnifier docks in a corner of the stage
 * away from the finger and the aimed point.
 */
function targetInput(session, enter, { hintSpot = null, onMove, shaftMm } = {}) {
  const holeR = holeRadius(session.face, shaftMm);
  // magnifier: zoomed copy of the face centred on the aimed point, with the arrow's hole at its real
  // size (the lines it touches decide the score) and the live score
  const marker = s('circle', {
    r: holeR,
    fill: 'rgba(229, 0, 126, 0.35)',
    stroke: '#E5007E',
    'stroke-width': 1.5,
    'vector-effect': 'non-scaling-stroke',
  });
  const loupeSvg = s(
    'svg',
    { 'aria-hidden': 'true', focusable: 'false' },
    faceSheet(session.face),
    arrowDots(session, shaftMm),
    marker,
  );
  const loupeScore = h('span', { class: 'score-chip loupe-score' });
  // shown while a placed arrow is dragged: which arrow moves, and the score it had
  const loupeTag = h('span', { class: 'loupe-tag', hidden: true });
  // docked in a corner of the stage: the lens, and the live score under it
  const loupeLens = h('div', { class: 'loupe-lens' }, loupeSvg, loupeTag);
  const loupe = h('div', { class: 'loupe', 'aria-hidden': 'true', hidden: true }, loupeLens, loupeScore);
  // on the sheet, a move looks different from a new arrow: the arrow's own numbered dot travels with
  // the finger, tied to the place it came from by a dashed line
  const guideLine = s('line', { stroke: '#E5007E', 'stroke-width': 1.6, 'stroke-dasharray': '3.5 2.5', 'stroke-linecap': 'round' });
  const guideFrom = s('circle', { r: holeR + 3, fill: 'none', stroke: '#E5007E', 'stroke-width': 1.2, 'stroke-dasharray': '2.5 2' });
  // the moved arrow's own mark (hole and numbered label), its label turning as it moves
  const guideParts = {};
  const guideDot = s('g', null, s('circle', { r: holeR + 3, fill: 'rgba(229, 0, 126, 0.25)' }), ...arrowMark(holeR, { x: 0, y: -1 }, '', guideParts));
  const guideNumber = guideParts.text;
  const moveGuide = s('g', { class: 'move-guide', visibility: 'hidden' }, guideLine, guideFrom, guideDot);

  let active = null; // { id, p, mode } with p in sheet coordinates (one spot's radius = 1)
  const multi = isMultiSpot(session.face);
  let zoomed = null; // index of the spot zoomed into (multi-spot sheets), or null
  const sheet = s(
    'svg',
    { viewBox: faceViewBox(session.face), 'aria-hidden': 'true', focusable: 'false' },
    faceSheet(session.face),
    // the spot suggested for the selected arrow: only a hint, any spot can be tapped
    hintSpot != null
      ? s('circle', {
          class: 'spot-hint',
          cx: spotCentres(session.face)[hintSpot][0],
          cy: spotCentres(session.face)[hintSpot][1],
          r: 100,
        })
      : null,
    arrowDots(session, shaftMm),
    moveGuide,
  );
  const btn = h(
    'button',
    {
      type: 'button',
      class: ['target-btn', multi && 'target-sheet'],
      'aria-label': multi
        ? 'Target sheet: tap a spot to zoom in, then touch where the arrow landed, slide to fine-tune, release to score (keyboard users: use Keypad)'
        : 'Target face: touch where the arrow landed, slide to fine-tune, release to score (keyboard users: use Keypad)',
    },
    sheet,
  );

  // --- zoom (multi-spot sheets): animate the sheet's viewBox between the whole sheet and one spot
  const fullBox = faceViewBox(session.face).split(' ').map(Number);
  const spotBox = (i) => {
    const [cx, cy] = spotCentres(session.face)[i];
    return [cx - VB, cy - VB, VB * 2, VB * 2];
  };
  let anim = 0;
  const setBox = (to) => {
    cancelAnimationFrame(anim);
    const from = sheet.getAttribute('viewBox').split(' ').map(Number);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sheet.setAttribute('viewBox', to.join(' '));
      return;
    }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 200);
      const e = 1 - (1 - k) ** 3; // ease-out
      sheet.setAttribute('viewBox', from.map((f, j) => f + (to[j] - f) * e).join(' '));
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  // the row over a multi-spot sheet: "All spots" (back to the whole sheet) while zoomed into one
  const zoomOutBtn = h(
    'button',
    { type: 'button', class: 'zoom-out-btn', hidden: true, 'aria-label': 'Show all spots', onClick: () => zoomTo(null) },
    icons.back(),
    'All spots',
  );
  const faceBar = multi ? h('div', { class: 'face-bar' }, zoomOutBtn) : null;
  if (multi && zoomOutFrom != null) {
    sheet.setAttribute('viewBox', spotBox(zoomOutFrom).join(' '));
    zoomOutFrom = null;
    requestAnimationFrame(() => setBox(fullBox));
  }
  function zoomTo(i) {
    zoomed = i;
    setBox(i == null ? fullBox : spotBox(i));
    btn.classList.toggle('is-zoomed', i != null);
    zoomOutBtn.hidden = i == null;
  }

  // --- one gesture's geometry, read once when the pointer lands (no layout reads while it moves)
  let geo = null; // { rect, inv, unitsPerPx }
  const readGeometry = () => {
    const rect = btn.getBoundingClientRect();
    const vb = sheet.getAttribute('viewBox').split(' ').map(Number);
    return {
      rect,
      // screen → SVG units (the sheet may be letterboxed inside the square button)
      inv: sheet.getScreenCTM()?.inverse() ?? null,
      // one screen pixel in SVG units (the sheet is letterboxed with "meet")
      unitsPerPx: Math.max(vb[2] / rect.width, vb[3] / rect.height),
      // the loupe's lens: 132px, smaller on a small stage so the finger and the aim keep room
      loupeSize: Math.min(LOUPE_SIZE, Math.round(rect.width * LOUPE_MAX_SHARE)),
    };
  };
  const toSheet = (clientX, clientY) => {
    const pt = geo.inv ? new DOMPoint(clientX, clientY).matrixTransform(geo.inv) : { x: 0, y: 0 };
    return { x: pt.x / 100, y: pt.y / 100 };
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // A pointer position: `x`, `y` the aimed point on the sheet (one spot's radius = 1), `fx`, `fy`
  // the finger on the sheet, `px`, `py` the finger inside the stage. With `offset` (a finger aiming
  // a new arrow) the aimed point is AIM_OFFSET_PX above the finger, so the finger never hides it,
  // and kept inside the stage; the finger itself may go below it. A mouse or pen aims where it points.
  const toFace = (ev, { offset = false } = {}) => {
    const { rect } = geo;
    const finger = toSheet(ev.clientX, ev.clientY);
    const aim = offset
      ? toSheet(clamp(ev.clientX, rect.left, rect.right), clamp(ev.clientY - AIM_OFFSET_PX, rect.top, rect.bottom))
      : finger;
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    // the aimed point inside the stage, in pixels (for docking the loupe away from it)
    const apx = offset ? clamp(px, 0, rect.width) : px;
    const apy = offset ? clamp(py - AIM_OFFSET_PX, 0, rect.height) : py;
    return { x: aim.x, y: aim.y, fx: finger.x, fy: finger.y, px, py, apx, apy };
  };

  // on the sheet while a finger aims: a crosshair at the aimed point, a faint ring where the finger
  // is, and a thin line between them (drawn in screen pixels, scaled to the sheet per gesture)
  const crosshair = s(
    'g',
    null,
    s('path', { d: 'M0 -17v11M0 6v11M-17 0h11M6 0h11', stroke: '#14181C', 'stroke-opacity': 0.6, 'stroke-width': 4, 'stroke-linecap': 'round' }),
    s('path', { d: 'M0 -17v11M0 6v11M-17 0h11M6 0h11', stroke: '#FFFFFF', 'stroke-width': 2, 'stroke-linecap': 'round' }),
  );
  // the arrow's hole at the aimed point, at its real size (not scaled with the crosshair)
  const aimHole = s('circle', {
    r: holeR,
    fill: 'rgba(229, 0, 126, 0.5)',
    stroke: '#FFFFFF',
    'stroke-width': 1.5,
    'vector-effect': 'non-scaling-stroke',
  });
  const fingerRing = s('circle', {
    r: 28,
    fill: 'rgba(255, 255, 255, 0.1)',
    stroke: 'rgba(255, 255, 255, 0.7)',
    'stroke-width': 2,
    'stroke-dasharray': '5 4',
  });
  const aimLine = s('line', { stroke: 'rgba(255, 255, 255, 0.7)', 'stroke-linecap': 'round' });
  const aimGuide = s('g', { class: 'aim-guide', visibility: 'hidden' }, aimLine, fingerRing, crosshair, aimHole);
  sheet.append(aimGuide);
  const drawAimGuide = (p) => {
    const k = geo.unitsPerPx;
    const [ax, ay, fx, fy] = [p.x * 100, p.y * 100, p.fx * 100, p.fy * 100];
    crosshair.setAttribute('transform', `translate(${ax} ${ay}) scale(${k})`);
    aimHole.setAttribute('cx', ax);
    aimHole.setAttribute('cy', ay);
    fingerRing.setAttribute('transform', `translate(${fx} ${fy}) scale(${k})`);
    // the line runs from under the crosshair to the ring's edge, when there is room for it
    const d = Math.hypot(fx - ax, fy - ay);
    const from = 17 * k;
    const to = d - 28 * k;
    aimLine.setAttribute('visibility', to > from ? 'visible' : 'hidden');
    if (to > from) {
      const [ux, uy] = [(fx - ax) / d, (fy - ay) / d];
      aimLine.setAttribute('x1', ax + ux * from);
      aimLine.setAttribute('y1', ay + uy * from);
      aimLine.setAttribute('x2', ax + ux * to);
      aimLine.setAttribute('y2', ay + uy * to);
      aimLine.setAttribute('stroke-width', 1.5 * k);
    }
    aimGuide.setAttribute('visibility', 'visible');
  };

  // The loupe docks inside the stage, in a corner away from the finger and the aimed point
  // (loupePlacement.js); it changes corner only past a band, so it does not flicker.
  let corner = null;
  const dockLoupe = (p) => {
    const stage = { stageW: geo.rect.width, stageH: geo.rect.height, size: geo.loupeSize };
    const next = loupeCorner({ fingerX: p.px, fingerY: p.py, aimX: p.apx, aimY: p.apy, ...stage, prevCorner: corner });
    if (next === corner) return;
    corner = next;
    const box = loupeBox(corner, stage);
    loupe.style.left = `${Math.round(box.x)}px`;
    loupe.style.top = `${Math.round(box.y)}px`;
  };

  const show = (p) => {
    const cx = p.x * 100;
    const cy = p.y * 100;
    loupeSvg.setAttribute(
      'viewBox',
      `${cx - LOUPE_SPAN / 2} ${cy - LOUPE_SPAN / 2} ${LOUPE_SPAN} ${LOUPE_SPAN}`,
    );
    marker.setAttribute('transform', `translate(${cx} ${cy})`);
    const hit = locateOnSheet(p.x, p.y, session.face);
    const v = scoreArrow(hit.x, hit.y, session.face, shaftMm);
    loupeScore.textContent = String(v);
    loupeScore.className = `score-chip loupe-score z-${zoneOf(v)}`;
    dockLoupe(p);
    loupe.hidden = false;
    if (active?.offset) drawAimGuide(p);
    if (active?.mode === 'move') {
      const from = active.origin;
      guideLine.setAttribute('x1', from.x * 100);
      guideLine.setAttribute('y1', from.y * 100);
      guideLine.setAttribute('x2', cx);
      guideLine.setAttribute('y2', cy);
      guideFrom.setAttribute('cx', from.x * 100);
      guideFrom.setAttribute('cy', from.y * 100);
      guideDot.setAttribute('transform', `translate(${cx} ${cy})`);
      placeLabel(guideParts, holeR, labelOffset(hit.x, hit.y, holeR));
    }
  };

  // the aimed point: the finger's, shifted by the grab offset (finger px / py stay the finger's)
  const aimFrom = (f, off) => ({
    ...f,
    x: f.x + off.x,
    y: f.y + off.y,
    apx: f.apx + (off.x * 100) / geo.unitsPerPx,
    apy: f.apy + (off.y * 100) / geo.unitsPerPx,
  });
  // the placed arrow of the shown end nearest the pointer (by its hole or its label), within
  // `reachPx` on the screen
  const grabAt = (f, reachPx) => {
    const reach = (reachPx * geo.unitsPerPx) / 100;
    let best = null;
    L.shownEnd(session).arrows.forEach((a, i) => {
      if (a.v == null || a.x == null) return;
      const d = sheetPoint(a, session.face);
      const dot = { x: d.x / 100, y: d.y / 100 };
      const off = labelOffset(a.x, a.y, holeR);
      const dist = Math.min(
        Math.hypot(dot.x - f.x, dot.y - f.y),
        Math.hypot(dot.x + off.x / 100 - f.x, dot.y + off.y / 100 - f.y),
      );
      if (dist <= reach && (!best || dist < best.dist)) best = { i, dist, off: { x: dot.x - f.x, y: dot.y - f.y } };
    });
    return best;
  };

  // pointer moves are applied once per frame: the latest position wins
  let frame = 0;
  let pending = null;
  const applyMove = (pos) => {
    if (active.mode === 'pick') {
      active.p = toFace(pos);
      return;
    }
    active.moved = Math.max(active.moved, Math.hypot(pos.clientX - active.from.x, pos.clientY - active.from.y));
    active.p = aimFrom(toFace(pos, { offset: active.offset }), active.off);
    show(active.p);
  };
  const flushMove = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    const pos = pending;
    pending = null;
    if (pos && active) applyMove(pos);
  };

  // A finger not yet decided between aiming and scrolling (see AIM_HOLD_MS)
  let holdTimer = 0;
  const decide = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;
    if (!active?.pending) return;
    active.pending = false;
    activate();
  };

  const end = (ev, commit) => {
    if (!active || ev.pointerId !== active.id) return;
    clearTimeout(holdTimer);
    holdTimer = 0;
    // the last move counts (it may still be waiting for its frame); a cancelled touch drops it
    if (commit) flushMove();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
    }
    const { p, mode, idx, tapPicks, moved } = active;
    active = null;
    loupe.hidden = true;
    loupe.classList.remove('is-moving');
    loupeTag.hidden = true;
    moveGuide.setAttribute('visibility', 'hidden');
    aimGuide.setAttribute('visibility', 'hidden');
    btn.classList.remove('aiming', 'moving');
    sheet.querySelector('.is-grabbed')?.classList.remove('is-grabbed');
    if (!commit) return;
    // a tap on the whole sheet zooms into the spot tapped
    // (also a tap on an arrow there: only a drag moves it)
    if (mode === 'pick' || (tapPicks && moved < 8)) {
      zoomTo(locateOnSheet(p.x, p.y, session.face).spot);
      return;
    }
    if (multi) zoomOutFrom = zoomed;
    const hit = locateOnSheet(p.x, p.y, session.face);
    // a touch off the face keeps its score but no position (sessionLogic's ON_FACE rule)
    const args = [scoreArrow(hit.x, hit.y, session.face, shaftMm), hit.x, hit.y, hit.spot];
    // a placed arrow that was dragged moves; otherwise the touch enters a score
    if (mode === 'move') onMove(idx, ...args);
    else enter(...args);
    // nothing was entered (the page did not re-render): zoom out here instead
    if (multi && btn.isConnected) {
      zoomOutFrom = null;
      zoomTo(null);
    }
  };

  btn.addEventListener('pointerdown', (ev) => {
    if (!ev.isPrimary || ev.button > 0 || active) return;
    ev.preventDefault();
    try {
      btn.setPointerCapture(ev.pointerId); // keep receiving moves when the finger leaves the face
    } catch {
      /* pointer already gone */
    }
    geo = readGeometry();
    loupe.style.setProperty('--loupe-size', `${geo.loupeSize}px`);
    const p = toFace(ev); // the finger itself: picking a spot and grabbing an arrow work under it
    // Touching a placed arrow of this end grabs it: dragging moves it (the pointer keeps its distance
    // to the dot, so the dot does not jump under the finger). A finger covers the dot and lands
    // less exactly than a mouse, so it reaches further. On a sheet of several spots this works on
    // the whole sheet too, without zooming in first.
    const whole = multi && zoomed == null;
    const grab = onMove ? grabAt(p, ev.pointerType === 'mouse' ? 26 : whole ? 34 : 44) : null;
    const from = { x: ev.clientX, y: ev.clientY, moved: 0 };
    // A finger off the placed arrows may be starting to scroll the page: it stays undecided until
    // it holds still (aims) or moves away up or down (scrolls). Grabbing an arrow is decided at once.
    const undecided = !grab && ev.pointerType === 'touch';
    // multi-spot sheet not zoomed yet: a touch off the arrows only picks the spot
    if (whole && !grab) {
      active = { id: ev.pointerId, p, mode: 'pick', from, pending: undecided };
      return;
    }
    // a finger aiming a new arrow aims above itself; a mouse or pen where it points
    const offset = !grab && ev.pointerType === 'touch';
    active = grab
      ? { id: ev.pointerId, mode: 'move', idx: grab.i, off: grab.off, p: aimFrom(p, grab.off), origin: aimFrom(p, grab.off), from, moved: 0, tapPicks: whole }
      : { id: ev.pointerId, mode: 'aim', off: { x: 0, y: 0 }, offset, p: offset ? toFace(ev, { offset }) : p, from, moved: 0, pending: undecided };
    if (undecided) holdTimer = setTimeout(decide, AIM_HOLD_MS);
    else activate();
  });
  // the loupe and the aim guides appear once the touch is known to aim (or move an arrow)
  function activate() {
    if (active.mode === 'pick') return;
    if (active.mode === 'move') {
      const i = active.idx;
      sheet.querySelector(`[data-arrow="${i}"]`)?.classList.add('is-grabbed');
      guideNumber.textContent = String(i + 1);
      moveGuide.setAttribute('visibility', 'visible');
      loupeTag.textContent = `Move ${i + 1} · was ${L.shownEnd(session).arrows[i].v}`;
      loupeTag.hidden = false;
      loupe.classList.add('is-moving');
      btn.classList.add('moving');
      if (navigator.vibrate) navigator.vibrate(15);
    }
    btn.classList.add('aiming');
    corner = null;
    show(active.p);
  }
  btn.addEventListener('pointermove', (ev) => {
    if (!active || ev.pointerId !== active.id) return;
    if (active.pending) {
      const dx = ev.clientX - active.from.x;
      const dy = ev.clientY - active.from.y;
      if (Math.hypot(dx, dy) < TOUCH_SLOP_PX) return;
      // up or down: the page scrolls (touch-action: pan-y), no arrow; sideways: aim from here
      if (Math.abs(dy) > Math.abs(dx)) {
        end(ev, false);
        return;
      }
      decide();
    }
    pending = { clientX: ev.clientX, clientY: ev.clientY };
    if (!frame) frame = requestAnimationFrame(flushMove);
  });
  btn.addEventListener('pointerup', (ev) => end(ev, true));
  btn.addEventListener('pointercancel', (ev) => end(ev, false));
  // once a finger aims or drags an arrow, the page must not scroll under it (the face allows pan-y
  // so an undecided touch can scroll); touchmove has to be non-passive to be cancelled
  btn.addEventListener(
    'touchmove',
    (ev) => {
      if (active && !active.pending && ev.cancelable) ev.preventDefault();
    },
    { passive: false },
  );
  btn.addEventListener('contextmenu', (ev) => ev.preventDefault());

  return h(
    'div',
    { class: 'target-wrap score-face' },
    faceBar,
    // the loupe docks inside the stage (loupePlacement.js)
    h('div', { class: 'target-stage' }, btn, loupe),
  );
}

// ---------------------------------------------------------------- inline grades

/** Two compact rows (M and S, grades 1–5) for the selected arrow, styled like the score keys. */
function gradePanel(session, { onGrade }) {
  const a = L.shownEnd(session).arrows[session.cursor];
  const row = (kind, label, full) =>
    APL.GradeKeys({
      label: `${full} for arrow ${session.cursor + 1}`,
      rowLabel: label,
      value: a[kind],
      keyLabel: (g) => `${full} ${g}`,
      onChange: (g) => onGrade(kind, g),
      fk: `grade-${kind}`,
    });
  return h('div', { class: 'grade-panel' }, row('m', 'M', T.mentalProgram), row('s', 'S', T.shootingCycle));
}
