# mealie-backup

_NOTE:_ This is entirely vibe-coded.

A Docker sidecar service that runs on a cron schedule, triggers a [Mealie](https://mealie.io) backup via its API, and uploads the resulting ZIP to AWS S3. Old backups are pruned from both Mealie and S3 automatically.

## How it works

1. Triggers `POST /api/admin/backups` on your Mealie instance
2. Downloads the resulting ZIP via the Mealie API
3. Streams it directly up to S3 (no temp files)
4. Deletes older Mealie backups, keeping only the most recent local copy as a fallback
5. Optionally prunes S3 objects older than `S3_RETENTION_DAYS`

---

## Server prerequisites

### Docker & Docker Compose

If Docker isn't installed yet:

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # lets your user run docker without sudo
newgrp docker                   # apply group change without logging out
```

Verify:

```sh
docker --version
docker compose version
```

> **Note:** Node.js does **not** need to be installed on the server — the Docker image includes everything. You only need Node locally if you want to run `npm run dev` for testing.

### Node.js (local dev only, optional)

Use [nvm](https://github.com/nvm-sh/nvm) to manage Node versions:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc   # or ~/.zshrc

nvm install 22
nvm use 22
node --version     # should print v22.x.x
```

---

## AWS setup

No AWS CLI is needed on the server — credentials are passed as environment variables directly to the container.

### 1. Create an S3 bucket

In the [AWS S3 console](https://s3.console.aws.amazon.com/s3):

- Click **Create bucket**
- Choose a name (e.g. `my-homelab-backups`) and a region close to you
- Leave **Block all public access** enabled
- Enable **Versioning** if you want extra protection (optional)
- Click **Create bucket**

### 2. Create an IAM user with minimal permissions

In the [AWS IAM console](https://us-east-1.console.aws.amazon.com/iam):

1. Go to **Users → Create user**
2. Name it something like `mealie-backup`
3. Select **Attach policies directly → Create policy**
4. Switch to the **JSON** editor and paste the policy below — replace `YOUR_BUCKET_NAME` and `YOUR_PREFIX` (use the same value as `S3_PREFIX` in your `.env`, e.g. `mealie-backups/`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowUpload",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/YOUR_PREFIX*"
    },
    {
      "Sid": "AllowList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME",
      "Condition": {
        "StringLike": {
          "s3:prefix": "YOUR_PREFIX*"
        }
      }
    },
    {
      "Sid": "AllowDelete",
      "Effect": "Allow",
      "Action": "s3:DeleteObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/YOUR_PREFIX*"
    }
  ]
}
```

5. Name the policy (e.g. `mealie-backup-policy`), click **Create policy**
6. Back in the user creation flow, attach that new policy, then click **Create user**

### 3. Generate access keys

1. Open the `mealie-backup` IAM user you just created
2. Go to **Security credentials → Access keys → Create access key**
3. Choose **Application running outside AWS**
4. Copy the **Access key ID** and **Secret access key** — you won't see the secret again

---

## Configuration

Copy the example env file and fill in your values:

```sh
cp .env.example .env
```

```sh
# .env

MEALIE_URL=http://mealie:9000        # container name on the shared Docker network
MEALIE_API_KEY=<from Mealie below>

AWS_ACCESS_KEY_ID=<from IAM step 3>
AWS_SECRET_ACCESS_KEY=<from IAM step 3>
AWS_REGION=us-east-1                 # match the region of your bucket
S3_BUCKET=my-homelab-backups
S3_PREFIX=mealie-backups/            # must match the prefix in the IAM policy

CRON_SCHEDULE=0 2 * * 0             # Sundays at 02:00 — see cron reference below
RUN_ON_START=false
S3_RETENTION_DAYS=90
```

### Get a Mealie API key

1. Log into Mealie as an admin
2. Click your avatar → **User Profile → API Tokens**
3. Click **Generate**, give it a name (e.g. `backup-service`), copy the token
4. Paste it as `MEALIE_API_KEY` in `.env`

---

## Deployment

Add the backup service to your existing Mealie `docker-compose.yml`. The only hard requirement is that both containers are on the **same Docker network** so `mealie-backup` can reach Mealie by its service name.

```yaml
services:
  mealie:
    image: ghcr.io/mealie-recipes/mealie:latest
    # ... your existing config ...
    networks:
      - mealie-net

  mealie-backup:
    build: /path/to/mealie-backup    # or image: if you publish one
    restart: unless-stopped
    env_file: /path/to/mealie-backup/.env
    networks:
      - mealie-net
    depends_on:
      - mealie

networks:
  mealie-net:
    driver: bridge
```

Then start it:

```sh
docker compose up -d mealie-backup
```

### Testing the first backup

Set `RUN_ON_START=true` in your `.env`, then:

```sh
docker compose up mealie-backup     # run in foreground to see logs
```

You should see output like:

```
[scheduler] cron schedule: 0 2 * * 0
[scheduler] RUN_ON_START=true, running backup now...
[backup] starting backup run at 2025-03-01T02:00:00.000Z
[mealie] POST /api/admin/backups
[backup] backup created
[mealie] GET /api/admin/backups
[backup] newest backup: 2025-03-01_0200.zip (2025-03-01T02:00:00)
[s3] uploading to s3://my-homelab-backups/mealie-backups/2025-03-01_020000.zip
[s3] upload complete
[backup] run complete
```

Once confirmed, set `RUN_ON_START=false` and redeploy in detached mode.

---

## Cron schedule reference

| Expression | Meaning |
|---|---|
| `0 2 * * 0` | Sundays at 02:00 (default) |
| `0 2 * * *` | Every day at 02:00 |
| `0 2 * * 1` | Mondays at 02:00 |
| `0 */12 * * *` | Every 12 hours |

Use [crontab.guru](https://crontab.guru) to build custom expressions.

---

## Environment variable reference

| Variable | Default | Required | Description |
|---|---|---|---|
| `MEALIE_URL` | — | ✓ | Base URL of your Mealie instance |
| `MEALIE_API_KEY` | — | ✓ | API token from Mealie profile |
| `AWS_ACCESS_KEY_ID` | — | ✓ | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | — | ✓ | IAM secret key |
| `AWS_REGION` | `us-east-1` | | AWS region of your bucket |
| `S3_BUCKET` | — | ✓ | S3 bucket name |
| `S3_PREFIX` | `mealie-backups/` | | Key prefix (include trailing slash) |
| `CRON_SCHEDULE` | `0 2 * * 0` | | Cron expression for backup frequency |
| `RUN_ON_START` | `false` | | Run a backup immediately on container start |
| `S3_RETENTION_DAYS` | `90` | | Auto-delete S3 backups older than N days (0 = keep forever) |
