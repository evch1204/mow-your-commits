import { layoutYear } from './lawn.js';

// Reading contribution data from GitHub.
//
// GitHub renders the graph as a table of <td data-date="YYYY-MM-DD" data-level="0-4">
// cells. In the extension we can read it straight off the profile page (no CORS).
// In the demo page we need a proxy, because github.com doesn't send CORS headers.

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
 * Fetch contributions through a proxy you host (e.g. a Cloudflare Worker
 * or Vercel function that fetches github.com/users/<user>/contributions
 * and returns the HTML with CORS headers).
 */
export async function fetchContributions(username, proxyUrl) {
  const res = await fetch(`${proxyUrl}?user=${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error(`Couldn't load contributions for ${username}`);
  return parseContributions(await res.text());
}

/**
 * Filter a parsed list down to one calendar year and pad it into GitHub's
 * 53/54-column grid, with void cells before 1 Jan and after 31 Dec.
 * @returns one entry per grid cell, ready for createLawn(days, { year }).
 */
export function daysForYear(days, year) {
  const inYear = days.filter((d) => d.date && Number(d.date.slice(0, 4)) === year);
  return layoutYear(inYear, year);
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
