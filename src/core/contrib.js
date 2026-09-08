import { layoutYear, gridForRolling, isoDay } from './lawn.js';

// Shaping contribution days into the grids the lawn is built from.
//
// The site fetches days from src/core/github.js; parseContributions below is the
// other way in: GitHub renders the graph as a table of
// <td data-date="YYYY-MM-DD" data-level="0-4"> cells, which a browser extension
// can read straight off the profile page (no CORS, no API).

/**
 * Parse contribution cells out of a GitHub profile page or the
 * https://github.com/users/<name>/contributions fragment.
 * @param {string|Document} htmlOrDoc
 * @returns {Array<{date: string, level: number, count: number}>} oldest first
 */
export function parseContributions(htmlOrDoc) {
  const doc = typeof htmlOrDoc === 'string'
    ? new DOMParser().parseFromString(htmlOrDoc, 'text/html')
    : htmlOrDoc;

  const tds = Array.from(doc.querySelectorAll('td[data-date]'));
  const tooltips = new Map();
  for (const tt of doc.querySelectorAll('tool-tip[for]')) {
    tooltips.set(tt.getAttribute('for'), tt.textContent || '');
  }

  const days = tds.map((td) => {
    const id = td.getAttribute('id');
    const text = tooltips.get(id) || '';
    const match = text.match(/(\d+|No) contribution/);
    const count = match ? (match[1] === 'No' ? 0 : parseInt(match[1], 10)) : 0;
    return {
      date: td.getAttribute('data-date'),
      level: parseInt(td.getAttribute('data-level') || '0', 10),
      count,
    };
  });

  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return days;
}

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

/**
 * Trim a full-year list down to exactly COLS*ROWS days, aligned so that
 * the first entry is a Sunday (GitHub's week start). Drop the partial
 * leading week if needed.
 */
export function alignToGrid(days, cols = 52, rows = 7) {
  let i = 0;
  while (i < days.length && new Date(days[i].date + 'T00:00:00').getDay() !== 0) i++;
  const aligned = days.slice(i, i + cols * rows);
  return aligned;
}
