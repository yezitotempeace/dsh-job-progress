# dsh-job-progress

As soon as a background job starts (a download, a build, a render…), a floating card
appears in the bottom-right corner of the session: one row per job with a progress
bar, percentage, elapsed time and the latest output line. It disappears when
everything has finished.

[中文说明](README.md)

## What it shows

| Part | Detail |
| --- | --- |
| Label | The job label, usually the command that started it |
| Status | Dot: green = running, amber = stopping, red = failed, grey = settled |
| Bar | The job's own `progress` field when set; otherwise parsed from the output tail (`45%`, curl's table row, `1.2 GB / 3.4 GB`); indeterminate when nothing parses |
| Percentage | Shown on the right when a number is known |
| Elapsed | Ticks live while running, freezes when settled |
| Latest output | Last line (ANSI stripped, whitespace collapsed, 180 chars), with `eta` appended when present |

At most 4 rows; the rest collapse into "N more".

## Interaction

- Click the header to collapse into a pill: `Background jobs 2` + aggregate bar +
  average percentage; click again to expand.
- **The whole card drags**: press the header and move it anywhere on screen; the spot
  is remembered in the browser (`localStorage`, key `dsh-job-progress/position`) and
  restored after a reload. The collapsed pill drags too, and positions are clamped to
  the viewport.
- A settled job stays for **8 seconds** with its final state, then the card goes away
  (nothing renders when there are no jobs).
- Only the **current session** is watched; output streams are subscribed on demand
  and released when the row unmounts or the job ends.

## What it can parse

wget, curl (default table and `-#` bar), apt, pip, npm, and anything that prints
`NN%` to stdout. The reading is heuristic:

- the job's own `progress` field wins when the producer sets one;
- otherwise the last 40 output lines are scanned for a percentage, including
  `\r`-refreshed meters;
- if nothing parses, the card shows an indeterminate bar plus the latest output —
  at least you can see it moving.

## How it works

| Part | Approach |
| --- | --- |
| Data | `ctx.jobs.state` (roster) + `ctx.jobs.watchRows(sessionId)` + `ctx.jobs.observe(sessionId, id)` |
| Mount | `conversation.session.header.actions` (only for `sessionId`), rendered into `document.body` through `createPortal` |
| Parsing | pure `parseProgress(text)`: strip ANSI → split on `\r\n` → scan the tail for `%` / curl's table → speed, ETA, byte ratio |
| Rendering | fixed position, `z-index: 60`, bottom-right by default (safe-area-aware `bottom`), theme tokens for colour |
| Dragging | pointer events + `setPointerCapture`; movement past 4px counts as a drag, otherwise a click; position clamped to the viewport and written to `localStorage` |

Never reads conversation content and issues no extra network requests (only the job
output stream).

## Test

```bash
node test/smoke.mjs
# [job-progress] PASS    (19 checks)
```

Covers bundle registration and inject, and `parseProgress` for wget/apt/curl
table/curl bar/pip/ANSI/`\r` updates/byte ratio/ETA, plain logs not misread, empty
output, and the drag-position clamp.

## Install

```bash
dsh plugin --profile web add github:yezitotempeace/dsh-job-progress
```

Then add `dsh-job-progress` to `dsh.profile.bundles` in the profile `package.json` and
restart the Web app. (`plugin add` only installs the dependency; bundles are not
mounted automatically.)

Local development: put the repo at `/root/dsh-job-progress`, set
`"dsh-job-progress": "link:/root/dsh-job-progress"` in `dependencies`, add
`dsh-job-progress` to `dsh.profile.bundles`, link `node_modules/dsh-job-progress`, and
restart the Web app.

## Limits

- A job must print progress to stdout; progress written to a file stays invisible.
- The card is fixed bottom-right, above the composer on narrow screens; collapse it to a pill.
- Output comes from DSH's `job.follow` stream — nothing is retained once the card is gone.

## License

MIT
