/**
 * Local Passport live stack helper.
 * Run: npm run dev:passport-stack
 */
import { spawn } from "child_process";
import {
  createPassportDevStackPlan,
  normalizeLocalBaseUrl,
  type PassportDevPortStatus,
} from "../src/lib/release/passport-dev-stack";

const BASE_URL = normalizeLocalBaseUrl("http://localhost:3000");
const HEALTH_URL = `${BASE_URL}/api/health`;
const HEALTH_TIMEOUT_MS = 2_000;
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * Returns the platform-specific executable name for npm/npx.
 */
function commandName(command: "npm" | "npx"): string {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

/**
 * Runs a child command and streams output directly to the operator.
 */
function runCommand(command: "npm" | "npx", args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName(command), args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

/**
 * Probes Passport health with a short timeout.
 */
async function probeHealth(): Promise<"healthy" | "unhealthy" | "refused"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(HEALTH_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return response.ok &&
      typeof body === "object" &&
      body !== null &&
      (body as Record<string, unknown>).status === "ok"
      ? "healthy"
      : "unhealthy";
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") {
      return "refused";
    }
    return "unhealthy";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Classifies port 3000 before starting Next.
 */
async function getPortStatus(): Promise<PassportDevPortStatus> {
  const health = await probeHealth();
  if (health === "healthy") {
    return "healthy";
  }
  return health === "refused" ? "free" : "occupied-unhealthy";
}

/**
 * Waits until the spawned dev server reports healthy.
 */
async function waitForHealthy(childExit: Promise<number | null>): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    const exited = await Promise.race([
      childExit.then((code) => ({ exited: true, code })),
      new Promise<{ exited: false }>((resolve) =>
        setTimeout(() => resolve({ exited: false }), POLL_INTERVAL_MS)
      ),
    ]);

    if (exited.exited) {
      throw new Error(
        `Next dev server exited before health was ready (${exited.code})`
      );
    }

    if ((await probeHealth()) === "healthy") {
      console.log(`Passport dev server healthy on ${BASE_URL}`);
      console.log(
        "Run Passport smoke: BASE_URL=http://localhost:3000 npm run smoke:agent-enrollment"
      );
      console.log(
        "External agents: set PASSPORT_BASE_URL=http://localhost:3000"
      );
      return;
    }
  }

  throw new Error(
    `Timed out waiting for ${HEALTH_URL}. Check the Next dev output above.`
  );
}

/**
 * Starts Next dev on port 3000 and keeps it attached to this process.
 */
async function startNextDev(): Promise<void> {
  const child = spawn(commandName("npx"), ["next", "dev", "-p", "3000"], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_PUBLIC_APP_URL: BASE_URL },
    stdio: "inherit",
  });

  const childExit = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });

  await waitForHealthy(childExit);
  const exitCode = await childExit;
  process.exit(exitCode ?? 0);
}

/**
 * Runs the local stack preflight and server startup sequence.
 */
async function main(): Promise<void> {
  const portStatus = await getPortStatus();
  const plan = createPassportDevStackPlan({ portStatus, baseUrl: BASE_URL });
  console.log(plan.message);

  if (plan.action !== "start") {
    process.exit(plan.exitCode);
  }

  await runCommand("npm", ["run", "check:env"]);
  await runCommand("npm", ["run", "doctor:passport"]);
  await runCommand("npx", ["prisma", "migrate", "deploy"]);
  await runCommand("npm", ["run", "db:preflight"]);
  await startNextDev();
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Passport dev stack failed."
  );
  console.error(
    "If this is a database preflight failure, confirm DATABASE_URL is reachable, " +
      "then retry npm run dev:passport-stack."
  );
  process.exit(1);
});
