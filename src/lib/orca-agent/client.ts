export type BrowserAgentResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  sessionId?: string;
  taskId?: string;
  liveViewUrl?: string | null;
  requiresApproval?: boolean;
  result?: {
    action?: unknown;
    url?: string;
    title?: string;
  };
};

export async function callBrowserAgent(input: {
  sessionToken: string;
  action?: "task" | "approve" | "start" | "stop";
  instruction?: string;
  targetUrl?: string;
  sessionId?: string;
  taskId?: string;
}): Promise<BrowserAgentResponse> {
  const response = await fetch("/api/orca/agent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.sessionToken}`,
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as BrowserAgentResponse | null;
  if (!payload) throw new Error(`ORCA browser agent returned HTTP ${response.status}.`);
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "ORCA browser agent failed.");
  return payload;
}
