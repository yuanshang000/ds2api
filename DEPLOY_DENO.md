
# Deploying DS2API to Deno Deploy

This guide explains how to deploy the ported Deno version of DS2API to Deno Deploy.

## Prerequisites

1. A [Deno Deploy](https://deno.com/deploy) account.
2. A GitHub repository with this code.

## Steps

1. **Push code to GitHub**: Ensure the `deno/` directory and `sha3_wasm_bg.7b9ca65ddd.wasm` are in your repository.

2. **Create Project in Deno Deploy**:
   - Go to Deno Deploy dashboard.
   - Click "New Project".
   - Select your GitHub repository.
   - Select the branch (e.g., `main`).

3. **Configure Entry Point**:
   - Set the **Entry Point** to `deno/src/main.ts`.

4. **Environment Variables**:
   - Add the following environment variables in the Deno Deploy project settings:
     - `ACCOUNTS`: JSON string of your DeepSeek accounts.
       ```json
       [{"email": "your_email", "password": "your_password"}]
       ```
     - `AUTH_KEYS` (Optional): JSON array or comma-separated list of API keys you want to use to protect your API.
       ```json
       ["sk-mysecretkey"]
       ```
       If you provide one of these keys in the `Authorization: Bearer` header, the server will use the internal `ACCOUNTS` to make requests.
     - `DEBUG` (Optional): Set to `true` for verbose logs.

5. **Deploy**:
   - Click "Link" or "Deploy".

## Usage

Once deployed, your API will be available at `https://<your-project>.deno.dev`.

- **Chat Completions**: `POST /v1/chat/completions`
- **Models**: `GET /v1/models`

You can use it with any OpenAI-compatible client by setting the base URL to your Deno Deploy URL.

## Note on Compatibility

This Deno port uses standard `fetch` APIs. DeepSeek's bot protection (WAF) might block requests that don't look like a real browser. The Python version uses `curl_cffi` to impersonate browsers, which is more robust. If you encounter 403 errors, it means DeepSeek is blocking the Deno runtime's requests.
