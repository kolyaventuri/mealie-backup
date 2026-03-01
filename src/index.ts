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
const s3RetentionDays = parseInt(process.env["S3_RETENTION_DAYS"] ?? "90", 10);

const mealie = createMealieClient(mealieUrl, mealieApiKey);
const s3Config = { region: awsRegion, bucket: s3Bucket, prefix: s3Prefix, retentionDays: s3RetentionDays };

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
  console.log("[scheduler] RUN_ON_START=true, running backup now...");
  run();
}
