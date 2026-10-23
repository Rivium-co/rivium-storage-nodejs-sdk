import { Readable, Transform } from 'stream';
import type FormData from 'form-data';
import type { UploadProgress } from './types';

/** Minimum time between two progress events, unless the upload moved by 1% or more. */
const PROGRESS_INTERVAL_MS = 50;
/** Size of the pieces the body is sent in, so progress moves while a large buffer goes out. */
const SLICE_BYTES = 16 * 1024;

/**
 * Wraps `onProgress` so it is called at most every 50 ms or every 1% of the
 * upload, never with more than `totalBytes`, never twice with the same value,
 * and always once with `bytesSent === totalBytes` at the end.
 */
export function createProgressReporter(
  onProgress: (progress: UploadProgress) => void,
  totalBytes: number,
  now: () => number = Date.now,
): (bytesSent: number, final?: boolean) => void {
  let lastAt = -Infinity;
  let lastSent = -1;
  let finished = false;

  return (bytesSent, final = false) => {
    if (finished) return;
    const sent = Math.min(Math.max(0, bytesSent), totalBytes);
    const isFinal = final || sent >= totalBytes;
    const value = isFinal ? totalBytes : sent;
    if (!isFinal) {
      if (value === lastSent) return;
      const t = now();
      const movedEnough = value - Math.max(lastSent, 0) >= totalBytes / 100;
      if (t - lastAt < PROGRESS_INTERVAL_MS && !movedEnough) return;
      lastAt = t;
    } else {
      finished = true;
    }
    lastSent = value;
    try {
      onProgress({ bytesSent: value, totalBytes });
    } catch (e) {
      // A throwing callback must not break the upload.
      console.error('[RiviumStorage] onProgress threw:', e);
    }
  };
}

/**
 * The multipart body as a stream that reports how many bytes the HTTP request
 * has taken. The form is cut into small pieces and counted only when the
 * request asks for more, so the count follows the upload instead of jumping to
 * the end when the file is handed over.
 */
export function uploadProgressBody(
  form: FormData,
  totalBytes: number,
  onProgress: (progress: UploadProgress) => void,
): Readable {
  const report = createProgressReporter(onProgress, totalBytes);
  let sent = 0;

  const splitter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (let i = 0; i < buf.length; i += SLICE_BYTES) {
        this.push(buf.subarray(i, i + SLICE_BYTES));
      }
      callback();
    },
  });

  const counter = new Transform({
    highWaterMark: SLICE_BYTES,
    transform(chunk: Buffer, _encoding, callback) {
      sent += chunk.length;
      callback(null, chunk);
      // Never report the end before the last piece has been taken.
      if (sent < totalBytes) report(sent);
    },
  });

  counter.on('end', () => report(totalBytes, true));
  const fail = (error: Error) => counter.destroy(error);
  form.on('error', fail);
  splitter.on('error', fail);
  counter.on('close', () => {
    splitter.destroy();
    // The form keeps its parts in memory; stop it from writing any further.
    (form as unknown as { destroy?: () => void }).destroy?.();
  });

  form.pipe(splitter).pipe(counter);
  return counter;
}
