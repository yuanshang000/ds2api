
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "./config.ts";
import openaiRoute from "./routes/openai.ts";

const app = new Hono();

app.use("*", cors());

app.get("/", (c) => c.text("DS2API Deno Service"));

app.route("/", openaiRoute);

app.onError((err, c) => {
  logger.error(`${err}`);
  return c.json({ error: { message: err.message, type: "api_error" } }, 500);
});

export default app;
