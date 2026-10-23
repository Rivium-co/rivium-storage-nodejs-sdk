/**
 * Runs a list of steps two ways:
 *   tour  (npm start)      every step with its explanation and its full result
 *   check (npm run check)  one PASS / FAIL line per step, a summary, exit code 1 on any failure
 * A step either returns a value (shown) or, when it expects an error, must throw exactly that error.
 * Nothing is caught silently: an unexpected error is a FAIL with the error's message, status and code.
 */
import { RiviumStorageError, StorageErrorCode } from '@rivium/storage-node';
import { legacyMatch, LEGACY_NOTE } from './bucket-setup';

export interface ExpectedError {
  /** HTTP status the API (or the SDK) answers with. */
  status?: number | number[];
  /** Error code, when the SDK exposes it. */
  code?: string | string[];
  /** Part of the message. */
  message?: RegExp;
}

export interface Step {
  section: string;
  title: string;
  /** One or two sentences: what this shows and why it matters. */
  explain: string;
  run: () => Promise<unknown>;
  /** The step must fail with this error. */
  expectError?: ExpectedError;
  /** Checked just before the step runs: a string = SKIP with that text (a bucket setting the step needs is off). */
  precondition?: () => string | null;
}

/** Thrown by a step that cannot run with this setup: shown as SKIP, not FAIL. */
export class SkipStep extends Error {}

/** Thrown by a step that ran but found something to change (the bucket setup): shown as WARN, not FAIL. */
export class WarnStep extends Error {}

export interface StepResult {
  step: Step;
  ok: boolean;
  /** The step could not run here (the reason is in detail); it does not count as a failure. */
  skipped?: boolean;
  /** Ran, but there is something to change (the reason is in detail); it does not count as a failure. */
  warned?: boolean;
  ms: number;
  detail: string;
}

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
export const colors = c;

/**
 * A refused image transform as an app should show it: a title per `code`, the
 * server's message, the code and what to do. Transform URLs are fetched by your
 * code, so read `code` / `message` from the JSON body of the non-2xx answer
 * (never show the raw body or the URL with the file id).
 */
export class TransformRefusal extends RiviumStorageError {
  readonly title: string;
  readonly hint: string | undefined;
  /** Seconds from the `Retry-After` header (`transform_busy` sends 2), when the answer had one. */
  retryAfter: number | undefined;

  constructor(status: number, body: { code?: unknown; message?: unknown }) {
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : typeof body.message === 'string' && body.message
        ? body.message
        : `The server answered HTTP ${status}.`;
    const code = typeof body.code === 'string' && body.code ? body.code : undefined;
    super(message, status, code);
    this.name = 'TransformRefusal';
    [this.title, this.hint] = transformTitle(code, status);
  }

  /** Reads the JSON body of a refused transform response. */
  static async from(res: Response): Promise<TransformRefusal> {
    const body: unknown = await res.json().catch(() => ({}));
    const refusal = new TransformRefusal(res.status, body && typeof body === 'object' ? (body as { code?: unknown; message?: unknown }) : {});
    const retryAfter = Number(res.headers.get('retry-after'));
    if (res.headers.has('retry-after') && Number.isFinite(retryAfter) && retryAfter >= 0) refusal.retryAfter = retryAfter;
    return refusal;
  }
}

function transformTitle(code: string | undefined, status: number): [string, string | undefined] {
  const denied: [string, string] = ['Access denied', "The bucket's access rules refused this request."];
  switch (code) {
    case StorageErrorCode.ImageFormatNotSupported:
      return ['Format not supported', 'Convert it to JPEG, PNG or WebP and upload it again.'];
    case StorageErrorCode.NotAnImage:
      return ['Not an image', 'Pick an image file.'];
    case StorageErrorCode.ImageDamaged:
      return ['Image damaged', 'Upload it again.'];
    case StorageErrorCode.ImageTooLarge:
      return ['Image too large', 'Use a smaller image (up to 50 megapixels).'];
    case StorageErrorCode.InvalidTransform:
      return ['Invalid options', 'Change the transform options.'];
    case StorageErrorCode.SourceTooLarge:
      return ['File too large', 'Use an image under 25 MB.'];
    case StorageErrorCode.PlanFeatureLocked:
      return ['Not in your plan', "Image transforms aren't in this project's plan (Free). Upgrade the plan, or use the plain public link."];
    case StorageErrorCode.TooManyVariants:
      return ['Too many sizes', 'This image already has 50 sizes / formats. Use a few fixed sizes (for example 200, 600 and 1200 wide).'];
    case StorageErrorCode.TransformBusy:
      return ['Busy', 'Image processing is busy. Try again after the Retry-After seconds.'];
    case StorageErrorCode.TokenRequired:
    case StorageErrorCode.TokenInvalid:
    case StorageErrorCode.TokenExpired:
      return ['Sign-in needed', 'Send a valid user token, then retry.'];
    case StorageErrorCode.AccessDenied:
      return denied;
  }
  if (status === 403) return denied;
  if (status === 404) return ['File not found', 'Upload the image again.'];
  return ["Couldn't transform the image", undefined];
}

