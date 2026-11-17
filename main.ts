// Token launch radar (token-radar-01): the entrypoint the grader runs.
//
// Reads the sealed DefiLlama snapshot, builds the ranked board with the
// model in lib/model.ts, and writes everything the gate and the judge
// read into the output directory: board.json, the dashboard with its data
// script, the screenshots, and dossier.json written by the vendored
// make.fun library from the files as they land. The program is
// deterministic: the same snapshot always writes the same bytes.
//
//   node main.ts --input <snapshot.json|dir> --output <dir>
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap from the gate: the judge reads source up to this many bytes. */
const TEXT_MAX_BYTES = 65_536;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
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

/** Copy a directory's regular files into the output, skipping names that start with a dot. */
function copyFiles(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
  }
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
writeFileSync(join(out, 'dossier.json'), dossier);
process.stdout.write(`token radar: ${board.length} rows ranked, top is ${board[0]!.slug} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}\n`);
