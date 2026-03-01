import "dotenv/config";
import cron from "node-cron";
import { createMealieClient } from "./mealie.js";
import { runBackup } from "./backup.js";

function require_env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const mealieUrl = require_env("MEALIE_URL");
const mealieApiKey = require_env("MEALIE_API_KEY");
const s3Bucket = require_env("S3_BUCKET");
const awsRegion = process.env["AWS_REGION"] ?? "us-east-1";
const s3Prefix = process.env["S3_PREFIX"] ?? "mealie-backups/";
const cronSchedule = process.env["CRON_SCHEDULE"] ?? "0 2 * * 0";
const runOnStart = process.env["RUN_ON_START"] === "true";
const startupTimeoutSecs = parseInt(process.env["STARTUP_TIMEOUT"] ?? "180", 10);
const s3RetentionDays = parseInt(process.env["S3_RETENTION_DAYS"] ?? "90", 10);

const mealie = createMealieClient(mealieUrl, mealieApiKey);
const s3Config = { region: awsRegion, bucket: s3Bucket, prefix: s3Prefix, retentionDays: s3RetentionDays };

async function waitForMealie(timeoutSecs: number): Promise<void> {
  const url = `${mealieUrl}/api/app/about`;
  const deadline = Date.now() + timeoutSecs * 1000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        console.log(`[startup] Mealie is up (attempt ${attempt})`);
        return;
      }
    } catch {
      // connection refused, timeout, etc. — keep waiting
    }

    const remaining = Math.round((deadline - Date.now()) / 1000);
    console.log(`[startup] Mealie not ready yet, retrying... (${remaining}s remaining)`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`[startup] Mealie did not become ready within ${timeoutSecs}s`);
}

async function run() {
  try {
    await runBackup(mealie, s3Config);
  } catch (err) {
    console.error("[backup] run failed:", err);
  }
}

console.log(`[scheduler] cron schedule: ${cronSchedule}`);
cron.schedule(cronSchedule, run);

if (runOnStart) {
  console.log(`[startup] RUN_ON_START=true, waiting up to ${startupTimeoutSecs}s for Mealie...`);
  waitForMealie(startupTimeoutSecs).then(run).catch((err) => {
    console.error(err.message);
  });
}
