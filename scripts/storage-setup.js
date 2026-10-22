// Prepares the S3 bucket for the site: CORS rules that let the browser upload parts directly
// (PUT, the ETag header must be readable) and play the video redirected to the bucket (GET).
// Usage: npm run storage:setup  (reads S3_* from .env; CORS_ORIGINS=https://a.example,https://b.example
// limits the allowed sites, by default any site is allowed: signed links are the protection).
require('dotenv').config();
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

async function main() {
  const { S3_BUCKET: Bucket, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!Bucket || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error('Fill S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env first');
  const client = new S3Client({
    region: S3_REGION || 'auto', endpoint: S3_ENDPOINT || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  await client.send(new HeadBucketCommand({ Bucket }));
  console.log(`Bucket "${Bucket}" is reachable.`);
  const origins = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  await client.send(new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: {
      CORSRules: [{
        AllowedOrigins: origins,
        AllowedMethods: ['GET', 'HEAD', 'PUT'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range'],
        MaxAgeSeconds: 3600,
      }],
    },
  }));
  const cors = await client.send(new GetBucketCorsCommand({ Bucket }));
  console.log('CORS rules set:', JSON.stringify(cors.CORSRules));
}

main().catch((err) => {
  console.error('Storage setup failed:', err.name, err.message);
  process.exit(1);
});
