import { RiviumStorage, RiviumStorageError } from '@rivium/storage-node';
import type { TransformOptions } from '@rivium/storage-node';

/// RiviumStorage Node.js SDK — Complete Example
///
/// This example demonstrates ALL capabilities of the RiviumStorage Node.js SDK:
///
/// **Client operations** (apiKey only):
///   - Bucket operations (list, get by ID, get by name)
///   - File operations (upload, list, get, download, delete)
///   - URL generation (public URL, transform URL, download URL)
///   - Image transformations (resize, format, quality, effects)
///
/// **Server operations** (apiKey + serverSecret):
///   - Create/delete buckets
///   - Delete files (single, by path, bulk)
///   - Signed URLs (upload and download)
///   - Bucket policies (create, templates, list)
///
/// Usage:
///   npm start              — Run all examples
///   npm run start:client   — Run client examples only
///   npm run start:server   — Run server examples only

// ============================================================
// Configuration
// ============================================================

const API_KEY = 'rv_live_64e0ada5eeb66e3adf6136337802a5a34713ce4966372854';
const SERVER_SECRET = 'rv_srv_65b60189d3c41afa9fa0674e42ff57d887a1a24c4d28dd94';
const BUCKET_NAME = 'my-bucket';
const USER_ID = 'demo-user-123';

