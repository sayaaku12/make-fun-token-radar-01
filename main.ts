// Token Radar, model radar-2 (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores
// every pre-token protocol with the model in lib/model.ts, writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ and screenshots/ to /output. Last, it
// writes /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/
// app.css and dashboard/app.js read /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import type { BoardRow, RadarData, Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The snapshot file out of --input: a .json file itself, or the snapshot.json inside a directory. */
function resolveInputFile(inputArg: string): string {
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  return inputFile;
}

const inputFile = resolveInputFile(arg('input', '/input'));
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Parse data.js back and confirm it carries the same rows as the board, so a stale or truncated data.js can never reach the judge. The page reads data.js, not board.json. */
function verifyDataRoundTrip(outDir: string, boardLength: number): void {
  const roundTrip = JSON.parse(
    readFileSync(join(outDir, 'data.js'), 'utf8').replace(/^window\.RADAR=/, '').replace(/;\s*$/, ''),
  ) as { rows?: unknown[] };
  if (!Array.isArray(roundTrip.rows) || roundTrip.rows.length !== boardLength) {
    process.stderr.write(`token radar: data.js round-trip mismatch: ${roundTrip.rows?.length ?? 0} rows vs ${boardLength} in board.json\n`);
    process.exit(1);
  }
}

verifyDataRoundTrip(out, board.length);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
/** One screenshot's gate checks: a plain name, a whole PNG or JPEG, under the size cap. The gate refuses a screenshot past 512 KiB or one that is not a whole PNG or JPEG: check the bytes here, while the fix is still a re-take, not a rejected entry. */
function checkScreenshot(outDir: string, name: string): void {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const bytes = readFileSync(join(outDir, 'screenshots', name));
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) {
    process.stderr.write(`token radar: screenshots/${name}: not a PNG or JPEG\n`);
    process.exit(1);
  }
  if (bytes.length > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name} is ${bytes.length} bytes, past the 512 KiB cap\n`);
    process.exit(1);
  }
}

for (const name of shots) checkScreenshot(out, name);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

/** The run's one summary: counts, calibration, top rows, and what was written. */
function summarize(snapshot: Snapshot, board: BoardRow[], radar: RadarData, outDir: string, dashboardCount: number, shotCount: number): string {
  return (
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: base multiple ${radar.model.base_multiple} calibrated from ${radar.live_calibration_n} live-token protocols\n` +
    `token radar: top 3: ${board.slice(0, 3).map((r) => `${r.slug} $${r.implied_value_usd.toLocaleString('en-US')}`).join(', ')}\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardCount} files), ${join(outDir, 'screenshots')} (${shotCount} images) and ${join(outDir, 'dossier.json')}\n`
  );
}

process.stdout.write(summarize(snapshot, board, radar, out, dashboardFiles.length, shots.length));
