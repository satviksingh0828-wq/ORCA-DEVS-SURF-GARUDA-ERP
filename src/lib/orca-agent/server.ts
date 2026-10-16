import Browserbase from "@browserbasehq/sdk";
import { Stagehand } from "@browserbasehq/stagehand";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ORCA_PUTER_MODEL, PuterLLMClient } from "@/lib/orca-agent/puter-llm";

const BROWSERBASE_TIMEOUT_SECONDS = 30 * 60;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
}

export type BrowserRuntime = {
  stagehand: Stagehand;
  browserbase: Browserbase;
  browserbaseSessionId: string;
  liveViewUrl: string;
};

export async function openBrowserRuntime(existingSessionId?: string): Promise<BrowserRuntime> {
  const apiKey = requiredEnv("BROWSERBASE_API_KEY");
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId: process.env.BROWSERBASE_PROJECT_ID?.trim() || undefined,
    browserbaseSessionID: existingSessionId,
    browserbaseSessionCreateParams: existingSessionId
      ? undefined
      : {
          keepAlive: true,
          api_timeout: BROWSERBASE_TIMEOUT_SECONDS,
          proxies: process.env.BROWSERBASE_USE_PROXY === "true",
          browserSettings: {
            recordSession: true,
            logSession: true,
            solveCaptchas: true,
            viewport: { width: 1440, height: 900 },
          },
          userMetadata: { product: "ORCA AGENT" },
        },
    keepAlive: true,
    // Puter is the only AI provider. The model name is fixed in code.
    model: { modelName: ORCA_PUTER_MODEL as never },
    llmClient: new PuterLLMClient(),
    systemPrompt:
      "You are ORCA AGENT operating a remote browser. Follow the user's instruction precisely. Never invent a successful result. Stop if the requested action would be unsafe, ambiguous, or outside the current page.",
    selfHeal: true,
    verbose: 0,
  });

  await stagehand.init();
  const browserbaseSessionId = stagehand.browserbaseSessionID;
  if (!browserbaseSessionId) {
    await stagehand.close({ force: true }).catch(() => undefined);
    throw new Error("Browserbase did not return a session ID.");
  }

  const browserbase = new Browserbase({ apiKey });
  const debug = await browserbase.sessions.debug(browserbaseSessionId, { expiresIn: 3600 });
  return {
    stagehand,
    browserbase,
    browserbaseSessionId,
    liveViewUrl: debug.debuggerFullscreenUrl,
  };
}

export async function executeBrowserInstruction(
  runtime: BrowserRuntime,
  instruction: string,
  targetUrl?: string,
) {
  const page = runtime.stagehand.context.activePage();
  if (!page) throw new Error("The Browserbase session has no active page.");

  const url = targetUrl?.trim() || instruction.match(/https?:\/\/[^\s]+/i)?.[0];
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
  }

  const action = await runtime.stagehand.act(instruction, { timeoutMs: 60_000 });
  return {
    action,
    url: page.url(),
    title: await page.title().catch(() => ""),
  };
}

export async function releaseBrowserSession(browserbaseSessionId: string) {
  const apiKey = requiredEnv("BROWSERBASE_API_KEY");
  const browserbase = new Browserbase({ apiKey });
  await browserbase.sessions.update(browserbaseSessionId, { status: "REQUEST_RELEASE" });
}

export async function writeAgentEvent(input: {
  taskId?: string;
  sessionId?: string;
  userId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const db = supabaseAdmin as any;
  const { error } = await db.from("orca_agent_events").insert({
    task_id: input.taskId ?? null,
    session_id: input.sessionId ?? null,
    user_id: input.userId,
    event_type: input.eventType,
    payload: input.payload ?? {},
  });
  if (error) console.warn("[orca-agent] Could not write event:", error.message);
}
