/**
 * GRID seasonal points — Cloudflare Worker + D1.
 *
 *   POST /heartbeat           (Bearer entitlement JWT) → accrue points
 *   GET  /points/:address     → totals for the active (or ?season=) season
 *   GET  /leaderboard         → top holders this season
 *   GET  /season              → the active season
 *
 * Points = usage × (1 + sqrt(powerTokens)/divisor). The power multiplier is a
 * gentle sqrt curve so committed small lockers stay competitive with whales.
 * Points are NON-FINANCIAL and never convert to $GRID (see /token/policy).
 */
import {Hono} from "hono";
import {cors} from "hono/cors";
import {jwtVerify, importJWK, type JWK} from "jose";

type Bindings = {
  DB: D1Database;
  PUBLIC_JWK: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  HEARTBEAT_MIN_INTERVAL: string;
  MAX_USAGE_UNITS_PER_BEAT: string;
  POWER_MULTIPLIER_DIVISOR: string;
};

const app = new Hono<{Bindings: Bindings}>();
app.use("*", cors({origin: ["https://codegrid.app", "https://www.codegrid.app", "http://localhost:3000"]}));

interface Entitlement {
  sub: string; // address
  tier: number;
  power: string; // wei string
}

async function verifyEntitlement(c: {env: Bindings}, authHeader: string | undefined): Promise<Entitlement | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!c.env.PUBLIC_JWK) return null;
  try {
    const key = await importJWK(JSON.parse(c.env.PUBLIC_JWK) as JWK, "EdDSA");
    const {payload} = await jwtVerify(token, key, {
      issuer: c.env.JWT_ISSUER,
      audience: c.env.JWT_AUDIENCE,
      // Defense-in-depth, matching grid-review: pin the alg + require an expiry.
      algorithms: ["EdDSA"],
      requiredClaims: ["exp"],
    });
    if (!payload.sub) return null;
    return {sub: payload.sub, tier: Number(payload.tier ?? 0), power: String(payload.power ?? "0")};
  } catch {
    return null;
  }
}

async function activeSeason(db: D1Database): Promise<{id: number; name: string}> {
  const row = await db.prepare("SELECT id, name FROM seasons WHERE active = 1 ORDER BY id DESC LIMIT 1").first<{
    id: number;
    name: string;
  }>();
  if (row) return row;
  // Lazily open Season 1 if the schema seed didn't run.
  const now = Math.floor(Date.now() / 1000);
  const res = await db
    .prepare("INSERT INTO seasons (name, started_at, active) VALUES (?, ?, 1) RETURNING id, name")
    .bind("Season 1", now)
    .first<{id: number; name: string}>();
  return res!;
}

function powerMultiplier(powerWei: string, divisor: number): number {
  let tokens = 0;
  try {
    tokens = Number(BigInt(powerWei) / 10n ** 18n);
  } catch {
    tokens = 0;
  }
  return 1 + Math.sqrt(Math.max(tokens, 0)) / divisor;
}

app.post("/heartbeat", async (c) => {
  const ent = await verifyEntitlement(c, c.req.header("Authorization"));
  if (!ent) return c.json({error: "unauthorized"}, 401);

  let body: {usageUnits?: number};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const maxUsage = Number(c.env.MAX_USAGE_UNITS_PER_BEAT || "10");
  const reqUnits = Number(body.usageUnits ?? 1);
  const usage = Math.max(0, Math.min(Number.isFinite(reqUnits) ? reqUnits : 1, maxUsage));
  const now = Math.floor(Date.now() / 1000);
  const minInterval = Number(c.env.HEARTBEAT_MIN_INTERVAL || "300");
  const addr = ent.sub;

  const season = await activeSeason(c.env.DB);

  // Rate limit: ignore beats that arrive faster than the min interval.
  const last = await c.env.DB.prepare(
    "SELECT ts FROM heartbeats WHERE address = ? ORDER BY ts DESC LIMIT 1",
  )
    .bind(addr)
    .first<{ts: number}>();
  if (last && now - last.ts < minInterval) {
    const cur = await c.env.DB.prepare("SELECT points FROM points WHERE address = ? AND season_id = ?")
      .bind(addr, season.id)
      .first<{points: number}>();
    return c.json({accrued: 0, rateLimited: true, points: cur?.points ?? 0, season: season.name});
  }

  const mult = powerMultiplier(ent.power, Number(c.env.POWER_MULTIPLIER_DIVISOR || "50"));
  const awarded = usage * mult;

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO heartbeats (address, season_id, ts, usage_units, power, awarded) VALUES (?,?,?,?,?,?)",
    ).bind(addr, season.id, now, usage, ent.power, awarded),
    c.env.DB.prepare(
      `INSERT INTO points (address, season_id, points, usage_units, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(address, season_id) DO UPDATE SET
         points = points + excluded.points,
         usage_units = usage_units + excluded.usage_units,
         updated_at = excluded.updated_at`,
    ).bind(addr, season.id, awarded, usage, now),
  ]);

  const cur = await c.env.DB.prepare("SELECT points FROM points WHERE address = ? AND season_id = ?")
    .bind(addr, season.id)
    .first<{points: number}>();

  return c.json({accrued: awarded, multiplier: mult, points: cur?.points ?? awarded, season: season.name});
});

app.get("/points/:address", async (c) => {
  const addr = c.req.param("address");
  const season = await activeSeason(c.env.DB);
  const row = await c.env.DB.prepare(
    "SELECT points, usage_units, updated_at FROM points WHERE address = ? AND season_id = ?",
  )
    .bind(addr, season.id)
    .first<{points: number; usage_units: number; updated_at: number}>();
  // Rank: how many addresses have strictly more points.
  const rankRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS ahead FROM points WHERE season_id = ? AND points > ?",
  )
    .bind(season.id, row?.points ?? 0)
    .first<{ahead: number}>();
  return c.json({
    address: addr,
    season: season.name,
    points: row?.points ?? 0,
    usageUnits: row?.usage_units ?? 0,
    rank: row ? (rankRow?.ahead ?? 0) + 1 : null,
  });
});

app.get("/leaderboard", async (c) => {
  const season = await activeSeason(c.env.DB);
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const {results} = await c.env.DB.prepare(
    "SELECT address, points, usage_units FROM points WHERE season_id = ? ORDER BY points DESC LIMIT ?",
  )
    .bind(season.id, limit)
    .all();
  return c.json({season: season.name, leaderboard: results});
});

app.get("/season", async (c) => c.json(await activeSeason(c.env.DB)));
app.get("/health", (c) => c.json({ok: true}));

export default app;
