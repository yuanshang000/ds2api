
# Deploying DS2API to Deno Deploy (Full Stack)

This guide explains how to deploy the full DS2API application (Frontend + Backend) to Deno Deploy.

## Prerequisites

1. A [Deno Deploy](https://deno.com/deploy) account.
2. A GitHub repository with this code.
3. Node.js (for building the frontend locally).

## Step 1: Build the Frontend

Since Deno Deploy doesn't run `npm build`, you must build the frontend locally and commit the static files.

1. Open a terminal in the `webui` directory:
   ```bash
   cd webui
   npm install
   npm run build
   ```
2. This will generate the frontend files in `static/admin`.
3. Commit these files to your repository:
   ```bash
   git add ../static/admin
   git commit -m "Build frontend for deployment"
   git push
   ```

## Step 2: Configure Deno Deploy

1. **Create Project**: Go to Deno Deploy and create a new project linked to your repository.
2. **Entry Point**: Set to `deno/src/main.ts`.
3. **Environment Variables**:
   - `ACCOUNTS`: JSON string of your DeepSeek accounts.
   - `DS2API_ADMIN_KEY`: Password for the Admin Panel (Default: `your-admin-secret-key`).
   - `DS2API_JWT_SECRET`: Secret for JWT tokens (Optional, defaults to ADMIN_KEY).

## Step 3: Usage

- **Admin Panel**: `https://<your-project>.deno.dev/admin/`
- **API Endpoint**: `https://<your-project>.deno.dev/v1/chat/completions`

## Notes

- **Persistence**: Configuration changes made in the Admin Panel (like adding accounts) are currently **in-memory only** or require Deno KV (not fully implemented for persistence yet). It is recommended to manage accounts via the `ACCOUNTS` environment variable for now.
