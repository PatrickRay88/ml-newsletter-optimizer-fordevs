import { getResendApiKey, updateResendValidationTimestamp } from "./settings";

const RESEND_API_BASE_URL = "https://api.resend.com";
const RESEND_TEST_ENDPOINT = "/accounts";
const RESEND_EMAILS_ENDPOINT = "/emails";
const DEFAULT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "demo@resend.dev";

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

  try {
    const response = await fetch(`${RESEND_API_BASE_URL}${RESEND_EMAILS_ENDPOINT}`, {
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
      throw new ResendError(message, response.status, body);
    }

    const id = body && typeof body === "object" && typeof body.id === "string" ? body.id : null;

    if (!id) {
      throw new ResendError("Resend response missing message id", response.status, body);
    }

    return { id };
  } catch (error) {
    if (error instanceof ResendError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Failed to send email via Resend";
    throw new ResendError(message, 0);
  }
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
