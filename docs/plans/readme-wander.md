# README wander: a mower that roams the board and still finishes it

**Complaint (owner, 2026-09-12, after `docs/plans/readme-drive.md` landed).**
"It occasionally gets stuck and keeps going" (the deliberate breathers and
the 0.7x crawl through hedges read as lag, not life). "It stops on Fri and Wed
day" (the omega turn hangs off the left edge on top of the day labels). And
the real point: "the changes need to be more random movement instead of
always going from one end to another ... almost like random movement but
eventually finish the entire contribution chart." The greedy tour the picture
had before 7231fa8 wandered, and the owner liked that; what it lacked was
smoothness (hairpins, a snapping `rotate="auto"`).

So: a wanderer with a turning circle. Turns happen on the board, wherever the
grass is, at radius 1 cell; runs are random lengths, not edge to edge; nothing
ever pauses or crawls; the mower never parks on a label; and every grown day
still gets cut, proven by `mowWalk`, on every seed.

One stream, one builder. Owns `src/core/route.js`, `src/export/svg.js` from
`SPEED` down (timing, fx), the route + animate section of `scripts/smoke.mjs`,
the drive wording in `README.md`, `action/README.md`, `action.yml`,
`docs/DEV.md`. Nothing else changes (`normalize`, the background, themes,
render-svg.mjs stay as they are).

---

## 1. Remove

- The `pause` spans, `PAUSES`, `PAUSE_SECS`, the clippings' pause gate.
- The thick-grass factor `THICK`; every drive span runs at `SPEED`, every arc
  at `TURN_SPEED`. Two speeds, nothing else. (`walk.tall` can go.)
- The `spiral` and `rows` strategies, the omega turn, the mirror variants.
  `route.strategy` becomes `'wander'`; keep the field so nothing else breaks.

Keep: the weave on long runs, `mowWalk` and the throw on a missed cell, the
engine bob, the dandelion bursts, tyre tracks, exhaust, clippings, the 64 px
right pad under `animate`, `ENTRY_X = -4.5` (off the picture), `PARK_X = 2.5`.

## 2. The wanderer

`planRoute(lawn, seed)`: same signature, same return shape
(`{waypoints, curve, cuts, length, strategy}`, spans with `kind`
`'drive' | 'turn'` and `speed`). Build the drive as a sequence of **moves**
from a pose `(x, z, heading)`, the mower's centre in cell units, heading in
radians (0 = east).

**Geometry.** Turning radius `R = 1` cell. An arc is emitted as one cubic per
90 degrees or less (control points at `KAPPA * R * (angle / 90deg)`, the
usual approximation), `kind: 'turn'`. A straight run is `kind: 'drive'`,
with the weave from `leg()` when it is 3 cells or longer (amplitude under
0.22 across the run), straight otherwise.

**Bounds for the mower centre** (checked on every candidate move, sampled
every 0.1 cells): `x` in `[-0.2, cols + 1.2]`, `z` in `[0, rows]`. Only the
run-in from `ENTRY_X` and the final park run are exempt. This is what keeps
the tractor off the month labels above, the legend below, and the Mon/Wed/Fri
column on the left: a turn at the left edge has to begin on the board. The
blade sits `BLADE_OFFSET` ahead of the centre and reaches `MOW_RADIUS`, so a
mower at `x = 0.8` heading west still cuts column 0.

**Start.** Enter from `ENTRY_X` on a seeded row (any of the rows), heading
east, straight run-in to `x = RUN_IN`.

**Loop until every grown cell is cut** (track a cut set; mark cells cut by
each move with the same blade model `mowWalk` uses, so the next move sees
them):

1. **Candidates**: every uncut grown cell centre `p`. For each, the shortest
   *arc then straight* path from the pose to `p` with a free final heading:
   pick the left or the right turning circle (centre one `R` to that side of
   the pose), skip it if `p` is inside that circle (`dist < R`), otherwise
   the tangent line from the circle to `p` and the arc that gets the mower
   from its heading to that tangent (always turning the short way round that
   circle, never more than 270 degrees; skip a candidate that needs more).
   Skip anything that leaves the bounds.
