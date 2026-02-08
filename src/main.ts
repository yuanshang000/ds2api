
import app from "./app.ts";

const port = Number(Deno.env.get("PORT")) || 8000;

console.log(`Server running on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
