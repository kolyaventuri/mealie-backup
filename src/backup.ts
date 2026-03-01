import type { MealieClient, MealieBackup } from "./mealie.js";
import type { S3Config } from "./s3.js";
import { createS3Client } from "./s3.js";

function timestampedKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${date}_${time}.zip`;
}

function newestFirst(a: MealieBackup, b: MealieBackup): number {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

export async function runBackup(mealie: MealieClient, s3Config: S3Config): Promise<void> {
  const s3 = createS3Client(s3Config);
  const startedAt = new Date().toISOString();
  console.log(`\n[backup] starting backup run at ${startedAt}`);

  // 1. Trigger backup creation
  console.log("[backup] requesting Mealie to create a backup...");
  await mealie.createBackup();
  console.log("[backup] backup created");

  // 2. Find the newest backup
  const backups = await mealie.listBackups();
  if (backups.length === 0) {
    throw new Error("No backups found after creation");
  }

  const sorted = [...backups].sort(newestFirst);
  const newest = sorted[0];
  console.log(`[backup] newest backup: ${newest.name} (${newest.date})`);

  // 3. Get a download token
  const token = await mealie.getDownloadToken(newest.name);

  // 4. Stream-download the backup
  console.log("[backup] downloading backup stream from Mealie...");
  const stream = await mealie.downloadBackup(token);

  // 5. Stream-upload to S3
  const s3Key = timestampedKey();
  await s3.uploadBackup(stream, s3Key);

  // 6. Upload succeeded — clean up older Mealie backups, keep the newest one
  const older = sorted.slice(1);
  if (older.length > 0) {
    console.log(`[backup] removing ${older.length} older Mealie backup(s)...`);
    for (const backup of older) {
      await mealie.deleteBackup(backup.name);
      console.log(`[backup] deleted Mealie backup: ${backup.name}`);
    }
  } else {
    console.log("[backup] no older Mealie backups to remove");
  }

  // 7. Prune old S3 backups (respects retentionDays; no-ops if disabled)
  await s3.pruneOldBackups();

  console.log(`[backup] run complete`);
}
