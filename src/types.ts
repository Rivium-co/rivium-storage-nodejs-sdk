export interface RiviumStorageConfig {
  /**
   * API Key for project identification (rv_live_xxx or rv_test_xxx)
   * Required for all operations
   */
  apiKey: string;

  /**
   * Server Secret for privileged server-side operations (nl_srv_xxx)
   * Required for: delete, deleteMany, generateSignedUrl, bulk operations
   */
  serverSecret?: string;

  /**
   * User ID for bucket policy enforcement (e.g., when proxying requests for end users)
   * Sent as x-user-id header. Can also be set/changed later via setUserId().
   */
  userId?: string;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;
}

export interface Bucket {
  id: string;
  name: string;
  projectId: string;
  organizationId: string;
  visibility: 'public' | 'private';
  allowedMimeTypes?: string[];
  maxFileSize?: number;
  policiesEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StorageFile {
  id: string;
  bucketId: string;
  path: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum?: string;
  storageKey: string;
  metadata?: Record<string, unknown>;
  uploadedBy?: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  url?: string;
}

export interface UploadOptions {
  /**
   * Content type (MIME type) of the file
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
  cursor?: string;
}

export interface ListFilesResult {
  files: StorageFile[];
  nextCursor?: string;
}

export interface SignedUrlOptions {
  /**
   * Expiration time in seconds
   * @default 3600 (1 hour)
   */
  expiresIn?: number;
}

export interface SignedUploadUrlOptions extends SignedUrlOptions {
  /**
   * Content type for the upload
   */
  contentType: string;
}

export interface TransformOptions {
  /**
   * Target width in pixels
   */
  width?: number;

  /**
   * Target height in pixels
   */
  height?: number;

  /**
   * Resize mode
   */
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';

  /**
   * Output format
   */
  format?: 'jpeg' | 'png' | 'webp' | 'avif';

  /**
   * Compression quality (1-100)
   */
  quality?: number;

  /**
   * Blur amount (0-100)
   */
  blur?: number;

  /**
   * Sharpen amount (0-100)
   */
  sharpen?: number;

  /**
   * Rotation in degrees
   */
  rotate?: 90 | 180 | 270;
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
  name?: string;
  description?: string;
  rules: PolicyRule[];
  isActive: boolean;
  createdAt: string;
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
