// Shaping the days src/core/github.js fetches into the grids the lawn is built
// from. Pure data: no DOM, no dependencies.

import { layoutYear, gridForRolling, isoDay } from './lawn.js';

/**
 * Filter a parsed list down to one calendar year and pad it into GitHub's
 * 53/54-column grid, with void cells before 1 Jan and after 31 Dec.
 * @param today ISO date. Days after it become void too, because GitHub leaves
 *   the rest of the current year blank rather than drawing empty squares.
 * @returns one entry per grid cell, ready for createLawn(days, { year }).
 */
export function daysForYear(days, year, today = null) {
  const inYear = days.filter((d) => d.date && Number(d.date.slice(0, 4)) === year);
  const laid = layoutYear(inYear, year);
  if (!today) return laid;
  return laid.map((d) => (d.date && d.date > today
    ? { date: null, level: 0, count: 0, void: true }
    : d));
}

/**
 * The rolling last 52 weeks (364 cells, Sunday-aligned, ending today), filled
 * from a day list keyed by ISO date. Missing days become empty, not void, so
 * the API's 367-day y=last window and its UTC "tomorrow" both drop in cleanly.
 * @returns one entry per grid cell, ready for createLawn(days, { year: null }).
 */
export function daysForRolling(days) {
  const byDate = new Map();
  for (const d of days) if (d && d.date) byDate.set(d.date, d);
  return gridForRolling().dates.map((d) => {
    const iso = isoDay(d);
    return byDate.get(iso) || { date: iso, level: 0, count: 0 };
  });
}

/** Which calendar years a parsed list covers, newest first. */
export function yearsIn(days) {
  const set = new Set();
  for (const d of days) if (d.date) set.add(Number(d.date.slice(0, 4)));
  return [...set].sort((a, b) => b - a);
}
