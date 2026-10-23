import fetch, { Response } from 'node-fetch';
import FormData from 'form-data';
import {
  RiviumStorageConfig,
  StorageFile,
  Bucket,
  UploadOptions,
  ListFilesOptions,
  ListFilesResult,
  SignedUrlOptions,
  SignedUploadUrlOptions,
  TransformOptions,
  CreateBucketOptions,
  PolicyRule,
  BucketPolicy,
  RiviumStorageError,
  UserTokenResult,
  SignedUploadUrlResult,
} from './types';
import { SDK_HEADER, SDK_HEADER_VALUE } from './version';
import { uploadProgressBody } from './progress';
import { contentTypeForPath } from './file-types';
import {
  encodePathSegments,
  bucketSegment,
  fileIdSegment,
  checkUploadPath,
  encodeSegment,
  transformQuery,
  publicImageUrl,
} from './url-segments';
import { StorageErrorCode } from './error-codes';

export * from './types';
export { SDK_NAME, SDK_VERSION } from './version';
export { StorageErrorCode } from './error-codes';
export { publicImageUrl } from './url-segments';
export {
  contentTypeForPath,
  CONTENT_TYPES_BY_EXTENSION,
  DEFAULT_CONTENT_TYPE,
  FILE_TYPES_VERSION,
} from './file-types';

/**
 * The error for a failed response: the server's `message` (an array of
 * validation messages is joined), its `statusCode` and its `code`
 * (`type_not_allowed`, `file_too_large`, `path_taken`, … see `StorageErrorCode`).
 */
async function errorFromResponse(response: Response, fallback: string): Promise<RiviumStorageError> {
  let body: { message?: unknown; code?: unknown } = {};
  try {
    const text = await response.text();
    if (text) body = JSON.parse(text);
  } catch {
    // not JSON: keep the fallback message
  }
  const raw = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
  return new RiviumStorageError(
    typeof raw === 'string' && raw ? raw : fallback,
    response.status,
    typeof body?.code === 'string' ? body.code : undefined,
  );
}

const API_BASE_URL = 'https://storage.rivium.co';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_AUTH_URL = 'https://auth.rivium.co';

/** Hosts an `http://` authUrl may point at (a local Rivium Auth while developing). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The auth URL without a trailing slash; throws unless it is https (or http on this machine). */
function checkedAuthUrl(raw: string): string {
  const value = raw.replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RiviumStorageError(`authUrl is not a valid URL: ${value}`, 400, 'INVALID_ARGUMENT');
  }
  const local = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new RiviumStorageError(
      'authUrl must start with https:// (http:// is accepted only for localhost), because the server secret is sent to it.',
      400,
      'INVALID_ARGUMENT',
    );
  }
  return value;
}

/** CR and LF would end a multipart header line. */
const MULTIPART_UNSAFE = /[\r\n]/;

export class RiviumStorage {
  private apiKey: string;
  /** A real private field, so `console.log(storage)` and error reporters never print the secret. */
  readonly #serverSecret?: string;
  private baseUrl: string;
  private timeout: number;
  private authUrl: string;

  constructor(config: RiviumStorageConfig) {
    if (!config.apiKey) {
      throw new RiviumStorageError('API key is required');
    }

    if (config.serverSecret && typeof (globalThis as { window?: unknown }).window !== 'undefined') {
      throw new RiviumStorageError(
        'serverSecret must never be used in a browser: anyone can read it from your page. ' +
          'Keep the secret on your server, and use @rivium/storage-web with your public key (and a user token) in the browser.',
        400,
        'INVALID_ARGUMENT',
      );
    }

    if (!config.serverSecret) {
      throw new RiviumStorageError(
        'The Node SDK runs on your server and needs serverSecret (rv_srv_..., from an environment variable); apps use the Web/RN/mobile SDKs.',
        400,
        'INVALID_ARGUMENT',
      );
    }

    this.apiKey = config.apiKey;
    this.#serverSecret = config.serverSecret;
    this.baseUrl = API_BASE_URL;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.authUrl = checkedAuthUrl(config.authUrl || DEFAULT_AUTH_URL);
  }

  // ==========================================
  // Rivium user token
  // ==========================================

