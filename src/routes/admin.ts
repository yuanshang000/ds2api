
import { create, verify } from "djwt";
import { Hono } from "hono";
import { CONFIG } from "../config.ts";
import { loginDeepseekViaAccount } from "../core/deepseek.ts";
import { getAccountIdentifier } from "../core/utils.ts";

const router = new Hono();

// Secret key for JWT (should be in env, fallback to hardcoded for dev)
// In Python: os.getenv("DS2API_ADMIN_KEY", "your-admin-secret-key")
// We use the same env var for consistency
const ADMIN_KEY = Deno.env.get("DS2API_ADMIN_KEY") || "sk-123456";
const JWT_SECRET = Deno.env.get("DS2API_JWT_SECRET") || ADMIN_KEY;

async function getJwtKey() {
    return await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(JWT_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );
}

// Middleware to verify admin token
async function verifyAdmin(c: any, next: any) {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "").trim();
    try {
        const key = await getJwtKey();
        const payload = await verify(token, key);
        if (payload.role !== "admin") throw new Error("Invalid role");
        await next();
    } catch (e) {
        return c.json({ error: "Invalid token" }, 401);
    }
}

// --- Auth Routes ---

router.post("/login", async (c) => {
    let body;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON" }, 400);
    }

    // Support both "password" (WebUI) and direct key check
    const password = body.password || "";
    
    if (password !== ADMIN_KEY) {
        return c.json({ error: "Invalid password" }, 401);
    }

    const key = await getJwtKey();
    const jwt = await create(
        { alg: "HS256", typ: "JWT" },
        { role: "admin", exp: Math.floor(Date.now() / 1000) + 24 * 3600 }, // 24 hours
        key
    );

    return c.json({ 
        access_token: jwt, 
        token_type: "bearer",
        expires_in: 24 * 3600
    });
});

// --- Config Routes ---

router.get("/config", verifyAdmin, (c) => {
    // Return config with sensitive data masked
    const safeConfig = {
        keys: CONFIG.keys || [],
        accounts: (CONFIG.accounts || []).map(acc => ({
            email: acc.email || "",
            mobile: acc.mobile || "",
            has_password: !!acc.password,
            has_token: !!acc.token,
            token_preview: acc.token ? acc.token.substring(0, 20) + "..." : ""
        })),
        claude_mapping: {} // Not implemented in Deno yet
    };
    return c.json(safeConfig);
});

router.post("/config", verifyAdmin, async (c) => {
    const data = await c.req.json();
    
    if (data.keys) {
        CONFIG.keys = data.keys;
    }

    if (data.accounts) {
        const existingMap = new Map();
        CONFIG.accounts.forEach(a => existingMap.set(getAccountIdentifier(a), a));

        CONFIG.accounts = data.accounts.map((newAcc: any) => {
            const id = getAccountIdentifier(newAcc);
            const oldAcc = existingMap.get(id);
            // Preserve password/token if not provided
            if (!newAcc.password && oldAcc) newAcc.password = oldAcc.password;
            if (!newAcc.token && oldAcc) newAcc.token = oldAcc.token;
            return newAcc;
        });
    }

    // TODO: Save to Deno KV for persistence
    // For now, we update in-memory CONFIG which persists as long as the isolate lives
    // We should implement Deno KV saving in config.ts

    return c.json({ success: true, message: "Configuration updated (Memory only for now)" });
});

// --- Account Routes ---

router.post("/accounts/test", verifyAdmin, async (c) => {
    const body = await c.req.json();
    const account = body.account;
    const model = body.model || "deepseek-chat";

    if (!account) return c.json({ error: "Missing account" }, 400);

    const result = {
        account: getAccountIdentifier(account),
        success: false,
        message: "",
        data: {} as any
    };

    try {
        // Try login to verify credentials
        // In the Python version, it also tries to create a session
        // Here we'll just try login for simplicity first
        if (!account.token) {
             const token = await loginDeepseekViaAccount(account);
             account.token = token;
        }
        
        // Simple verification: can we get a token?
        if (account.token) {
            result.success = true;
            result.message = "Login successful, token obtained";
            result.data = { token_preview: account.token.substring(0, 10) + "..." };
        } else {
             result.message = "Login failed to return token";
        }

    } catch (e) {
        result.message = `Error: ${e}`;
    }

    return c.json(result);
});

// --- Vercel Routes (Stub) ---
router.get("/vercel/config", verifyAdmin, (c) => {
    return c.json({
        has_token: false,
        project_id: "",
        team_id: null
    });
});

export default router;
