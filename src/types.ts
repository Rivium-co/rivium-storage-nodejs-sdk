export interface RiviumStorageConfig {
  /**
   * API Key for project identification (rv_live_xxx or rv_test_xxx)
   * Required for all operations
   */
  apiKey: string;

  /**
   * Your server secret (rv_srv_xxx), from an environment variable. Required:
   * the Node SDK runs on your server, acts with full access (bucket rules are
   * skipped) and mints user tokens with createUserToken(). Never ship it in
   * an app; apps use the Web / React Native / mobile SDKs with a user token.
   */
  serverSecret: string;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Base URL of Rivium Auth, used by createUserToken().
   * @default 'https://auth.rivium.co'
   */
  authUrl?: string;
}

/**
 * A Rivium user token minted by createUserToken(). The same token works in
 * every Rivium product (Storage, Sync, Chat, Push, A/B Testing).
 */
export interface UserTokenResult {
  /** The signed token. Hand it to your app; its SDKs send it as x-user-token. */
  token: string;
  /** The user the token is for. */
  userId: string;
  /** Lifetime in seconds. */
  expiresIn: number;
  /** ISO 8601 time at which the token expires. */
  expiresAt: string;
}

export interface Bucket {
  id: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  /** File types the bucket accepts; `null` = every type. */
  allowedMimeTypes: string[] | null;
  /** Largest file the bucket accepts, in bytes. */
  maxFileSize: number;
  /** Whether executable files are refused. */
  blockExecutables: boolean;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

export interface StorageFile {
  id: string;
  bucketId: string;
  /** Full path in the bucket. */
  path: string;
  /** Last path segment. */
  fileName: string;
  mimeType: string;
  /** Bytes. */
  size: number;
  /** MD5 hex of the content. */
  checksum: string | null;
  /** Your own metadata, as sent with the upload. */
  metadata: Record<string, unknown> | null;
  /** The app user who uploaded it (token user or the user your server named). */
  uploadedBy: string | null;
  /** ISO 8601 time of the last upload; `null` on older files. */
  uploadedAt: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

export interface UploadOptions {
  /**
   * Content type (MIME type) of the file. When omitted: the type the Rivium
   * Storage file types table lists for the path's extension (`.md` →
   * `text/markdown`, `.heic` → `image/heic`, …), else `application/octet-stream`.
   */
  contentType?: string;

  /**
   * Custom metadata to attach to the file
   */
  metadata?: Record<string, unknown>;

  /**
   * Path within the bucket (defaults to filename)
   */
  path?: string;

  /**
   * Called while the file is sent, at most every 50 ms or every 1% of the
   * upload, and always once at the end with `bytesSent === totalBytes`.
   * `totalBytes` is the size of the whole request body (the file plus the
   * multipart fields), so it is slightly larger than the file.
   */
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * Upload progress passed to `UploadOptions.onProgress`.
 */
export interface UploadProgress {
  /** Bytes of the request body sent so far. Never more than `totalBytes`. */
  bytesSent: number;
  /** Size of the whole request body in bytes. */
  totalBytes: number;
}

export interface ListFilesOptions {
  /**
   * Filter files by path prefix
   */
  prefix?: string;

  /**
   * Maximum number of files to return
   * @default 100
   */
  limit?: number;

  /**
   * Cursor for pagination
   */
  cursor?: string | null;
}

export interface ListFilesResult {
  files: StorageFile[];
  /** Pass as `cursor` for the next page; `null` on the last page. */
  nextCursor: string | null;
}

export interface SignedUrlOptions {
  /**
   * Expiration time in seconds
   * @default 3600 (1 hour)
   */
  expiresIn?: number;
}

export interface SignedUploadUrlOptions {
  /**
   * Lifetime of the upload link in seconds.
   * @default 300 (5 minutes); at most 900 (15 minutes): larger values are cut to 900
   */
  expiresIn?: number;

  /**
   * Content type for the upload
   */
  contentType: string;
}

/** The answer of createSignedUploadUrl(). */
export interface SignedUploadUrlResult {
  /** Where the app sends the file (PUT, with the content type it was signed for). */
  url: string;
  /** Id of this upload. */
  uploadId: string;
  /** The path the file will have in the bucket. */
  path: string;
  /** ISO 8601 time after which the URL stops working (at most 15 minutes after it was made). */
  expiresAt: string;
  /** Largest file the URL accepts, in bytes. */
  maxSize: number;
}

/**
 * Image transform options. Values outside these ranges throw
 * `invalid_transform` before a URL is built.
 */
export interface TransformOptions {
  /**
   * Target width in pixels, 1 or more (values above 4096 are sent as 4096)
   */
  width?: number;

  /**
   * Target height in pixels, 1 or more (values above 4096 are sent as 4096)
   */
  height?: number;

  /**
   * Resize mode
   */
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';

  /**
   * Output format (default jpeg)
   */
  format?: 'jpeg' | 'png' | 'webp' | 'avif';

  /**
   * Compression quality, 1..100
   */
  quality?: number;

  /**
   * Blur, 0..20 (0 = none)
   */
  blur?: number;

  /**
   * Sharpen, 0..10 (0 = none)
   */
  sharpen?: number;

  /**
   * Rotation in degrees, a whole number (multiples of 90 recommended)
   */
  rotate?: number;
}

export interface CreateBucketOptions {
  /**
   * Bucket visibility
   * @default 'private'
   */
  visibility?: 'public' | 'private';

  /**
   * Allowed MIME types (e.g., ['image/*', 'application/pdf'])
   */
  allowedMimeTypes?: string[];

  /**
   * Maximum file size in bytes
   * @default 10485760 (10MB)
   */
  maxFileSize?: number;

  /**
   * Bucket description
   */
  description?: string;
}

export interface PolicyRule {
  name?: string;
  action: 'read' | 'write' | 'delete' | 'list' | '*';
  condition: PolicyCondition;
  effect?: 'allow' | 'deny';
  priority?: number;
}

export interface PolicyCondition {
  authenticated?: boolean;
  pathPattern?: string;
  matchUserId?: boolean;
  maxSize?: number;
  allowedMimeTypes?: string[];
  validAfter?: string;
  validBefore?: string;
  allowedIPs?: string[];
}

export interface BucketPolicy {
  id: string;
  bucketId: string;
  name: string | null;
  description: string | null;
  rules: PolicyRule[];
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

export class RiviumStorageError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'RiviumStorageError';
  }
}
