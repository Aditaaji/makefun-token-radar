// Token Radar's entrypoint (Node 22, standard library only), rewritten for radar-2.
//
// It loads the sealed snapshot, scores every pre-token protocol with the model in
// lib/model.ts, and writes the ranked board, the dashboard dataset and the dossier
// the judge reads. The dashboard and the screenshots ride along untouched.
//
//   node main.ts --input <snapshot.json|directory> --output <directory>
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The grader mounts the sealed input at /input and reads /output; outside that
// container MAKEFUN_OUTPUT_DIR (or --output) picks the destination instead.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The dossier's own limits, from the gate's reference: the text cap bounds the
// dossier's bytes, and the screenshot caps refuse anything over them.
const LIMITS = {
  textMaxBytes: 65_536,
  shots: { max: 4, max_bytes: 524_288 },
  imageName: /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/,
};

// Where this file lives, so dashboard/ and screenshots/ are found beside it.
const ROOT = fileURLToPath(new URL('./', import.meta.url));

/** Stop with a message on stderr and the given exit code. */
function fail(message: string, code: number): never {
  process.stderr.write(message + '\n');
  process.exit(code);
}

/** The value after `--name`, or after `--name=`; the fallback when neither is given. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
  }
  for (const a of argv) {
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

/** Copy a directory's plain files into `to`, leaving dotfiles behind. */
function copyDir(from: string, to: string): string[] {
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  return fs
    .readdirSync(from)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => fs.statSync(path.join(from, name)).isFile())
    .map((name) => {
      fs.copyFileSync(path.join(from, name), path.join(to, name));
      return name;
    });
}

function main(): void {
  const inputArg = flagValue('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : path.join(inputArg, 'snapshot.json');
  if (!fs.existsSync(inputFile)) {
    fail(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  const out = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(fs.readFileSync(inputFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) fail(`token radar: the model wrote a board the gate refuses: ${issue}`, 1);

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  fs.writeFileSync(path.join(out, 'data.js'), dataScript(radar));

  copyDir(path.join(ROOT, 'dashboard'), path.join(out, 'dashboard'));
  const shots = copyDir(path.join(ROOT, 'screenshots'), path.join(out, 'screenshots'));
  if (shots.length < 3) {
    fail(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
  }
  for (const name of shots) {
    if (!LIMITS.imageName.test(name)) {
      fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }

  // The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
  fs.writeFileSync(
    path.join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: LIMITS.textMaxBytes,
      screenshots: LIMITS.shots,
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  const summary = [
    'token radar: ' + snapshot.protocols.length + ' protocols, ' + snapshot.watchlist.length + ' on the watchlist, ' + board.length + ' rows scored (' + radar.early_size + ' early, ' + radar.live_size + ' live set aside, ' + radar.accounting.excluded + ' pre-token set aside with a reason)',
    'token radar: validation: split-half log error ' + radar.validation.oos_median_log_error + ' vs flat ' + radar.validation.flat_median_log_error + ' (' + radar.validation.improvement_pct + '% better, n=' + radar.validation.oos_n_test + '), leave-one-out ' + radar.validation.loo_median_log_error + ' (n=' + radar.validation.loo_n + '), ranks from ' + radar.validation.bootstrap_refits + ' bootstrap refits, model ' + (radar.validation.kept ? 'kept' : 'NOT kept'),
    'token radar: wrote ' + path.join(out, 'board.json') + ', ' + path.join(out, 'data.js') + ', ' + path.join(out, 'dashboard') + ' (3 files), ' + path.join(out, 'screenshots') + ' (' + shots.length + ' images) and ' + path.join(out, 'dossier.json'),
  ];
  process.stdout.write(summary.join('\n') + '\n');
}

main();
