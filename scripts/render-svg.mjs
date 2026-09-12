#!/usr/bin/env node
// Render a GitHub user's contribution graph as a mowed-lawn SVG.
//
//   node scripts/render-svg.mjs --user torvalds --outputs "dist/lawn.svg"
//   node scripts/render-svg.mjs --demo --outputs "out/a.svg\nout/b.svg?theme=dark"
//
// This is what the composite action runs. It imports only src/core/* and
// src/export/*, both of which are dependency-free, so it needs no npm install.
// Keep it that way: `three` belongs to the 3D renderer and must never be
// reachable from here. Parsing and grid layout are the site's own modules, so
// the picture in a README is the picture on the page.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLawn, isoDay } from '../src/core/lawn.js';
import {
  normaliseApi, normaliseGraphql, GithubError, GRAPHQL, API as MIRROR,
} from '../src/core/github.js';
import { daysForYear, daysForRolling } from '../src/core/contrib.js';
import { lawnToSvg } from '../src/export/svg.js';

// GRAPHQL is GitHub's own API and MIRROR the public CORS mirror: the same two
// endpoints, under the same names, that src/core/github.js uses on the page.
const UA = 'mow-your-commits';

// --- args -----------------------------------------------------------------

export function parseArgs(argv) {
  const out = { outputs: 'dist/lawn.svg?animate=1\ndist/lawn-dark.svg?theme=dark&animate=1' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') out.demo = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

/** The action passes the list as a YAML block; a shell may pass literal \n. */
export function splitOutputs(text) {
  return String(text || '')
    .split(/\\n|[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Every query key an output line may carry; the table in action/README.md. */
export const OPTION_KEYS = [
  'theme', 'animate', 'mower', 'weather', 'bg', 'caption', 'mowed', 'year',
];

/** "dist/lawn-dark.svg?theme=dark&year=2025" -> path + lawnToSvg options */
export function parseOutput(line) {
  const at = line.indexOf('?');
  const path = at < 0 ? line : line.slice(0, at);
  const q = new URLSearchParams(at < 0 ? '' : line.slice(at + 1));
  // a typo used to render the default in silence; say so in the Action log
  for (const key of q.keys()) {
    if (!OPTION_KEYS.includes(key)) {
      console.log(`  warning: "${key}" is not an option, ignoring it`
        + ` (${OPTION_KEYS.join(', ')})`);
    }
  }
  const opts = {};
  if (q.has('theme')) opts.theme = q.get('theme');
  if (q.has('animate')) opts.animate = q.get('animate') !== '0';
  if (q.has('mower')) opts.mower = q.get('mower') !== '0';
  // the plain chart: no seasons
  if (q.has('weather')) opts.weather = q.get('weather') !== '0';
  // bg=0 is the default anyway (transparent, so the picture takes the reader's
  // own theme); bg=1 paints GitHub's canvas under it, bg=paper the cream sheet
  if (q.has('bg')) {
    const b = q.get('bg');
    opts.background = b === 'paper' ? 'paper' : b === '0' ? 'none' : 'canvas';
  }
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
// No parsing lives here. src/core/github.js turns either payload into the same
// { days, years, totals } the site uses, and src/core/contrib.js lays those
// days out in the grid the site draws, so a README picture and the page can
// never drift apart. Both are dependency-free.

/**
 * The official calendar. `${{ github.token }}` is enough to read any public
 * profile, which is why this is the primary path: exact counts, no third party.
 * The response is handed to normaliseGraphql under the key it expects, so the
 * NONE..FOURTH_QUARTILE mapping and the "nothing after today" rule are shared.
 */
async function fromGraphQL(user, token, year, today) {
  const vars = { login: user };
  let sig = '';
  let call = '';
  if (year) {
    vars.from = `${year}-01-01T00:00:00Z`;
    vars.to = `${year}-12-31T23:59:59Z`;
    sig = ', $from: DateTime!, $to: DateTime!';
    call = '(from: $from, to: $to)';
  }
  const key = year ? 'y' + year : 'last';
  const query = `query($login: String!${sig}) {
    user(login: $login) {
      ${key}: contributionsCollection${call} {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
  }`;

  const res = await fetch(GRAPHQL, {
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
  if (!json.data || !json.data.user) throw new GithubError('notfound', 'no such user: ' + user);
  const data = normaliseGraphql(json, today);
  return year ? data.days : (data.last || data.days);
}

/** No token, or the token cannot see the calendar: a public CORS mirror. */
async function fromMirror(user, year, today) {
  const url = MIRROR + encodeURIComponent(user) + '?y=' + (year || 'last');
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) {
    await res.text().catch(() => {});   // drain, or node exits noisily
    if (res.status === 404) throw new GithubError('notfound', 'no such user: ' + user);
    throw new Error(`contributions api returned ${res.status}`);
  }
  const { days } = normaliseApi(await res.json(), today);
  if (!days.length) throw new Error('no contributions for ' + user);
  return days;
}

async function loadDays(user, token, year, today) {
  if (token) {
    try {
      return { days: await fromGraphQL(user, token, year, today), via: 'api.github.com/graphql' };
    } catch (err) {
      if (err instanceof GithubError && err.kind === 'notfound') throw err;
      console.log(`  graphql failed (${err.message}), falling back`);
    }
  }
  return {
    days: await fromMirror(user, year, today),
    via: 'github-contributions-api.jogruber.de',
  };
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
  // The seed is the route: which of the two ways the mower mows, how a pass
  // weaves, where it stops for a moment. Without --seed it is the UTC day
  // number, so a profile README mows a fresh route every morning while two
  // renders on the same day still give the same file. (Under --demo it picks
  // the fake year too, as it always did.) Logged, because a picture nobody can
  // reproduce is a bug report nobody can answer.
  const given = Number(args.seed);
  const seed = Number.isFinite(given) ? given : Math.floor(Date.now() / 86400000);
  const today = isoDay(new Date());

  // One lawn per distinct year, built once and reused by every output.
  const lawns = new Map();
  async function lawnFor(year) {
    const key = String(year);
    if (lawns.has(key)) return lawns.get(key);
    let lawn;
    if (args.demo) {
      lawn = createLawn(null, { seed, year });
    } else {
      const { days, via } = await loadDays(user, token, year, today);
      console.log(`  ${year || 'last year'}: ${days.length} days via ${via}`);
      // exactly the grids the site builds: one calendar year, or the rolling
      // 52 weeks ending today
      const grid = year ? daysForYear(days, year, today) : daysForRolling(days);
      lawn = createLawn(grid, { year });
    }
    lawns.set(key, lawn);
    return lawn;
  }

  console.log(args.demo ? 'mowing a demo lawn' : `mowing ${user}'s lawn`);
  console.log(`  seed ${seed}`);
  for (const out of outputs) {
    const lawn = await lawnFor(out.year);
    const svg = lawnToSvg(lawn, { seed, ...out.opts, user: args.demo ? '' : user });
    const file = resolve(cwd, out.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, svg, 'utf8');
    const { size } = await stat(file);
    console.log(`  wrote ${out.path}  ${(size / 1024).toFixed(1)} kB`);
  }
}

// Only when run as a script: smoke.mjs imports the parsers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    // exitCode rather than exit(): node on Windows aborts noisily if a
    // keep-alive fetch socket is still open when the process is killed
    // mid-flight.
    process.exitCode = 1;
  });
}