  /**
   * Mint a Rivium user token so your app can prove who the signed-in user is.
   *
   * Bucket rules read the user. A client cannot set that itself - the API key
   * it ships with is public, so the server would have no reason to believe a
   * user id the app picks. Your backend, which holds the server secret, calls
   * this and hands the token to the app; the client SDKs take it through their
   * `tokenProvider` option and send it on every request. The same token works
   * in every Rivium product, and a Rivium Auth sign-in token is the same kind
   * of token.
   *
   * Never ship the server secret (or this call) inside an app.
   *
   * @param userId    Your own id for the signed-in user - whatever your rules expect.
   * @param expiresIn Lifetime in seconds. Default 1 hour, maximum 24 hours.
   *
   * @example
   * // In your Express backend, behind your own session check:
   * app.post('/rivium-token', async (req, res) => {
   *   const { token, expiresAt } = await storage.createUserToken(req.session.userId);
   *   res.json({ token, expiresAt });
   * });
   */
  async createUserToken(userId: string, expiresIn?: number): Promise<UserTokenResult> {
    if (!userId) {
      throw new RiviumStorageError('createUserToken requires a userId', 400, 'INVALID_ARGUMENT');
    }
    const serverSecret = this.#serverSecret;
    if (!serverSecret) {
      throw new RiviumStorageError(
        'createUserToken requires the server secret. Initialize with serverSecret (from an environment variable, on your server only).',
        403,
        StorageErrorCode.ServerSecretRequired,
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response: Response = await fetch(`${this.authUrl}/users/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'x-server-secret': serverSecret,
          [SDK_HEADER]: SDK_HEADER_VALUE,
        },
        body: JSON.stringify(expiresIn === undefined ? { userId } : { userId, expiresIn }),
        redirect: 'error',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { message?: unknown; code?: unknown };
        const message = Array.isArray(error.message) ? error.message.join(', ') : error.message;
        throw new RiviumStorageError(
          typeof message === 'string' && message ? message : `HTTP ${response.status}`,
          response.status,
          typeof error.code === 'string' ? error.code : undefined,
        );
      }

      return (await response.json()) as UserTokenResult;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof RiviumStorageError) {
        throw error;
      }
      if ((error as Error).name === 'AbortError') {
        throw new RiviumStorageError('Request timeout', 408, 'TIMEOUT');
      }
      throw new RiviumStorageError((error as Error).message);
    }
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private async request<T>(
    method: string,
    endpoint: string,
    options: {
      body?: unknown;
      formData?: FormData;
      onUploadProgress?: UploadOptions['onProgress'];
      requiresServerSecret?: boolean;
    } = {},
  ): Promise<T> {
    const { body, formData, onUploadProgress, requiresServerSecret } = options;

    // Check if server secret is required
    if (requiresServerSecret && !this.#serverSecret) {
      throw new RiviumStorageError(
        'Server secret is required for this operation. Initialize with serverSecret option.',
        403,
        StorageErrorCode.ServerSecretRequired,
      );
    }

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      [SDK_HEADER]: SDK_HEADER_VALUE,
    };

    if (this.#serverSecret) {
      headers['x-server-secret'] = this.#serverSecret;
    }

    if (body && !formData) {
      headers['Content-Type'] = 'application/json';
    }

    let requestBody: FormData | NodeJS.ReadableStream | string | undefined =
      formData || (body ? JSON.stringify(body) : undefined);

    if (formData && onUploadProgress) {
      // Stream the same multipart body through a byte counter. The headers
      // node-fetch would derive from the form are set here, so the request
      // on the wire is the same as without onProgress.
      const totalBytes = formData.getLengthSync();
      headers['Content-Type'] = `multipart/form-data;boundary=${formData.getBoundary()}`;
      headers['Content-Length'] = String(totalBytes);
      requestBody = uploadProgressBody(formData, totalBytes, onUploadProgress);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response: Response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        body: requestBody,
        // Never follow a redirect: the next hop would receive the API key and server secret.
        redirect: 'error',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw await errorFromResponse(response, `HTTP ${response.status}`);
      }

      if (response.status === 204) {
        return {} as T;
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof RiviumStorageError) {
        throw error;
      }
      if ((error as Error).name === 'AbortError') {
        throw new RiviumStorageError('Request timeout', 408, 'TIMEOUT');
      }
      throw new RiviumStorageError((error as Error).message);
    }
  }

  // ==========================================
  // Bucket Operations
  // ==========================================

  /**
   * Create a new bucket
   * Requires serverSecret
   */
  async createBucket(name: string, options: CreateBucketOptions = {}): Promise<Bucket> {
    return this.request<Bucket>('POST', '/api/v1/buckets', {
      body: { name, ...options },
      requiresServerSecret: true,
    });
  }

  /**
   * List all buckets in the project
   */
  async listBuckets(): Promise<Bucket[]> {
    return this.request<Bucket[]>('GET', '/api/v1/buckets');
  }

  /**
   * Get bucket by ID
   */
  async getBucket(bucketId: string): Promise<Bucket> {
    return this.request<Bucket>('GET', `/api/v1/buckets/${bucketSegment(bucketId)}`);
  }

  /**
   * Get bucket by name
   */
  async getBucketByName(name: string): Promise<Bucket> {
    return this.request<Bucket>('GET', `/api/v1/buckets/name/${bucketSegment(name)}`);
  }

  /**
   * Delete a bucket
   * Requires serverSecret
   */
  async deleteBucket(bucketId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/buckets/${bucketSegment(bucketId)}`, {
      requiresServerSecret: true,
    });
  }

  // ==========================================
  // File Operations
  // ==========================================

  /**
   * Upload a file to a bucket
   *
   * Pass `onProgress` in the options to follow the upload:
   * `{ onProgress: ({ bytesSent, totalBytes }) => ... }`.
   */
  async upload(
    bucketIdOrName: string,
    path: string,
    data: Buffer | Uint8Array | string,
    options: UploadOptions = {},
  ): Promise<StorageFile> {
    const bucket = bucketSegment(bucketIdOrName);
    // Normalised like the server stores it; `?`, `#`, `%`, text-direction
    // characters and `.` / `..` segments are refused before anything is sent.
    const sentPath = checkUploadPath(options.path || path);
    // The path goes into the multipart body; CR or LF could forge extra
    // header lines or fields there (the server refuses them anyway).
    if (MULTIPART_UNSAFE.test(sentPath)) {
      throw new RiviumStorageError("Path can't contain control characters", 400, StorageErrorCode.InvalidPath);
    }

    const formData = new FormData();

    // Convert to Buffer if needed
    let buffer: Buffer;
    if (typeof data === 'string') {
      buffer = Buffer.from(data);
    } else if (data instanceof Uint8Array) {
      buffer = Buffer.from(data);
    } else {
      buffer = data;
    }

    // The app's type, else the Rivium Storage file types table's type for the
    // extension (the one the Console offers and the server stores), else
    // application/octet-stream (the server then goes by the extension).
    formData.append('file', buffer, {
      filename: (sentPath.split('/').pop() || 'file').replace(/[\r\n"]/g, '_'),
      contentType: options.contentType || contentTypeForPath(sentPath),
    });

    formData.append('path', sentPath);

    if (options.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    return this.request<StorageFile>('POST', `/api/v1/buckets/${bucket}/files`, {
      formData,
      onUploadProgress: options.onProgress,
    });
  }

  /**
   * List files in a bucket
   */
  async listFiles(bucketId: string, options: ListFilesOptions = {}): Promise<ListFilesResult> {
    const params = new URLSearchParams();
    if (options.prefix) params.set('prefix', options.prefix);
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.cursor) params.set('cursor', options.cursor);

    const query = params.toString();
    return this.request<ListFilesResult>(
      'GET',
      `/api/v1/buckets/${bucketSegment(bucketId)}/files${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get file by ID
   */
  async getFile(fileId: string): Promise<StorageFile> {
    return this.request<StorageFile>('GET', `/api/v1/files/${fileIdSegment(fileId)}`);
  }

  /**
   * Get file by path in bucket
   */
  async getFileByPath(bucketId: string, path: string): Promise<StorageFile> {
    return this.request<StorageFile>('GET', `/api/v1/buckets/${bucketSegment(bucketId)}/files/${encodePathSegments(path)}`);
  }

  /**
   * Download file content
   */
  async download(fileId: string): Promise<Buffer> {
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      [SDK_HEADER]: SDK_HEADER_VALUE,
    };

    if (this.#serverSecret) {
      headers['x-server-secret'] = this.#serverSecret;
    }

    const url = `${this.baseUrl}/api/v1/files/${fileIdSegment(fileId)}/download`;
    let response: Response;
    try {
      // Never follow a redirect: the next hop would receive the API key and server secret.
      response = await fetch(url, { headers, redirect: 'error' });
    } catch (error) {
      throw new RiviumStorageError((error as Error).message);
    }

    if (!response.ok) {
      throw await errorFromResponse(response, `Download failed: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Delete a file by ID
   * Requires serverSecret
   */
  async delete(fileId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/files/${fileIdSegment(fileId)}`, {
      requiresServerSecret: true,
    });
  }

  /**
   * Delete a file by path in bucket
   * Requires serverSecret
   */
  async deleteByPath(bucketId: string, path: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/buckets/${bucketSegment(bucketId)}/files/${encodePathSegments(path)}`, {
      requiresServerSecret: true,
    });
  }

  /**
   * Delete multiple files
   * Requires serverSecret
   */
  async deleteMany(fileIds: string[]): Promise<{ deleted: number }> {
    return this.request<{ deleted: number }>('POST', '/api/v1/files/delete-many', {
      body: { ids: fileIds },
      requiresServerSecret: true,
    });
  }

  // ==========================================
  // Links
  // ==========================================

  /**
   * The public link of a file in a PUBLIC bucket:
   * `https://storage.rivium.co/public/<bucketId>/<path>`. Anyone can open it
   * without a key or token (an `<img src>`, a browser tab, an e-mail). One
   * request to `GET /api/v1/files/:id/url`; a file in a private bucket is
   * refused with `403` (it has no public link: use `getSignedUrl()`).
   *
   * With `transforms` the link is a resized / converted image, still with no
   * headers: `getPublicUrl(id, { width: 600, format: 'webp' })` gives
   * `.../public/<bucketId>/<path>?w=600&f=webp`, for the `<img src>` your
   * pages, e-mails or API answers carry. The options are checked first
   * (`invalid_transform`, 400, before any request) and written in a fixed
   * order, so the same options always give the same URL: the CDN and the
   * server cache it as one image (replacing the file updates it). One image
   * keeps at most 50 different variants (`too_many_variants`, 429): use a few
   * fixed sizes. Plans without image transforms (Free) answer
   * `plan_feature_locked` (403).
   */
  async getPublicUrl(fileId: string, transforms?: TransformOptions): Promise<string> {
    // invalid_transform before any request.
    const query = transformQuery(transforms);
    const result = await this.request<{ url: string }>('GET', `/api/v1/files/${fileIdSegment(fileId)}/url`);
    return query ? publicImageUrl(result.url, transforms) : result.url;
  }

  /**
   * The image URL for a public link you already have (from `getPublicUrl()`,
   * saved in your database), with no request: the link plus the transform
   * options, checked and written exactly as `getPublicUrl(id, transforms)`
   * writes them. Throws `invalid_transform` (400) for an option the server
   * would refuse and `invalid_path` (400) when `publicUrl` isn't a public file
   * link. Also exported as the function `publicImageUrl`.
   */
  static publicImageUrl(publicUrl: string, transforms?: TransformOptions): string {
    return publicImageUrl(publicUrl, transforms);
  }

  /**
   * The API address `GET /api/v1/files/:id/url`. Called with the `x-api-key`
   * header it answers `{ url }`, the public link above; the address itself is
   * not a link to the file. Use `getPublicUrl()`, which makes that request.
   */
  getUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/files/${fileIdSegment(fileId)}/url`;
  }

  /**
   * The API address of a file's bytes, `/api/v1/files/:id/download`. It needs
   * the `x-api-key` header; `download()` sends it for you. To hand a private
   * file to someone without a key, use `getSignedUrl()`.
   */
  getDownloadUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/files/${fileIdSegment(fileId)}/download`;
  }

  /**
   * The API address of a transformed image:
   * `/api/v1/transform/:id?w=&h=&fit=&f=&q=&blur=&sharpen=&rotate=`.
   *
   * Options are checked first: `format` jpeg / png / webp / avif, `fit` cover
   * / contain / fill / inside / outside, `width` / `height` 1..4096 (larger
   * values are sent as 4096), `quality` 1..100, `blur` 0..20, `sharpen`
   * 0..10; anything else throws `invalid_transform` (400). Like every
   * `/api/v1` address it needs the `x-api-key` header.
   */
  getTransformUrl(fileId: string, transforms?: TransformOptions): string {
    return `${this.baseUrl}/api/v1/transform/${fileIdSegment(fileId)}${transformQuery(transforms)}`;
  }

  /**
   * Generate signed download URL for private files
   * Requires serverSecret
   */
  async getSignedUrl(fileId: string, options: SignedUrlOptions = {}): Promise<string> {
    const result = await this.request<{ url: string }>(
      'POST',
      `/api/v1/files/${fileIdSegment(fileId)}/signed-url`,
      {
        body: { expiresIn: options.expiresIn || 3600 },
        requiresServerSecret: true,
      },
    );
    return result.url;
  }

  /**
   * A link your app can `PUT` one file to, without a key: give it to the app,
   * which sends the file with the content type it was signed for. The link
   * lives `expiresIn` seconds: 300 (5 minutes) by default, at most 900 (15
   * minutes); larger values are cut to 900 by the server. The path follows
   * the same rules as `upload()` (checked before the request). The file is
   * registered when it is first read or listed, when you call
   * `POST /api/v1/buckets/:bucketId/files/confirm-upload`, or within about
   * 20 seconds; the bucket's size, type and access rules are checked then.
   * Requires serverSecret.
   */
  async createSignedUploadUrl(
    bucketId: string,
    path: string,
    options: SignedUploadUrlOptions,
  ): Promise<SignedUploadUrlResult> {
    const bucket = bucketSegment(bucketId);
    const filePath = checkUploadPath(path);
    return this.request<SignedUploadUrlResult>(
      'POST',
      `/api/v1/buckets/${bucket}/files/signed-upload-url`,
      {
        body: {
          path: filePath,
          contentType: options.contentType,
          expiresIn: options.expiresIn || 300,
        },
        requiresServerSecret: true,
      },
    );
  }

  // ==========================================
  // Bucket Policies
  // ==========================================

  /**
   * Create a bucket policy
   * Requires serverSecret
   */
  async createPolicy(
    bucketId: string,
    rules: PolicyRule[],
    options: { name?: string; description?: string } = {},
  ): Promise<BucketPolicy> {
    return this.request<BucketPolicy>('POST', `/api/v1/buckets/${bucketSegment(bucketId)}/policies`, {
      body: { rules, ...options },
      requiresServerSecret: true,
    });
  }

  /**
   * List bucket policies
   */
  async listPolicies(bucketId: string): Promise<BucketPolicy[]> {
    return this.request<BucketPolicy[]>('GET', `/api/v1/buckets/${bucketSegment(bucketId)}/policies`);
  }

  /**
   * Get policy templates
   */
  async getPolicyTemplates(bucketId: string): Promise<Record<string, PolicyRule[]>> {
    return this.request<Record<string, PolicyRule[]>>(
      'GET',
      `/api/v1/buckets/${bucketSegment(bucketId)}/policies/templates`,
    );
  }

  /**
   * Apply a policy template to a bucket
   * Requires serverSecret
   */
  async applyPolicyTemplate(
    bucketId: string,
    template: 'publicRead' | 'private' | 'userFolders' | 'imagesOnly' | 'closed',
    name?: string,
  ): Promise<BucketPolicy> {
    return this.request<BucketPolicy>('POST', `/api/v1/buckets/${bucketSegment(bucketId)}/policies/templates/apply`, {
      body: { template, name },
      requiresServerSecret: true,
    });
  }

  /**
   * Delete a policy
   * Requires serverSecret
   */
  async deletePolicy(bucketId: string, policyId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/buckets/${bucketSegment(bucketId)}/policies/${encodeSegment(policyId)}`, {
      requiresServerSecret: true,
    });
  }
}

// Default export
export default RiviumStorage;
