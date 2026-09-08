#!/usr/bin/env node
// Render a GitHub user's contribution graph as a mowed-lawn SVG.
//
//   node scripts/render-svg.mjs --user torvalds --outputs "dist/lawn.svg"
//   node scripts/render-svg.mjs --demo --outputs "out/a.svg\nout/b.svg?theme=dark"
//
// This is what the composite action runs. It imports only src/core/* and
// src/export/*, both of which are dependency-free, so it needs no npm install.
// Keep it that way: `three` belongs to the 3D renderer and must never be
// reachable from here.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createLawn, layoutYear, ROWS, COLS } from '../src/core/lawn.js';
import { lawnToSvg } from '../src/export/svg.js';

const API = 'https://api.github.com/graphql';
const FALLBACK = 'https://github-contributions-api.jogruber.de/v4/';
const UA = 'mow-your-commits';

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

// --- args -----------------------------------------------------------------

function parseArgs(argv) {
  const out = { outputs: 'dist/lawn.svg\ndist/lawn-dark.svg?theme=dark' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') out.demo = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

/** The action passes the list as a YAML block; a shell may pass literal \n. */
function splitOutputs(text) {
  return String(text || '')
    .split(/\\n|[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "dist/lawn-dark.svg?theme=dark&year=2025" -> path + lawnToSvg options */
function parseOutput(line) {
  const at = line.indexOf('?');
  const path = at < 0 ? line : line.slice(0, at);
  const q = new URLSearchParams(at < 0 ? '' : line.slice(at + 1));
  const opts = {};
  if (q.has('theme')) opts.theme = q.get('theme');
  if (q.has('animate')) opts.animate = q.get('animate') !== '0';
  if (q.has('mower')) opts.mower = q.get('mower') !== '0';
  if (q.has('caption')) {
    const c = q.get('caption');
    opts.caption = c === '' || c === '0' ? null : c;
  }
  if (q.has('mowed')) {
    const m = q.get('mowed');
    opts.mowed = m === 'as-is' ? 'as-is' : Number(m);
  }
  const year = q.has('year') ? Number(q.get('year')) : null;
  return { path, opts, year };
}

// --- data -----------------------------------------------------------------

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * The official calendar. `${{ github.token }}` is enough to read any public
 * profile, which is why this is the primary path: exact counts, no third party.
 */
async function fromGraphQL(user, token, year) {
  const vars = { login: user };
  let sig = '';
  let call = '';
  if (year) {
    vars.from = `${year}-01-01T00:00:00Z`;
    vars.to = `${year}-12-31T23:59:59Z`;
    sig = ', $from: DateTime!, $to: DateTime!';
    call = '(from: $from, to: $to)';
  }
  const query = `query($login: String!${sig}) {
    user(login: $login) {
      contributionsCollection${call} {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
  }`;

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      authorization: 'bearer ' + token,
      'content-type': 'application/json',
      'user-agent': UA,
    },
    body: JSON.stringify({ query, variables: vars }),
  });
  if (!res.ok) {
    await res.text().catch(() => {});
    throw new Error(`graphql returned ${res.status}`);
  }
  const json = await res.json();
  if (json.errors && json.errors.length) throw new Error('graphql: ' + json.errors[0].message);
  const cal = json.data && json.data.user
    && json.data.user.contributionsCollection.contributionCalendar;
  if (!cal) throw new Error('no such user: ' + user);

  const days = [];
  for (const w of cal.weeks) {
    for (const d of w.contributionDays) {
      days.push({
        date: d.date,
        count: d.contributionCount,
        level: LEVELS[d.contributionLevel] || 0,
      });
    }
  }
  return days.sort(byDate);
}

/** No token, or the token cannot see the calendar: a public CORS mirror. */
async function fromMirror(user, year) {
  const url = FALLBACK + encodeURIComponent(user) + '?y=' + (year || 'last');
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) {
    await res.text().catch(() => {});   // drain, or node exits noisily
    throw new Error(res.status === 404
      ? 'no such user: ' + user
      : `contributions api returned ${res.status}`);
  }
  const json = await res.json();
  const days = (json.contributions || []).map((d) => ({
    date: d.date,
    count: d.count || 0,
    level: d.level || 0,
  }));
  if (!days.length) throw new Error('no contributions for ' + user);
  return days.sort(byDate);   // y=all comes back descending
}

/**
 * A flat day list -> exactly the grid the site draws: whole Sunday..Saturday
 * weeks, at most 52 of them, with today's partial week padded out with voids.
 */
function rollingGrid(days) {
  let i = 0;
  while (i < days.length && new Date(days[i].date + 'T00:00:00').getDay() !== 0) i++;
  const grid = days.slice(i);
  while (grid.length % ROWS !== 0) grid.push({ date: null, level: 0, count: 0, void: true });
  return grid.length > COLS * ROWS ? grid.slice(grid.length - COLS * ROWS) : grid;
}

async function loadDays(user, token, year) {
  if (token) {
    try {
      return { days: await fromGraphQL(user, token, year), via: 'api.github.com/graphql' };
    } catch (err) {
      if (/no such user/.test(err.message)) throw err;
      console.log(`  graphql failed (${err.message}), falling back`);
    }
  }
  return { days: await fromMirror(user, year), via: 'github-contributions-api.jogruber.de' };
}

// --- main -----------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const outputs = splitOutputs(args.outputs).map(parseOutput);
  if (!outputs.length) throw new Error('nothing to render: --outputs was empty');

  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const user = (args.user || '').trim().replace(/^@/, '');
  if (!args.demo && !user) throw new Error('--user is required (or pass --demo)');

  const token = args.demo ? '' : (process.env.GITHUB_TOKEN || '').trim();
  const seed = args.seed ? Number(args.seed) : undefined;

  // One lawn per distinct year, built once and reused by every output.
  const lawns = new Map();
  async function lawnFor(year) {
    const key = String(year);
    if (lawns.has(key)) return lawns.get(key);
    let lawn;
    if (args.demo) {
      lawn = createLawn(null, { seed, year });
    } else {
      const { days, via } = await loadDays(user, token, year);
      console.log(`  ${year || 'last year'}: ${days.length} days via ${via}`);
      lawn = createLawn(year ? layoutYear(days, year) : rollingGrid(days), { year });
    }
    lawns.set(key, lawn);
    return lawn;
  }

  console.log(args.demo ? 'mowing a demo lawn' : `mowing ${user}'s lawn`);
  for (const out of outputs) {
    const lawn = await lawnFor(out.year);
    const svg = lawnToSvg(lawn, { ...out.opts, user: args.demo ? '' : user });
    const file = resolve(cwd, out.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, svg, 'utf8');
    const { size } = await stat(file);
    console.log(`  wrote ${out.path}  ${(size / 1024).toFixed(1)} kB`);
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  // exitCode rather than exit(): node on Windows aborts noisily if a keep-alive
  // fetch socket is still open when the process is killed mid-flight.
  process.exitCode = 1;
});
