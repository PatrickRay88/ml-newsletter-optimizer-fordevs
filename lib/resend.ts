import { getResendApiKey, updateResendValidationTimestamp } from "./settings";

const RESEND_API_BASE_URL = "https://api.resend.com";
const RESEND_TEST_ENDPOINT = "/accounts";
const RESEND_EMAILS_ENDPOINT = "/emails";
const DEFAULT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "demo@resend.dev";
const RESEND_MAX_SEND_ATTEMPTS = 5;
const RESEND_BASE_BACKOFF_MS = 600;
const RESEND_MAX_BACKOFF_MS = 15_000;
const RESEND_MIN_REQUEST_SPACING_MS = 550;

let lastSendRequestAt = 0;

export type ResendTestResult = {
  success: boolean;
  status: number;
  message: string;
  accountName?: string;
  accountId?: string;
};

type ErrorBody = {
  name?: string;
  message?: string;
  error?: string;
};

export class ResendError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ResendError";
    this.status = status;
    this.body = body;
  }
}

export type ResendSendParams = {
  to: string;
  subject: string;
  html: string;
  from?: string;
  tags?: Record<string, string>;
};

export type ResendSendResult = {
  id: string;
};

export type ResendBatchSendResult = {
  ids: string[];
};

export type ResendRetrieveResult = {
  success: boolean;
  status: number;
  message: string;
  lastEvent?: string;
};

export function mapResendErrorMessage(status: number, body: ErrorBody | null): string {
  if (body?.message) {
    return body.message;
  }

  if (body?.error) {
    return body.error;
  }

  if (status === 401) {
    return "Invalid Resend API key";
  }

  if (status === 403) {
    return "Resend API key lacks required permissions";
  }

  if (status === 404) {
    return "Resend endpoint not available";
  }

  if (status >= 500) {
    return "Resend service returned an error";
  }

  return "Unexpected response from Resend";
}

export function shouldRetryResendStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function parseRetryAfterMs(retryAfterHeader: string | null, nowMs = Date.now()): number {
  if (!retryAfterHeader) {
    return 0;
  }

  const trimmed = retryAfterHeader.trim();
  if (!trimmed) {
    return 0;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - nowMs);
  }

  return 0;
}

function computeBackoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  const exponentialBackoff = Math.min(
    RESEND_BASE_BACKOFF_MS * 2 ** Math.max(0, attempt),
    RESEND_MAX_BACKOFF_MS
  );

  return Math.max(retryAfterMs, exponentialBackoff);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForSendSlot() {
  const now = Date.now();
  const waitMs = Math.max(0, RESEND_MIN_REQUEST_SPACING_MS - (now - lastSendRequestAt));
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastSendRequestAt = Date.now();
}

