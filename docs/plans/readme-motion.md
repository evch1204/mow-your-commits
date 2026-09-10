# README motion: passes, not scribbles

**Complaint (owner, 2026-09-10).** The animated README lawn feels laggy next to
the game: sharp turns, unrealistic movement, and none of the marks the game
leaves (tyre tracks, exhaust, clippings). Measured: the SVG paints at 60 fps in
Chrome, so it is the *motion* that reads as lag, not the rendering.

**Diagnosis.** `planRoute` was a greedy tour over every grown day with a turn
penalty and a weave. Drawn on the board it is a scribble of hairpins: the
Catmull-Rom smoothing caps its control points to stop loops, which turns every
hairpin into a corner, and `rotate="auto"` snaps the mower round each one.

**Design.**
1. Route = what a person does with a mower: long passes along the rows, a round
   U-turn off the edge of the board between passes, a gentle hand-drawn weave on
   each pass. Rows are taken evens-then-odds (0 2 4 6 then 1 3 5) so every
   U-turn has a one-cell radius, except one wide loop back up the left edge.
   Seven passes end on the right, where the loop already parks. Every grown
   cell sits on a pass, so `mowWalk` still proves the cut and the loop still
   reads "regrow, mow, repeat". Length no longer depends on how many days grew.
2. Timing keys per segment: passes at `SPEED`, U-turns at `TURN_SPEED`, all
   under `calcMode="linear"` so nothing new is asked of the SMIL renderer.
   Cut times and the track reveal are mapped through the same piecewise clock.
3. Marks, ported from render2d/mower.js and kept cheap:
   - twin tyre tracks: one centreline path, revealed with `stroke-dashoffset`
     through a luminance mask (a wide white stroke minus a narrower black one =
     two tyre lines that stay in sync through turns). Three nested windows fade
     the tail like the game's 4 s life. Drawn under the covers, so tracks only
     show on cut lawn.
   - exhaust puffs and chute clippings in the mower's own space, gated off
     while the mower is parked; the blade spins.
4. Tests: drop the "changes rows often" assertion (it encoded the scribble),
   add a minimum turn radius, keep every cut / steady-rate / SMIL-validity test.

Out of scope: the still (`animate=0`), the game, the 3D view.