2. **Run length**: the straight part does not stop at `p`. It continues
   past `p` while a not-yet-cut grown cell lies within 1.2 cells ahead of
   the blade, but **never further than a seeded cap** drawn per move from
   `RUN[0]..RUN[1] = 5..18` cells, and never out of bounds. The cap is the
   wander: runs are random lengths, so a row is rarely mown end to end in one
   go, and the mower turns somewhere in the middle of the board to go find
   grass elsewhere.
3. **Score** each candidate: `(cells this move newly cuts, by the blade
   model) / (move length + 1)`, times
   - 1.3 if the line's heading is within 20 degrees of horizontal (a lawn
     is mown along its rows more than across; this is a preference, not a
     rule, so diagonals and column runs still happen),
   - 0.7 if the arc is over 150 degrees (a big loop is fine now and then, not
     every move),
   - `0.75 + 0.5 * rnd()` per candidate (the seed's own randomness).
   Take the best. Ties in the noise are what make two seeds differ.
4. **Recovery** when no candidate is valid (everything left is inside both
   circles or behind a bound): a half circle toward the board's vertical
   middle (down if `z < rows / 2`, else up), then loop again. A safety cap
   of 600 moves; past it, throw with the number of cells left, so the smoke
   test catches a planner that cannot finish.

**Exit**: from the last pose, an arc then straight to `(cols + PARK_X, zp)`
heading east, where `zp` is the current `z` clamped to `[1, rows - 1]`; that
run is exempt from the x bound. Then the hold, as now.

**Speeds**: keep `TURN_SPEED = 5.5`. Set `SPEED` so the demo lawn loops in
**45 to 65 s** across seeds 1..12 (expect 11 to 13; a wander is longer than
seven passes). Say what you picked and the lengths in the report.

**Keys**: `loopTiming` still merges consecutive spans of equal speed. A
wander has maybe 60 to 120 moves, so allow up to 300 keys; the track
windows' `values` lists follow along as they do now. Check the file size
stays under 450 kB for the demo lawn.

## 3. Acceptance, measured on the demo lawn (`createLawn(null, {seed: 20260904})`), route seeds 1..12

Add these to `scripts/smoke.mjs` (replace the strategy tests):

- every grown cell is cut, for every seed (existing);
- `length < 2.2 * rows * cols`;
- **turns on the board**: at least 10 heading changes of 60 degrees or more
  whose arc starts with the mower centre at `1 <= x <= cols - 1`;
- **no end-to-end monotony**: the median straight run is between 5 and 18
  cells and no more than a third of the runs span 80% of the board width;
- the minimum turn radius stays at least 0.85 (existing test);
- **in bounds**: sampled every 0.1 cells, excluding the run-in and the park
  run, the centre stays in `[-0.2, cols + 1.2] x [0, rows]`;
- no `pause` spans, exactly two distinct speeds in the curve;
- the loop `dur` is between 45 and 65 s;
- the SMIL validity loop, the animateTransform count and the bursts test
  stay as they are.

Also run `planRoute` on the two fixture lawns the smoke test already builds
from `scripts/fixtures/*.json` (torvalds, ghost) and a year with every day
at level 4, for seeds 1..6 each: every one must finish without throwing.

## 4. Show the whole route, not just frames

Add a debug renderer in the builder's scratch script (not shipped): draw the
route as one polyline over the tile grid, with a dot at every turn, to
`out/map-<seed>.svg`, for seeds 1..6, and screenshot them. The reviewer
judges "does it wander and still finish" from these maps first, then from
the animation frames. Shoot the usual frames too (t = 0, an on-board turn, a
third, two thirds, one second before the drive ends, the hold; light on
`#ffffff` and dark on `#0d1117`; harness recipe in `docs/plans/readme-drive.md`).

## 5. Words

`README.md` options table (`animate` row and the paragraph above it),
`action/README.md` (`animate` row and "the nightly route"), `action.yml`
(`outputs` description), `docs/DEV.md`: the mower **wanders** the year, turning
wherever the grass is, a different route every night, and always finishes.
Drop every mention of spiral, stripes, loop turns, breathers and slowing
through thick weeks.