async function postResendJsonWithRetry(
  apiKey: string,
  path: string,
  payload: unknown
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  let lastError: ResendError | null = null;

  for (let attempt = 0; attempt < RESEND_MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      await waitForSendSlot();

      const response = await fetch(`${RESEND_API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const contentType = response.headers.get("content-type");
      const isJson = contentType?.includes("application/json");
      const body = isJson ? ((await response.json()) as Record<string, unknown>) : null;

      if (!response.ok) {
        const message = mapResendErrorMessage(response.status, body as ErrorBody | null);
        const resendError = new ResendError(message, response.status, body);

        if (shouldRetryResendStatus(response.status) && attempt < RESEND_MAX_SEND_ATTEMPTS - 1) {
          const retryAfterHeader = response.headers.get("retry-after");
          await sleep(computeBackoffMs(attempt, retryAfterHeader));
          lastError = resendError;
          continue;
        }

        throw resendError;
      }

      return {
        status: response.status,
        body
      };
    } catch (error) {
      if (error instanceof ResendError) {
        lastError = error;
        if (shouldRetryResendStatus(error.status) && attempt < RESEND_MAX_SEND_ATTEMPTS - 1) {
          await sleep(computeBackoffMs(attempt, null));
          continue;
        }
        throw error;
      }

      const message = error instanceof Error ? error.message : "Failed to send email via Resend";
      lastError = new ResendError(message, 0);

      if (attempt < RESEND_MAX_SEND_ATTEMPTS - 1) {
        await sleep(computeBackoffMs(attempt, null));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new ResendError("Failed to send email via Resend", 0);
}

function buildTagsPayload(tags: Record<string, string> | undefined) {
  if (!tags) {
    return undefined;
  }

  return Object.entries(tags).map(([name, value]) => ({ name, value }));
}

export async function sendResendEmail(params: ResendSendParams): Promise<ResendSendResult> {
  const apiKey = await getResendApiKey();

  if (!apiKey) {
    throw new ResendError("Resend API key is not configured", 400);
  }

  const payload = {
    from: params.from ?? DEFAULT_FROM_EMAIL,
    to: [params.to],
    subject: params.subject,
    html: params.html,
    tags: buildTagsPayload(params.tags)
  };

  const { body, status } = await postResendJsonWithRetry(apiKey, RESEND_EMAILS_ENDPOINT, payload);
  const id = body && typeof body === "object" && typeof body.id === "string" ? body.id : null;

  if (!id) {
    throw new ResendError("Resend response missing message id", status, body);
  }

  return { id };
}

function extractBatchPayloadItems(body: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!body) {
    return [];
  }

  const directData = body.data;
  if (Array.isArray(directData)) {
    return directData.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  const results = body.results;
  if (Array.isArray(results)) {
    return results.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  if (Array.isArray(body)) {
    return body.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  return [];
}

export async function sendResendEmailBatch(params: { messages: ResendSendParams[] }): Promise<ResendBatchSendResult> {
  const apiKey = await getResendApiKey();

  if (!apiKey) {
    throw new ResendError("Resend API key is not configured", 400);
  }

  if (!params.messages.length) {
    return { ids: [] };
  }

  const payload = params.messages.map((message) => ({
    from: message.from ?? DEFAULT_FROM_EMAIL,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    tags: buildTagsPayload(message.tags)
  }));

  const { body, status } = await postResendJsonWithRetry(apiKey, `${RESEND_EMAILS_ENDPOINT}/batch`, payload);
  const items = extractBatchPayloadItems(body);
  const ids = items
    .map((item) => (typeof item.id === "string" ? item.id : null))
    .filter((value): value is string => Boolean(value));

  if (ids.length === 0) {
    throw new ResendError("Resend batch response missing message ids", status, body);
  }

  return { ids };
}

export async function testResendConnection(): Promise<ResendTestResult> {
  const apiKey = await getResendApiKey();

  if (!apiKey) {
    return {
      success: false,
      status: 400,
      message: "Resend API key is not configured"
    };
  }

  try {
    const response = await fetch(`${RESEND_API_BASE_URL}${RESEND_TEST_ENDPOINT}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    });

    const contentType = response.headers.get("content-type");
    const isJson = contentType?.includes("application/json");
    const body = isJson ? ((await response.json()) as Record<string, unknown>) : null;

    if (!response.ok) {
      const message = mapResendErrorMessage(response.status, body as ErrorBody | null);
      await updateResendValidationTimestamp(null);
      return {
        success: false,
        status: response.status,
        message
      };
    }

    await updateResendValidationTimestamp(new Date());

    const payload = (body && typeof body === "object" && "data" in body ? (body.data as Record<string, unknown>) : body) as
      | Record<string, unknown>
      | null;
    const accountName = payload && typeof payload.name === "string" ? payload.name : undefined;
    const accountId = payload && typeof payload.id === "string" ? payload.id : undefined;

    return {
      success: true,
      status: response.status,
      message: "Resend connection established",
      accountName,
      accountId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reach Resend";
    await updateResendValidationTimestamp(null);
    return {
      success: false,
      status: 0,
      message
    };
  }
}

function extractRetrievePayload(body: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!body) {
    return null;
  }

  if (typeof body.data === "object" && body.data !== null) {
    return body.data as Record<string, unknown>;
  }

  return body;
}

export async function retrieveResendEmailStatus(messageId: string): Promise<ResendRetrieveResult> {
  const apiKey = await getResendApiKey();

  if (!apiKey) {
    return {
      success: false,
      status: 400,
      message: "Resend API key is not configured"
    };
  }

  try {
    const response = await fetch(`${RESEND_API_BASE_URL}${RESEND_EMAILS_ENDPOINT}/${messageId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    });

    const contentType = response.headers.get("content-type");
    const isJson = contentType?.includes("application/json");
    const body = isJson ? ((await response.json()) as Record<string, unknown>) : null;

    if (!response.ok) {
      const message = mapResendErrorMessage(response.status, body as ErrorBody | null);
      return {
        success: false,
        status: response.status,
        message
      };
    }

    const payload = extractRetrievePayload(body);
    const lastEvent = payload && typeof payload.last_event === "string" ? payload.last_event : undefined;

    return {
      success: true,
      status: response.status,
      message: "Resend email status retrieved",
      lastEvent
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to retrieve email status from Resend";
    return {
      success: false,
      status: 0,
      message
    };
  }
}
