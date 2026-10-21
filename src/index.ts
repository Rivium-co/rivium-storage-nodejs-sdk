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
} from './types';
import { SDK_HEADER, SDK_HEADER_VALUE } from './version';

export * from './types';
export { SDK_NAME, SDK_VERSION } from './version';

const API_BASE_URL = 'https://storage.rivium.co';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_AUTH_URL = 'https://auth.rivium.co';

export class RiviumStorage {
  private apiKey: string;
  private serverSecret?: string;
  private _userId?: string | null;
  private baseUrl: string;
  private timeout: number;
  private authUrl: string;

  constructor(config: RiviumStorageConfig) {
    if (!config.apiKey) {
      throw new RiviumStorageError('API key is required');
    }

    this.apiKey = config.apiKey;
    this.serverSecret = config.serverSecret;
    this._userId = config.userId;
    this.baseUrl = API_BASE_URL;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.authUrl = (config.authUrl || DEFAULT_AUTH_URL).replace(/\/+$/, '');
  }

  // ==========================================
  // Rivium user token
  // ==========================================

  /**
   * Mint a Rivium user token so your app can prove who the signed-in user is.
   *
   * Bucket rules read the user. A client cannot set that itself - the API key
   * it ships with is public, so the server would have no reason to believe an
   * `x-user-id` header. Your backend, which holds the server secret, calls
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
    if (!this.serverSecret) {
      throw new RiviumStorageError(
        'createUserToken requires the server secret. Initialize with serverSecret (from an environment variable, on your server only).',
        403,
        'SERVER_SECRET_REQUIRED',
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
          'x-server-secret': this.serverSecret,
          [SDK_HEADER]: SDK_HEADER_VALUE,
        },
        body: JSON.stringify(expiresIn === undefined ? { userId } : { userId, expiresIn }),
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

  /**
   * Set the user ID for bucket policy enforcement.
   * Pass null to clear the user ID.
   */
  setUserId(userId: string | null): void {
    this._userId = userId;
  }

