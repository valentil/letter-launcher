/**
 * src/scenes/robot_factory/pacing.js — LLF-80 [Robot-7] ROBOT FACTORY shift tuning (pure data + helpers).
 * Browser: window.RFPacing.  Node: require('./src/scenes/robot_factory/pacing.js').
 *
 * One place for the numbers that decide how long a shift takes, so the scene (robot_factory.js) and the
 * headless pacing test (tests/test_robot_shift_pacing.js) read the same values:
 *   clocks       shift clock per shift (s)
 *   startStock   Scrabble-frequency glyphs poured at shift start; subsStock = the number drawer (0/2/5)
 *   refillExtra  fresh Scrabble handful the hopper adds underneath, only while the usable stock is below lowStock
 *                (an ever-deeper tote buries more letters: refills must not snowball)
 *   refillSpare  extra copies of each missing letter (buried / face-down spares)
 *   armSpeed     nominal arm tempo (RFCell baseSpeed): 1.4 x the motion planner's 0.5 m/s TCP profile; the
 *                player's FAST / SLOW multiply on top (only FAST raises the vacuum drop chance)
 * Tuned with tests/test_robot_shift_pacing.js: the scripted player (types each order as soon as the last one
 * ships, REFILL / SHAKE when the planner reports unsat and the arms stall) finished shift 1 in 205-276 s over
 * seeds 1-6 (median ~240 s) — about a quarter of the 5:30 clock to spare; a first-time player lands at 4-5 min.
 * Stock 30 (was 40): a shallower tote buries fewer letters.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RFPacing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var T = {
    clocks: [330, 330, 375],
    startStock: 30,
    subsStock: { '0': 1, '2': 2, '5': 1 },
    refillExtra: 4,
    lowStock: 20,
    refillSpare: 1,
    armSpeed: 1.4
  };

  /**
   * What the hopper pours: {top, counts}.
   *   top    = every letter the current order still has OPEN (the solver could not use the ones in the tote:
   *            buried, on edge, out of reach) + whatever the upcoming orders miss against `have`, each with
   *            refillSpare extra copies; RFCell.refill pours these last, face-up, one copy in each arm's half.
   *   counts = a fresh Scrabble handful (refillExtra) underneath, only when the usable stock is low.
   */
  function refillCounts(openChars, upcoming, have, scrabble) {
    var top = {}, need = {};
    function chars(w) { return String(w || '').toUpperCase().replace(/[^A-Z0-9]/g, '').split('').filter(Boolean); }
    var open = [].concat.apply([], (openChars || []).map(chars));
    open.forEach(function (c) { top[c] = (top[c] || 0) + 1; });
    Object.keys(top).forEach(function (c) { top[c] += T.refillSpare; });
    (upcoming || []).forEach(function (w) { chars(w).forEach(function (c) { need[c] = (need[c] || 0) + 1; }); });
    Object.keys(need).forEach(function (c) {
      var miss = need[c] - ((have && have[c]) || 0) - (top[c] || 0);
      if (miss > 0) top[c] = (top[c] || 0) + miss + T.refillSpare;
    });
    var stock = 0; Object.keys(have || {}).forEach(function (c) { stock += have[c]; });
    return { top: top, counts: scrabble && T.refillExtra > 0 && stock < T.lowStock ? scrabble(T.refillExtra) : {} };
  }

  /**
   * Which lever fixes a planner "unsat" reason. REFILL lays fresh copies of the open letters on top, face-up, in
   * both arms' reach, so it answers missing / buried / out-of-reach letters; SHAKE knocks letters standing on edge
   * flat and untangles a contradictory stack.
   */
  function leverFor(reason) {
    reason = String(reason || '');
    if (/gripped|contradict/.test(reason)) return 'shake';
    return 'refill';
  }

  return { TUNING: T, refillCounts: refillCounts, leverFor: leverFor };
});
