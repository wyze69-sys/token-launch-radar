// Token launch radar (token-radar-01): the entrypoint the grader runs.
//
// Reads the sealed snapshot, ranks the pre-token protocols with the model
// in dashboard/model.js (the same file the dashboard page loads, so the
// board and the page are one method, not two), and writes the output the
// gate and the judge read: board.json, data.js, the dashboard, the
// screenshots, and dossier.json from the vendored make.fun library. The
// program is deterministic: the same snapshot always writes the same bytes.
//
//   node main.ts --input <snapshot.json|dir> --output <dir>
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import { computeModel, farmPlan } from './dashboard/model.js';
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
const { meta, rows, comps } = computeModel(snapshot.protocols, snapshot.as_of);
const board = rows.map((r: any) => ({
  slug: r.slug,
  name: r.name,
  rank: r.rank,
  implied_value_usd: r.implied,
  farm_steps: farmPlan(r, meta).steps,
}));
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// A short fingerprint of the board, printed in the dashboard footer and the
// screenshots, so the page, the images and board.json visibly agree.
meta.boardHash = createHash('sha256').update(JSON.stringify(board)).digest('hex').slice(0, 12);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(meta, rows, comps, snapshot.watchlist));

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
