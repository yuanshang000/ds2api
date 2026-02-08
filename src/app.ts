
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/deno";
import { logger } from "./config.ts";
import openaiRoute from "./routes/openai.ts";
import adminRoute from "./routes/admin.ts";

const app = new Hono();

app.use("*", cors());

// Mount API routes
app.route("/", openaiRoute);
app.route("/admin", adminRoute);

// Serve Static Files (Frontend)

// 1. Redirect /admin to /admin/ so relative paths in index.html work
app.get("/admin", (c) => c.redirect("/admin/"));

// 2. Explicitly serve index.html for the root
app.get("/admin/", serveStatic({ path: "./static/admin/index.html" }));

// 3. Serve other static files
// We need to rewrite the path because Hono doesn't automatically strip the prefix in serveStatic
app.use("/admin/*", serveStatic({
  root: "./static/admin",
  rewriteRequestPath: (path) => path.replace(/^\/admin/, ""),
}));

// 4. Fallback for SPA (Single Page Application)
// If a file isn't found in /admin/* (e.g. /admin/login), serve index.html
// Note: This must come AFTER the static file serving above
app.get("/admin/*", async (c, next) => {
    // Try to serve index.html explicitly
    return await serveStatic({ path: "./static/admin/index.html" })(c, next);
});

// Root welcome page (if index.html exists in static/admin, maybe serve that or a simple welcome)
// The Python app has a welcome page at /
app.get("/", (c) => {
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DS2API - Deno</title>
    <style>
        body { font-family: sans-serif; background: #111; color: #eee; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        h1 { background: linear-gradient(to right, #f59e0b, #ef4444); -webkit-background-clip: text; color: transparent; font-size: 3rem; }
        a { color: #f59e0b; text-decoration: none; border: 1px solid #f59e0b; padding: 10px 20px; border-radius: 5px; transition: all 0.3s; }
        a:hover { background: #f59e0b; color: #111; }
    </style>
</head>
<body>
    <h1>DS2API Deno</h1>
    <p>DeepSeek to OpenAI API Bridge</p>
    <br>
    <a href="/admin/">Go to Admin Panel</a>
</body>
</html>`);
});

// Debug route to check file structure
import { walk } from "std/fs/walk.ts";
app.get("/debug/files", async (c) => {
    const files = [];
    try {
        for await (const entry of walk(".", { maxDepth: 4 })) {
            files.push(entry.path);
        }
    } catch (e) {
        files.push(`Error: ${e}`);
    }
    return c.json({ files });
});

app.onError((err, c) => {
  logger.error(`${err}`);
  return c.json({ error: { message: err.message, type: "api_error" } }, 500);
});

export default app;