export function describeError(e: unknown): string {
  if (e instanceof TransformRefusal) {
    return `${c.bold(e.title)}: ${e.message} (code=${e.code ?? '-'}, status=${e.statusCode})${e.hint ? ` - What to do: ${e.hint}` : ''}`;
  }
  if (e instanceof RiviumStorageError) {
    return `${e.name} status=${e.statusCode ?? '-'} code=${e.code ?? '-'} message="${e.message}"`;
  }
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

function oneOf<T>(want: T | T[] | undefined, got: T | undefined): boolean {
  if (want === undefined) return true;
  return (Array.isArray(want) ? want : [want]).includes(got as T);
}

/** null = the error is the expected one; `legacy` = it is, but from an older Storage API that sends no code. */
function matches(expected: ExpectedError, e: unknown): { problem: string | null; legacy?: boolean } {
  if (!(e instanceof RiviumStorageError)) return { problem: `expected a RiviumStorageError, got ${describeError(e)}` };
  if (!oneOf(expected.status, e.statusCode)) return { problem: `expected status ${expected.status}, got ${describeError(e)}` };
  let legacy = false;
  if (!oneOf(expected.code, e.code)) {
    const codes = expected.code === undefined ? [] : Array.isArray(expected.code) ? expected.code : [expected.code];
    legacy = codes.some((c) => legacyMatch(c, e.statusCode, e.code, e.message));
    if (!legacy) return { problem: `expected code ${expected.code}, got ${describeError(e)}` };
  }
  if (expected.message && !expected.message.test(e.message)) return { problem: `expected message ${expected.message}, got ${describeError(e)}` };
  return { problem: null, legacy };
}

function show(value: unknown): string {
  if (value === undefined) return '(no value)';
  if (typeof value === 'string') return value;
  const text = JSON.stringify(value, (_k, v) => (Buffer.isBuffer(v) ? `<Buffer ${v.length} bytes>` : v), 2);
  return text.length > 1800 ? `${text.slice(0, 1800)}\n... (${text.length} characters)` : text;
}

export async function runStep(step: Step): Promise<StepResult> {
  const t0 = Date.now();
  const unmet = step.precondition?.();
  if (unmet) return { step, ok: true, skipped: true, ms: 0, detail: unmet };
  try {
    const value = await step.run();
    if (step.expectError) {
      return { step, ok: false, ms: Date.now() - t0, detail: `expected an error, but it succeeded: ${show(value)}` };
    }
    return { step, ok: true, ms: Date.now() - t0, detail: show(value) };
  } catch (e) {
    if (e instanceof SkipStep) return { step, ok: true, skipped: true, ms: Date.now() - t0, detail: e.message };
    if (e instanceof WarnStep) return { step, ok: true, warned: true, ms: Date.now() - t0, detail: e.message };
    if (step.expectError) {
      const { problem, legacy } = matches(step.expectError, e);
      const note = legacy ? ` - ${LEGACY_NOTE}` : '';
      return { step, ok: !problem, ms: Date.now() - t0, detail: problem ?? `refused as expected: ${describeError(e)}${note}` };
    }
    return { step, ok: false, ms: Date.now() - t0, detail: describeError(e) };
  }
}

export function printResult(r: StepResult, mode: 'tour' | 'check', index: number): void {
  if (mode === 'check') {
    const tag = r.skipped ? c.yellow('SKIP') : r.warned ? c.magenta('WARN') : r.ok ? c.green('PASS') : c.red('FAIL');
    console.log(`${tag} ${String(index).padStart(2)}. ${r.step.section} > ${r.step.title} ${c.dim(`(${r.ms} ms)`)}`);
    if (!r.ok) console.log(c.red(`        ${r.detail.split('\n').join('\n        ')}`));
    if (r.skipped) console.log(c.yellow(`        ${r.detail}`));
    if (r.warned) console.log(c.magenta(`        ${r.detail.split('\n').join('\n        ')}`));
    if (r.ok && !r.skipped && !r.warned && r.detail.includes('older Storage API')) console.log(c.dim(`        ${r.detail.split('\n')[0]}`));
    return;
  }
  console.log(c.bold(`${index}. ${r.step.title}`) + c.dim(`  (${r.ms} ms)`));
  console.log(c.dim(`   ${r.step.explain}`));
  const body = r.detail.split('\n').map((l) => `   ${l}`).join('\n');
  console.log(
    r.skipped ? c.yellow(`   SKIPPED: ${r.detail}`) : r.warned ? c.magenta(`   WARNING:\n${body}`) : r.ok ? c.green(body) : c.red(`   FAILED: ${r.detail}`),
  );
  console.log('');
}

export function printSection(name: string, mode: 'tour' | 'check'): void {
  if (mode === 'check') return;
  console.log(c.bold(c.cyan(`\n== ${name} ${'='.repeat(Math.max(0, 60 - name.length))}\n`)));
}