// ============================================================
// Logging
// ============================================================

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function log(msg: string) { console.log(green(msg)); }
function logError(msg: string) { console.log(red(msg)); }
function logInfo(msg: string) { console.log(cyan(msg)); }
function logWarn(msg: string) { console.log(yellow(msg)); }
function section(title: string) {
  console.log('');
  console.log(bold(cyan(`${'='.repeat(50)}`)));
  console.log(bold(cyan(`  ${title}`)));
  console.log(bold(cyan(`${'='.repeat(50)}`)));
  console.log('');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

// ============================================================
// State — captured from API responses
// ============================================================

let lastBucketId: string | null = null;
let lastFileId: string | null = null;
let lastFilePath: string | null = null;
let lastImageFileId: string | null = null;
const uploadedFileIds: string[] = [];

// ============================================================
// Client Examples (apiKey only)
// ============================================================

async function runClientExamples() {
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: USER_ID, timeout: 30000 });

  // -- Bucket Operations --
  section('Bucket Operations');

  logInfo('1. Listing all buckets...');
  try {
    const buckets = await storage.listBuckets();
    log(`   Found ${buckets.length} bucket(s):`);
    for (const b of buckets) {
      log(`   - ${b.name} (${b.visibility}) [${b.id}]`);
    }
    if (buckets.length > 0) {
      lastBucketId = buckets[0].id;
      log(`   Stored bucket ID: ${lastBucketId}`);
    }
  } catch (e) {
    logError(`   Error: ${(e as Error).message}`);
  }

  logInfo(`2. Getting bucket by name: ${BUCKET_NAME}...`);
  try {
    const bucket = await storage.getBucketByName(BUCKET_NAME);
    log(`   Found: ${bucket.name} (${bucket.id})`);
    lastBucketId = bucket.id;
    log(`   Stored bucket ID: ${bucket.id}`);
  } catch (e) {
    logError(`   Error: ${(e as Error).message}`);
  }

  if (lastBucketId) {
    logInfo(`3. Getting bucket by ID: ${lastBucketId}...`);
    try {
      const bucket = await storage.getBucket(lastBucketId);
      log(`   Bucket: ${bucket.name}`);
      log(`   - ID: ${bucket.id}`);
      log(`   - Visibility: ${bucket.visibility}`);
      log(`   - Policies Enabled: ${bucket.policiesEnabled}`);
      log(`   - Active: ${bucket.isActive}`);
      if (bucket.allowedMimeTypes) log(`   - Allowed MIME: ${bucket.allowedMimeTypes.join(', ')}`);
      if (bucket.maxFileSize) log(`   - Max File Size: ${formatBytes(bucket.maxFileSize)}`);
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }
  }

  // -- File Operations --
  section('File Operations');

  if (!lastBucketId) {
    logWarn('   No bucket ID available. Skipping file operations.');
  } else {
    // Upload text file
    logInfo('1. Uploading text file...');
    try {
      const content = `Hello, RiviumStorage! Timestamp: ${Date.now()}`;
      const path = `examples/test-${Date.now()}.txt`;
      const file = await storage.upload(lastBucketId, path, content, {
        contentType: 'text/plain',
        metadata: { author: 'Node.js Example', version: '1.0' },
      });
      log(`   Uploaded: ${file.fileName}`);
      log(`   - ID: ${file.id}`);
      log(`   - Path: ${file.path}`);
      log(`   - Size: ${formatBytes(file.size)}`);
      log(`   - MIME: ${file.mimeType}`);
      if (file.url) log(`   - URL: ${file.url}`);
      lastFileId = file.id;
      lastFilePath = file.path;
      uploadedFileIds.push(file.id);
      log(`   Stored file ID: ${file.id}`);
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }

    // Upload image (1x1 red PNG)
    logInfo('2. Uploading image (PNG)...');
    try {
      const redPixelPNG = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
        0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
        0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      const path = `examples/images/sample-${Date.now()}.png`;
      const file = await storage.upload(lastBucketId, path, redPixelPNG, {
        contentType: 'image/png',
      });
      log(`   Uploaded: ${file.fileName}`);
      log(`   - ID: ${file.id}`);
      log(`   - Size: ${formatBytes(file.size)}`);
      lastImageFileId = file.id;
      lastFileId = file.id;
      lastFilePath = file.path;
      uploadedFileIds.push(file.id);
      log(`   Stored image file ID: ${file.id}`);
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }

    // List files
    logInfo('3. Listing files (prefix: examples/, limit: 10)...');
    try {
      const result = await storage.listFiles(lastBucketId, { prefix: 'examples/', limit: 10 });
      log(`   Found ${result.files.length} file(s):`);
      for (const f of result.files) {
        log(`   - ${f.path} (${formatBytes(f.size)}) [${f.id}]`);
      }
      if (result.nextCursor) log(`   (More files available, cursor: ${result.nextCursor.substring(0, 20)}...)`);
      if (result.files.length > 0 && !lastFileId) {
        lastFileId = result.files[0].id;
        lastFilePath = result.files[0].path;
        log(`   Stored file ID: ${lastFileId} from listing`);
      }
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }

    // Get file by ID
    if (lastFileId) {
      logInfo(`4. Getting file by ID: ${lastFileId}...`);
      try {
        const file = await storage.getFile(lastFileId);
        log(`   Found: ${file.fileName}`);
        log(`   - Path: ${file.path}`);
        log(`   - Size: ${formatBytes(file.size)}`);
        log(`   - MIME: ${file.mimeType}`);
        log(`   - Created: ${file.createdAt}`);
        log(`   - Updated: ${file.updatedAt}`);
      } catch (e) {
        logError(`   Error: ${(e as Error).message}`);
      }
    }

    // Get file by path
    if (lastBucketId && lastFilePath) {
      logInfo(`5. Getting file by path: ${lastFilePath}...`);
      try {
        const file = await storage.getFileByPath(lastBucketId, lastFilePath);
        log(`   Found: ${file.fileName} (${file.id})`);
        log(`   - Size: ${formatBytes(file.size)}`);
        log(`   - MIME: ${file.mimeType}`);
      } catch (e) {
        logError(`   Error: ${(e as Error).message}`);
      }
    }

    // Download file
    if (lastFileId) {
      logInfo(`6. Downloading file: ${lastFileId}...`);
      try {
        const data = await storage.download(lastFileId);
        log(`   Downloaded ${formatBytes(data.length)}`);
        if (data.length < 200) {
          try {
            const content = data.toString('utf-8');
            log(`   Content: "${content}"`);
          } catch {
            log(`   (Binary content)`);
          }
        }
      } catch (e) {
        logError(`   Error: ${(e as Error).message}`);
      }
    }
  }

  // -- URL Generation --
  section('URL Generation');

  if (lastFileId) {
    const fileId = lastFileId;
    logInfo(`Generating URLs for file: ${fileId}`);

    log(`   Public URL: ${storage.getUrl(fileId)}`);
    log(`   Download URL: ${storage.getDownloadUrl(fileId)}`);
    log(`   Thumbnail URL (200x200): ${storage.getTransformUrl(fileId, { width: 200, height: 200 })}`);
    log(`   Advanced Transform URL: ${storage.getTransformUrl(fileId, {
      width: 800, height: 600, fit: 'cover', format: 'webp', quality: 85,
    })}`);
  } else {
    logWarn('   No file ID available. Upload a file first.');
  }

  // -- Image Transformations --
  section('Image Transformations');

  const transformFileId = lastImageFileId ?? lastFileId;
  if (transformFileId) {
    logInfo(`Image Transform Examples (file: ${transformFileId}):`);

    const transforms: Record<string, TransformOptions> = {
      'Resize 200x200': { width: 200, height: 200 },
      'Width only (auto height)': { width: 400 },
      'Height only (auto width)': { height: 300 },
      'Fit: cover': { width: 200, height: 200, fit: 'cover' },
      'Fit: contain': { width: 200, height: 200, fit: 'contain' },
      'Fit: fill': { width: 200, height: 200, fit: 'fill' },
      'Format: WebP': { width: 200, format: 'webp' },
      'Format: AVIF': { width: 200, format: 'avif' },
      'Format: JPEG': { width: 200, format: 'jpeg' },
      'Quality: 50%': { width: 200, format: 'jpeg', quality: 50 },
      'Quality: 90%': { width: 200, format: 'jpeg', quality: 90 },
      'Blur effect': { width: 200, blur: 10 },
      'Sharpen effect': { width: 200, sharpen: 50 },
      'Rotate 90deg': { rotate: 90 },
      'Rotate 180deg': { rotate: 180 },
      'Rotate 270deg': { rotate: 270 },
      'Combined transforms': { width: 400, height: 300, fit: 'cover', format: 'webp', quality: 80, sharpen: 20 },
    };

    for (const [name, opts] of Object.entries(transforms)) {
      log(`   ${name}: ${storage.getTransformUrl(transformFileId, opts)}`);
    }
  } else {
    logWarn('   No file ID available. Upload an image first.');
  }

  // -- Policy Testing --
  section('Policy Testing (Client-side)');

  if (!lastBucketId) {
    logWarn('   No bucket ID available. Skipping policy tests.');
  } else {
    const bucketId = lastBucketId;
    const ts = Date.now();

    async function tryUpload(path: string, data: string | Buffer, contentType?: string): Promise<string> {
      try {
        await storage.upload(bucketId, path, data, { contentType: contentType || 'text/plain' });
        return 'ALLOWED';
      } catch {
        return 'DENIED';
      }
    }

    async function tryList(): Promise<string> {
      try {
        await storage.listFiles(bucketId, { limit: 1 });
        return 'ALLOWED';
      } catch {
        return 'DENIED';
      }
    }

    // No Rules test
    logInfo('TEST: No Rules (no policy on bucket)');
    log(`   Current userId: ${storage.userId ?? 'none (unauthenticated)'}`);
    log(`   Upload text file:   ${await tryUpload(`test/no-rules-${ts}.txt`, 'test content')}`);
    log(`   List files:         ${await tryList()}`);
    log(`   Expected: Everything ALLOWED`);
    console.log('');

    // Private test
    logInfo('TEST: Private Template');
    log(`   -- With userId: ${storage.userId} --`);
    log(`   Upload text:   ${await tryUpload(`test/private-${ts}.txt`, 'test content')}`);
    log(`   List files:    ${await tryList()}`);

    const savedUserId = storage.userId;
    storage.setUserId(null);
    log(`   -- Without userId (unauthenticated) --`);
    log(`   Upload text:   ${await tryUpload(`test/private-anon-${ts}.txt`, 'test content')}`);
    log(`   List files:    ${await tryList()}`);
    storage.setUserId(savedUserId ?? null);
    log(`   Expected: With userId ALLOWED, Without DENIED`);
    console.log('');

    // Images Only test
    logInfo('TEST: Images Only Template');
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
      0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    log(`   Upload PNG image:   ${await tryUpload(`test/image-${ts}.png`, pngData, 'image/png')}`);
    log(`   Upload text file:   ${await tryUpload(`test/doc-${ts}.txt`, 'test', 'text/plain')}`);
    log(`   List files:         ${await tryList()}`);
    log(`   Expected: PNG ALLOWED, Text DENIED, List ALLOWED`);
  }

  // -- Error Handling --
  section('Error Handling');

  logInfo('Testing error handling with invalid file ID...');
  try {
    await storage.getFile('non-existent-file-id');
  } catch (e) {
    if (e instanceof RiviumStorageError) {
      logError(`   Caught RiviumStorageError:`);
      logError(`   Message: ${e.message}`);
      if (e.statusCode) logError(`   Status Code: ${e.statusCode}`);
      if (e.code) logError(`   Error Code: ${e.code}`);
    }
    log('   Error handling example complete!');
  }
}