  /**
   * Get the current user ID
   */
  get userId(): string | null | undefined {
    return this._userId;
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
      requiresServerSecret?: boolean;
    } = {},
  ): Promise<T> {
    const { body, formData, requiresServerSecret } = options;

    // Check if server secret is required
    if (requiresServerSecret && !this.serverSecret) {
      throw new RiviumStorageError(
        'Server secret is required for this operation. Initialize with serverSecret option.',
        403,
        'SERVER_SECRET_REQUIRED',
      );
    }

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      [SDK_HEADER]: SDK_HEADER_VALUE,
    };

    if (this.serverSecret) {
      headers['x-server-secret'] = this.serverSecret;
    }

    if (this._userId) {
      headers['x-user-id'] = this._userId;
    }

    if (body && !formData) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response: Response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        body: formData || (body ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new RiviumStorageError(
          (error as { message?: string }).message || `HTTP ${response.status}`,
          response.status,
        );
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
    return this.request<Bucket>('GET', `/api/v1/buckets/${bucketId}`);
  }

  /**
   * Get bucket by name
   */
  async getBucketByName(name: string): Promise<Bucket> {
    return this.request<Bucket>('GET', `/api/v1/buckets/name/${name}`);
  }

  /**
   * Delete a bucket
   * Requires serverSecret
   */
  async deleteBucket(bucketId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/buckets/${bucketId}`, {
      requiresServerSecret: true,
    });
  }

  // ==========================================
  // File Operations
  // ==========================================

  /**
   * Upload a file to a bucket
   */
  async upload(
    bucketIdOrName: string,
    path: string,
    data: Buffer | Uint8Array | string,
    options: UploadOptions = {},
  ): Promise<StorageFile> {
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

    formData.append('file', buffer, {
      filename: path.split('/').pop() || 'file',
      contentType: options.contentType || 'application/octet-stream',
    });

    formData.append('path', options.path || path);

    if (options.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    return this.request<StorageFile>('POST', `/api/v1/buckets/${bucketIdOrName}/files`, {
      formData,
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
      `/api/v1/buckets/${bucketId}/files${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Get file by ID
   */
  async getFile(fileId: string): Promise<StorageFile> {
    return this.request<StorageFile>('GET', `/api/v1/files/${fileId}`);
  }

  /**
   * Get file by path in bucket
   */
  async getFileByPath(bucketId: string, path: string): Promise<StorageFile> {
    return this.request<StorageFile>('GET', `/api/v1/buckets/${bucketId}/files/${path}`);
  }

  /**
   * Download file content
   */
  async download(fileId: string): Promise<Buffer> {
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      [SDK_HEADER]: SDK_HEADER_VALUE,
    };

    if (this.serverSecret) {
      headers['x-server-secret'] = this.serverSecret;
    }

    if (this._userId) {
      headers['x-user-id'] = this._userId;
    }

    const response = await fetch(`${this.baseUrl}/api/v1/files/${fileId}/download`, {
      headers,
    });

    if (!response.ok) {
      throw new RiviumStorageError(`Download failed: ${response.status}`, response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Delete a file by ID
   * Requires serverSecret
   */
  async delete(fileId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/files/${fileId}`, {
      requiresServerSecret: true,
    });
  }

  /**
   * Delete a file by path in bucket
   * Requires serverSecret
   */
  async deleteByPath(bucketId: string, path: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/buckets/${bucketId}/files/${path}`, {
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
  // URL Generation
  // ==========================================

  /**
   * Get public URL for a file (only works for public buckets)
   */
  getUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/files/${fileId}/url`;
  }

  /**
   * Get download URL (for direct access without SDK)
   */
  getDownloadUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/files/${fileId}/download`;
  }

  /**
   * Get URL with image transformations
   */
  getTransformUrl(fileId: string, transforms: TransformOptions): string {
    const params = new URLSearchParams();

    if (transforms.width) params.set('w', transforms.width.toString());
    if (transforms.height) params.set('h', transforms.height.toString());
    if (transforms.fit) params.set('fit', transforms.fit);
    if (transforms.format) params.set('f', transforms.format);
    if (transforms.quality) params.set('q', transforms.quality.toString());
    if (transforms.blur) params.set('blur', transforms.blur.toString());
    if (transforms.sharpen) params.set('sharpen', transforms.sharpen.toString());
    if (transforms.rotate) params.set('rotate', transforms.rotate.toString());

    const query = params.toString();
    return `${this.baseUrl}/api/v1/transform/${fileId}${query ? `?${query}` : ''}`;
  }

  /**
   * Generate signed download URL for private files
   * Requires serverSecret
   */
  async getSignedUrl(fileId: string, options: SignedUrlOptions = {}): Promise<string> {
    const result = await this.request<{ url: string }>(
      'POST',
      `/api/v1/files/${fileId}/signed-url`,
      {
        body: { expiresIn: options.expiresIn || 3600 },
        requiresServerSecret: true,
      },
    );
    return result.url;
  }

  /**
   * Generate signed upload URL for direct client uploads
   * Requires serverSecret
   */
  async createSignedUploadUrl(
    bucketId: string,
    path: string,
    options: SignedUploadUrlOptions,
  ): Promise<{ url: string; fileId?: string }> {
    return this.request<{ url: string; fileId?: string }>(
      'POST',
      `/api/v1/buckets/${bucketId}/files/signed-upload-url`,
      {
        body: {
          path,
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
    return this.request<BucketPolicy>('POST', `/api/v1/buckets/${bucketId}/policies`, {
      body: { rules, ...options },
      requiresServerSecret: true,
    });
  }

  /**
   * List bucket policies
   */
  async listPolicies(bucketId: string): Promise<BucketPolicy[]> {
    return this.request<BucketPolicy[]>('GET', `/api/v1/buckets/${bucketId}/policies`);
  }

  /**
   * Get policy templates
   */
  async getPolicyTemplates(bucketId: string): Promise<Record<string, PolicyRule[]>> {
    return this.request<Record<string, PolicyRule[]>>(
      'GET',
      `/api/v1/buckets/${bucketId}/policies/templates`,
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
    return this.request<BucketPolicy>('POST', `/api/v1/buckets/${bucketId}/policies/templates/apply`, {
      body: { template, name },
      requiresServerSecret: true,
    });
  }

  /**
   * Delete a policy
   * Requires serverSecret
   */
  async deletePolicy(bucketId: string, policyId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/v1/buckets/${bucketId}/policies/${policyId}`, {
      requiresServerSecret: true,
    });
  }
}

// Default export
export default RiviumStorage;
