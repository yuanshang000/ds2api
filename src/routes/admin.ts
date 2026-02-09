
import { create, verify } from "djwt";
import { Hono } from "hono";
import { CONFIG, saveConfig } from "../config.ts";
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

    // Support direct key check (admin_key from WebUI)
    const password = body.admin_key || "";
    
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
        expires_in: 24 * 3600,
        // Frontend expects these fields
        success: true,
        token: jwt, 
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

    // For now, we update in-memory CONFIG which persists as long as the isolate lives
    // We should implement Deno KV saving in config.ts
    // Use Deno KV to persist configuration
    await saveConfig();

    return c.json({ success: true, message: "Configuration updated" });
});

// --- API Keys Management ---

router.post("/keys", verifyAdmin, async (c) => {
    const data = await c.req.json();
    const key = (data.key || "").trim();
    
    if (!key) {
        return c.json({ error: "Key cannot be empty" }, 400);
    }
    
    if (CONFIG.keys.includes(key)) {
        return c.json({ error: "Key already exists" }, 400);
    }
    
    CONFIG.keys.push(key);
    
    // Persist
    await saveConfig();

    return c.json({ success: true, message: "Key added", keys: CONFIG.keys });
});

router.delete("/keys/:key", verifyAdmin, async (c) => {
    const key = c.req.param("key");
    
    if (!CONFIG.keys.includes(key)) {
        return c.json({ error: "Key not found" }, 404);
    }
    
    CONFIG.keys = CONFIG.keys.filter(k => k !== key);
    
    // Persist
    await saveConfig();

    return c.json({ success: true, message: "Key deleted", keys: CONFIG.keys });
});

// --- Account Routes ---

router.post("/accounts", verifyAdmin, async (c) => {
    const data = await c.req.json();
    const { email, password, mobile } = data;

    if (!password || (!email && !mobile)) {
        return c.json({ error: "Missing required fields" }, 400);
    }

    const newAccount = { email, password, mobile, token: "" };
    
    // Check duplicates
    const id = getAccountIdentifier(newAccount);
    if (CONFIG.accounts.some(a => getAccountIdentifier(a) === id)) {
        return c.json({ error: "Account already exists" }, 400);
    }

    CONFIG.accounts.push(newAccount);

    // Persist
    await saveConfig();

    return c.json({ success: true, message: "Account added" });
});

router.get("/accounts", verifyAdmin, (c) => {
    // Pagination (simple implementation for now)
    const page = parseInt(c.req.query("page") || "1");
    const pageSize = parseInt(c.req.query("page_size") || "10");
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const safeAccounts = (CONFIG.accounts || []).map(acc => ({
        email: acc.email || "",
        mobile: acc.mobile || "",
        has_password: !!acc.password,
        has_token: !!acc.token,
        token_preview: acc.token ? acc.token.substring(0, 20) + "..." : "",
        password: acc.password // Frontend needs this to display (even if masked)
    }));

    return c.json({
        total: safeAccounts.length,
        items: safeAccounts.slice(start, end),
        page,
        page_size: pageSize,
        total_pages: Math.ceil(safeAccounts.length / pageSize) // Frontend expects this field
    });
});

// Support DELETE /accounts/:id
router.delete("/accounts/:id", verifyAdmin, async (c) => {
    const id = decodeURIComponent(c.req.param("id")).trim();
    if (!id) return c.json({ error: "Missing id" }, 400);

    const initialLength = CONFIG.accounts.length;
    CONFIG.accounts = CONFIG.accounts.filter(a => getAccountIdentifier(a) !== id);

    if (CONFIG.accounts.length === initialLength) {
        return c.json({ error: "Account not found" }, 404);
    }

    // Persist
    await saveConfig();

    return c.json({ success: true, message: "Account deleted" });
});

router.delete("/accounts", verifyAdmin, async (c) => {
    const email = c.req.query("email");
    const mobile = c.req.query("mobile");
    const id = (email || mobile || "").trim();

    if (!id) return c.json({ error: "Missing email or mobile" }, 400);

    const initialLength = CONFIG.accounts.length;
    CONFIG.accounts = CONFIG.accounts.filter(a => getAccountIdentifier(a) !== id);

    if (CONFIG.accounts.length === initialLength) {
        return c.json({ error: "Account not found" }, 404);
    }

    // Persist
    await saveConfig();

    return c.json({ success: true, message: "Account deleted" });
});

router.get("/queue/status", verifyAdmin, (c) => {
    const total = CONFIG.accounts.length;
    // Simple logic: if token exists, it's "valid" (or at least initialized)
    const valid = CONFIG.accounts.filter(a => !!a.token).length;
    return c.json({
        total: total,
        valid: valid,
        invalid: total - valid,
        pending: 0 
    });
});

router.post("/import", verifyAdmin, async (c) => {
    const data = await c.req.json();
    let importedKeys = 0;
    let importedAccounts = 0;

    if (data.keys && Array.isArray(data.keys)) {
        for (const key of data.keys) {
            if (typeof key === "string" && key.trim() && !CONFIG.keys.includes(key)) {
                CONFIG.keys.push(key.trim());
                importedKeys++;
            }
        }
    }

    if (data.accounts && Array.isArray(data.accounts)) {
        for (const acc of data.accounts) {
            if (!acc || typeof acc !== "object") continue;
            // Basic validation
            if (!acc.password && !acc.token) continue;
            if (!acc.email && !acc.mobile) continue;

            const id = getAccountIdentifier(acc);
            if (!CONFIG.accounts.some(a => getAccountIdentifier(a) === id)) {
                CONFIG.accounts.push({ 
                    email: acc.email || "", 
                    mobile: acc.mobile || "", 
                    password: acc.password || "", 
                    token: acc.token || "" 
                });
                importedAccounts++;
            }
        }
    }

    if (importedKeys > 0 || importedAccounts > 0) {
        // Persist
        await saveConfig();
    }

    return c.json({ imported_keys: importedKeys, imported_accounts: importedAccounts });
});

router.post("/accounts/test", verifyAdmin, async (c) => {
    let body;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON" }, 400);
    }
    
    // Frontend might send "account" object OR direct fields (email, password)
    // OR "identifier" (email/mobile string) when testing existing account
    let account = body.account;
    
    // Case 1: identifier provided (from WebUI test button)
    if (body.identifier) {
        const id = body.identifier;
        account = CONFIG.accounts.find(a => getAccountIdentifier(a) === id);
        if (!account) return c.json({ error: "Account not found" }, 404);
    }
    // Case 2: Direct fields at root (email/mobile/password)
    else if (!account && (body.email || body.mobile)) {
        account = {
            email: body.email,
            mobile: body.mobile,
            password: body.password,
            token: body.token
        };
    }

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

router.post("/vercel/sync", verifyAdmin, (c) => {
    return c.json({ 
        success: false, 
        message: "Vercel Sync is not supported on Deno Deploy. Please manage environment variables in Deno Deploy settings." 
    }, 400);
});

export default router;
