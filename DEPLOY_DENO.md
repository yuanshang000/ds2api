
# Deploying DS2API to Deno Deploy

This guide explains how to deploy the full DS2API application (Frontend + Backend) to Deno Deploy.

## Project Structure

The project is now configured as a Deno-first project:
- `src/`: Backend source code (TypeScript)
- `static/admin/`: Built frontend assets
- `deno.json`: Deno configuration
- `config.json`: Account configuration
- `sha3_wasm_bg.7b9ca65ddd.wasm`: PoW calculation module

## Step 1: Frontend Build (Already Done)

I have already run the build for you. The `static/admin` directory now contains the necessary files.
If you need to rebuild in the future:
```bash
cd webui
npm install
npm run build
```

## Step 2: Push to GitHub

Commit all changes, **especially the `static/admin` folder** and the new `src/` structure.
```bash
git add .
git commit -m "Refactor for Deno deployment"
git push
```

## Step 3: Configure Deno Deploy

1. **Create Project**: Go to Deno Deploy and create a new project linked to your repository.
2. **Entry Point**: 
   - **CRITICAL**: Go to **Settings** -> **Git Integration**.
   - Change **Entry Point** to `src/main.ts`.
   - (The previous path `deno/src/main.ts` is no longer valid).
3. **Environment Variables** (Optional if using config.json):
   - `DS2API_ADMIN_KEY`: Admin password (default: `your-admin-secret-key`)
   - `ACCOUNTS`: JSON string of accounts (overrides config.json)

## Usage

- **Home Page**: `https://<your-project>.deno.dev/` (Redirects to Admin)
- **Admin Panel**: `https://<your-project>.deno.dev/admin/`
- **API Endpoint**: `https://<your-project>.deno.dev/v1/chat/completions`