// ============================================================
// Server Examples (apiKey + serverSecret)
// ============================================================

async function runServerExamples() {
  if ((SERVER_SECRET as string) === 'YOUR_SERVER_SECRET') {
    logWarn('Server secret not configured. Set SERVER_SECRET to run server examples.');
    logWarn('Server operations require rv_srv_xxx from Rivium Console.');
    return;
  }

  const admin = new RiviumStorage({
    apiKey: API_KEY,
    serverSecret: SERVER_SECRET,
    timeout: 30000,
  });

  // -- Create Bucket --
  section('Server: Bucket Management');

  let testBucketId: string | null = null;

  logInfo('1. Bucket creation is done via the Rivium Console dashboard.');
  log('   Buckets belong to projects — create them in Project Settings > RiviumStorage.');
  log('   Using existing bucket for remaining server examples.');

  // -- Signed URLs --
  section('Server: Signed URLs');

  if (lastFileId) {
    logInfo('1. Generating signed download URL...');
    try {
      const signedUrl = await admin.getSignedUrl(lastFileId, { expiresIn: 3600 });
      log(`   Signed Download URL (1h): ${signedUrl}`);
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }
  }

  if (testBucketId || lastBucketId) {
    const bucketId = testBucketId || lastBucketId!;
    logInfo('2. Generating signed upload URL...');
    try {
      const result = await admin.createSignedUploadUrl(bucketId, `uploads/temp-${Date.now()}.jpg`, {
        contentType: 'image/jpeg',
        expiresIn: 300,
      });
      log(`   Signed Upload URL (5m): ${result.url}`);
      if (result.fileId) log(`   Pre-assigned File ID: ${result.fileId}`);
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }
  }

  // -- Bucket Policies --
  section('Server: Bucket Policies');

  const policyBucketId = testBucketId || lastBucketId;

  if (policyBucketId) {
    logInfo('1. Getting available policy templates...');
    try {
      const templates = await admin.getPolicyTemplates(policyBucketId);
      log(`   Available templates: ${Object.keys(templates).join(', ')}`);
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }

    logInfo('2. Applying "publicRead" policy template...');
    let policyId: string | null = null;
    try {
      const policy = await admin.applyPolicyTemplate(policyBucketId, 'publicRead', 'Public Read Policy');
      policyId = policy.id;
      log(`   Applied policy: ${policy.name} (${policy.id})`);
      log(`   - Rules: ${policy.rules.length}`);
      log(`   - Active: ${policy.isActive}`);
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }

    logInfo('3. Listing policies on bucket...');
    try {
      const policies = await admin.listPolicies(policyBucketId);
      log(`   Found ${policies.length} policy(ies):`);
      for (const p of policies) {
        log(`   - ${p.name ?? '(unnamed)'} [${p.id}] (${p.rules.length} rules)`);
      }
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }

    // Clean up policy
    if (policyId) {
      logInfo(`4. Deleting policy: ${policyId}...`);
      try {
        await admin.deletePolicy(policyBucketId, policyId);
        log('   Deleted successfully');
      } catch (e) {
        logError(`   Error: ${(e as Error).message}`);
      }
    }
  }

  // -- Server-side Delete Operations --
  section('Server: Delete Operations');

  if (uploadedFileIds.length > 0) {
    logInfo(`Deleting ${uploadedFileIds.length} uploaded file(s)...`);
    try {
      const result = await admin.deleteMany([...uploadedFileIds]);
      log(`   Deleted ${result.deleted} file(s)`);
      uploadedFileIds.length = 0;
      lastFileId = null;
      lastFilePath = null;
      lastImageFileId = null;
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }
  } else {
    logWarn('   No uploaded files to delete.');
  }

  // Clean up test bucket
  if (testBucketId) {
    logInfo(`Deleting test bucket: ${testBucketId}...`);
    try {
      await admin.deleteBucket(testBucketId);
      log('   Deleted successfully');
    } catch (e) {
      logError(`   Error: ${(e as Error).message}`);
    }
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const clientOnly = args.includes('--client');
  const serverOnly = args.includes('--server');

  console.log(bold(cyan('\n' + '='.repeat(50))));
  console.log(bold(cyan('  RiviumStorage Node.js SDK — Complete Example')));
  console.log(bold(cyan('='.repeat(50))));
  console.log('');
  console.log(dim(`  API Key:       ${(API_KEY as string) === 'YOUR_API_KEY' ? '(not set)' : API_KEY.substring(0, 20) + '...'}`));
  console.log(dim(`  Server Secret: ${(SERVER_SECRET as string) === 'YOUR_SERVER_SECRET' ? '(not set)' : '****'}`));
  console.log(dim(`  Bucket:        ${BUCKET_NAME}`));
  console.log(dim(`  User ID:       ${USER_ID}`));

  if (!serverOnly) {
    await runClientExamples();
  }

  if (!clientOnly) {
    await runServerExamples();
  }

  console.log('');
  console.log(bold(cyan('='.repeat(50))));
  console.log(bold(cyan('  All examples completed!')));
  console.log(bold(cyan('='.repeat(50))));
  console.log('');
}

main().catch(e => {
  logError(`Fatal error: ${e.message}`);
  process.exit(1);
});
