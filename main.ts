// Token Launch Radar — entrypoint (Node 22, standard library only, no network).
//
// Reads the sealed DefiLlama snapshot (default /input/snapshot.json, or --input <file|dir>),
// builds the ranked board with lib/model.ts, and writes the hand-in to the output directory
// (MAKEFUN_OUTPUT_DIR, or --output, default /output):
//   board.json    the ranked board the gate checks
//   data.js       the dashboard's dataset, written beside the page as ../data.js
//   dashboard/    the static page, copied from this repository
//   screenshots/  the three dashboard screenshots, copied from this repository
//   dossier.json  the judge's dossier, written last with vendor/makefun-board.ts
//
// The program is deterministic: it reads no clock and no randomness, so two runs over the
// same snapshot write the same bytes.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardProblem, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

function argValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && process.argv[at + 1] !== undefined) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = argValue('input', '/input');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(`token-radar: no snapshot at ${inputPath} — pass --input <snapshot.json|dir> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = argValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardProblem(board, snapshot);
if (problem !== null) {
  process.stderr.write(`token-radar: refusing to write an invalid board: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyTree(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyTree(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token-radar: screenshots/ holds ${shots.length} images — the hand-in needs 3 or 4\n`);
  process.exit(1);
}

// Written last, from the finished output, exactly as the gate rebuilds it.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, board ${board.length} rows (${radar.counts.early} early, ${radar.counts.products_set_aside} products set aside, ${radar.counts.live} live shown)\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length}), dossier.json to ${outDir}\n`,
);
