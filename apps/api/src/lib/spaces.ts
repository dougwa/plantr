import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.js";

// Origin endpoint — used for writes/deletes. The SDK prepends the bucket as a
// virtual-host subdomain, e.g. https://plantr.sfo3.digitaloceanspaces.com.
const ORIGIN_ENDPOINT = `https://${env.SPACES_REGION}.digitaloceanspaces.com`;

// Read endpoint — used to sign GET URLs. When CDN is enabled, the URL points
// at the CDN edge. The signature is host-specific (SigV4 includes host), so we
// need a separate client whose endpoint matches the host we want clients to
// hit.
const READ_ENDPOINT = env.SPACES_CDN_ENABLED
  ? `https://${env.SPACES_REGION}.cdn.digitaloceanspaces.com`
  : ORIGIN_ENDPOINT;

const credentials = {
  accessKeyId: env.SPACES_ACCESS_KEY_ID,
  secretAccessKey: env.SPACES_SECRET_ACCESS_KEY,
};

const writeClient = new S3Client({
  region: env.SPACES_REGION,
  endpoint: ORIGIN_ENDPOINT,
  credentials,
  forcePathStyle: false,
});

const readClient = new S3Client({
  region: env.SPACES_REGION,
  endpoint: READ_ENDPOINT,
  credentials,
  forcePathStyle: false,
});

export const SPACES_BUCKET = env.SPACES_BUCKET;

export async function putObject(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await writeClient.send(
    new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
      // Private — clients only access via signed URL.
      ACL: "private",
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await writeClient.send(
    new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: key }),
  );
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await Promise.allSettled(keys.map((k) => deleteObject(k)));
}

export async function signGetUrl(key: string): Promise<string> {
  return getSignedUrl(
    readClient,
    new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }),
    { expiresIn: env.SPACES_URL_EXPIRY_SECONDS },
  );
}
