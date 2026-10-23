/**
 * The two test buckets every Rivium Storage example uses (Node, Web, Android, iOS, Flutter, React Native),
 * created with the server secret. Safe to run any number of times: what exists is kept, what is missing is added.
 *
 *   PUBLIC_BUCKET  (default rivium-example-public)
 *     public, any file type, executables blocked, rules: users' own folders
 *   PRIVATE_BUCKET (default rivium-example-private-images)
 *     private, JPEG / PNG / GIF / WebP only, max PRIVATE_BUCKET_MAX_SIZE bytes (default 1 MB),
 *     executables blocked, rules: users' own folders
 *
 * "Users' own folders" (template userFolders): a signed-in user reads and lists the whole bucket, but uploads and
 * deletes only under users/{their user id}/. Your server (server secret) skips the rules.
 */
import { RiviumStorage, RiviumStorageError } from '@rivium/storage-node';
import type { Bucket, CreateBucketOptions } from '@rivium/storage-node';
import type { ExampleEnv } from './env';

export const RULES_NAME = "rivium-example: users' own folders";
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export interface TestBucketInfo {
  id: string;
  name: string;
  visibility: string;
  allowedMimeTypes: string[] | null;
  maxFileSize: number | null;
  blockExecutables: boolean | null;
  created: boolean;
  rulesApplied: boolean;
}

export interface TestBucketsResult {
  public: TestBucketInfo;
  private: TestBucketInfo;
  warnings: string[];
}

interface Wanted {
  name: string;
  options: CreateBucketOptions & { blockExecutables: boolean; policiesEnabled: boolean };
}

async function findByName(server: RiviumStorage, name: string): Promise<Bucket | null> {
  try {
    return await server.getBucketByName(name);
  } catch (e) {
    if (e instanceof RiviumStorageError && e.statusCode === 404) return null;
    throw e;
  }
}

async function ensureBucket(server: RiviumStorage, wanted: Wanted, warnings: string[]): Promise<{ bucket: Bucket; created: boolean }> {
  const existing = await findByName(server, wanted.name);
  if (existing) {
    const b = existing as Bucket & { blockExecutables?: boolean };
    const o = wanted.options;
    if (b.visibility !== o.visibility) warnings.push(`${wanted.name}: visibility is ${b.visibility}, the examples expect ${o.visibility}.`);
    if (o.maxFileSize && Number(b.maxFileSize) !== o.maxFileSize) {
      warnings.push(`${wanted.name}: max file size is ${b.maxFileSize}, the examples expect ${o.maxFileSize}.`);
    }
    const want = [...(o.allowedMimeTypes ?? [])].sort().join(',');
    const have = [...(b.allowedMimeTypes ?? [])].sort().join(',');
    if (want !== have) warnings.push(`${wanted.name}: allowed types are [${have || 'any'}], the examples expect [${want || 'any'}].`);
    if (b.blockExecutables === false) warnings.push(`${wanted.name}: executable files are allowed; the examples expect them blocked.`);
    return { bucket: existing, created: false };
  }

  try {
    // SDK gap: CreateBucketOptions has no `blockExecutables` / `policiesEnabled` fields yet. The API accepts them and
    // the SDK sends every option it gets, so the example passes them through.
    const bucket = await server.createBucket(wanted.name, wanted.options as CreateBucketOptions);
    return { bucket, created: true };
  } catch (e) {
    // Two setups at once: the other one created it first.
    const again = await findByName(server, wanted.name);
    if (again) return { bucket: again, created: false };
    throw e;
  }
}

async function ensureRules(server: RiviumStorage, bucket: Bucket, warnings: string[]): Promise<boolean> {
  const policies = await server.listPolicies(bucket.id);
  const others = policies.filter((p) => p.name !== RULES_NAME);
  if (others.length) {
    warnings.push(
      `${bucket.name}: has other access rules too (${others.map((p) => p.name || p.id).join(', ')}); they can change what the app examples see.`,
    );
  }
  if (policies.some((p) => p.name === RULES_NAME)) return false;
  await server.applyPolicyTemplate(bucket.id, 'userFolders', RULES_NAME);
  return true;
}

function info(bucket: Bucket, created: boolean, rulesApplied: boolean): TestBucketInfo {
  const b = bucket as Bucket & { blockExecutables?: boolean };
  return {
    id: b.id,
    name: b.name,
    visibility: b.visibility,
    allowedMimeTypes: b.allowedMimeTypes ?? null,
    maxFileSize: b.maxFileSize != null ? Number(b.maxFileSize) : null,
    blockExecutables: typeof b.blockExecutables === 'boolean' ? b.blockExecutables : null,
    created,
    rulesApplied,
  };
}

/** Creates the test buckets and their rules when missing. Idempotent. Needs the server-secret instance. */
export async function setupTestBuckets(server: RiviumStorage, env: ExampleEnv): Promise<TestBucketsResult> {
  const warnings: string[] = [];

  const pub = await ensureBucket(
    server,
    {
      name: env.publicBucket,
      options: {
        visibility: 'public',
        maxFileSize: 10 * 1024 * 1024,
        description: 'Rivium Storage examples: public files (users write only to users/{userId}/)',
        blockExecutables: true,
        policiesEnabled: true,
      },
    },
    warnings,
  );
  const priv = await ensureBucket(
    server,
    {
      name: env.privateBucket,
      options: {
        visibility: 'private',
        allowedMimeTypes: IMAGE_TYPES,
        maxFileSize: env.privateBucketMaxSize,
        description: 'Rivium Storage examples: private images (users write only to users/{userId}/)',
        blockExecutables: true,
        policiesEnabled: true,
      },
    },
    warnings,
  );

  const pubRules = await ensureRules(server, pub.bucket, warnings);
  const privRules = await ensureRules(server, priv.bucket, warnings);

  return {
    public: info(pub.bucket, pub.created, pubRules),
    private: info(priv.bucket, priv.created, privRules),
    warnings,
  };
}
