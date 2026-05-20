import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "../env.js";

const ORIGIN_ENDPOINT = `https://${env.SPACES_REGION}.digitaloceanspaces.com`;

const credentials = {
  accessKeyId: env.SPACES_ACCESS_KEY_ID,
  secretAccessKey: env.SPACES_SECRET_ACCESS_KEY,
};

// AWS SDK client is only used for uploads + deletes. Uploads from the SDK
// already work against Spaces; the signed-GET path is handled below by a
// hand-rolled SigV4 presigner. The SDK's own presigner adds `x-id` and
// `X-Amz-Content-Sha256` query parameters that DO Spaces' verifier doesn't
// accept, which is why we sign reads ourselves.
const writeClient = new S3Client({
  region: env.SPACES_REGION,
  endpoint: ORIGIN_ENDPOINT,
  credentials,
  forcePathStyle: false,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
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

// --- SigV4 presigner (GET only) --------------------------------------------

const READ_HOSTNAME = env.SPACES_CDN_ENABLED
  ? `${env.SPACES_BUCKET}.${env.SPACES_REGION}.cdn.digitaloceanspaces.com`
  : `${env.SPACES_BUCKET}.${env.SPACES_REGION}.digitaloceanspaces.com`;

const SERVICE = "s3";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function deriveSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

// AWS-style URI encoding: encodeURIComponent + ! ' ( ) * — but keep "/" in
// the path component as path separators.
function awsUriEncode(value: string, encodeSlash: boolean): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return encodeSlash ? encoded : encoded.replace(/%2F/g, "/");
}

export function signGetUrl(key: string): string {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${env.SPACES_REGION}/${SERVICE}/aws4_request`;
  const credential = `${env.SPACES_ACCESS_KEY_ID}/${credentialScope}`;
  const algorithm = "AWS4-HMAC-SHA256";
  const signedHeaders = "host";

  const canonicalUri = "/" + awsUriEncode(key, false);

  const queryParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", algorithm],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(env.SPACES_URL_EXPIRY_SECONDS)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];

  const canonicalQuery = queryParams
    .map(([k, v]) => [awsUriEncode(k, true), awsUriEncode(v, true)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalHeaders = `host:${READ_HOSTNAME}\n`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(
    env.SPACES_SECRET_ACCESS_KEY,
    dateStamp,
    env.SPACES_REGION,
    SERVICE,
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `https://${READ_HOSTNAME}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
