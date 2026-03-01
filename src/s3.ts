import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";
export interface S3Config {
  region: string;
  bucket: string;
  prefix: string;
  retentionDays: number;
}

export function createS3Client(config: S3Config) {
  const client = new S3Client({ region: config.region });

  async function uploadBackup(stream: ReadableStream<Uint8Array>, key: string): Promise<void> {
    const fullKey = `${config.prefix}${key}`;
    console.log(`[s3] uploading to s3://${config.bucket}/${fullKey}`);

    await new Upload({
      client,
      params: {
        Bucket: config.bucket,
        Key: fullKey,
        Body: Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]),
        ContentType: "application/zip",
      },
    }).done();

    console.log(`[s3] upload complete: ${fullKey}`);
  }

  async function pruneOldBackups(): Promise<void> {
    if (config.retentionDays <= 0) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.retentionDays);
    console.log(
      `[s3] pruning backups older than ${config.retentionDays} days (before ${cutoff.toISOString()})`
    );

    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: config.prefix,
      })
    );

    const toDelete = (listed.Contents ?? []).filter(
      (obj) => obj.LastModified !== undefined && obj.LastModified < cutoff
    );

    if (toDelete.length === 0) {
      console.log("[s3] no old backups to prune");
      return;
    }

    const keys = toDelete.map((obj) => ({ Key: obj.Key! }));
    console.log(`[s3] deleting ${keys.length} old backup(s)`);

    await client.send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: keys },
      })
    );

    for (const k of keys) {
      console.log(`[s3] deleted ${k.Key}`);
    }
  }

  return { uploadBackup, pruneOldBackups };
}
