import type {
  EmailBatchSendInput,
  EmailBatchSendResult,
  EmailSendInput,
  EmailSendResult,
  EngineConnectionTestResult,
  RetrieveEmailStatusResult
} from "./types";
import { resendEngineAdapter } from "./resend-adapter";

export type EmailEngineAdapter = {
  provider: "resend";
  sendEmail(input: EmailSendInput): Promise<EmailSendResult>;
  sendEmailBatch?(input: EmailBatchSendInput): Promise<EmailBatchSendResult>;
  testConnection(): Promise<EngineConnectionTestResult>;
  retrieveEmailStatus(messageId: string): Promise<RetrieveEmailStatusResult>;
};

let adapterOverride: EmailEngineAdapter | null = null;

export function setEmailEngineAdapterForTests(adapter: EmailEngineAdapter) {
  adapterOverride = adapter;
}

export function resetEmailEngineAdapterForTests() {
  adapterOverride = null;
}

export function resolveEmailEngineAdapter(): EmailEngineAdapter {
  if (adapterOverride) {
    return adapterOverride;
  }

  // Provider selection is intentionally centralized for future multi-provider support.
  return resendEngineAdapter;
}
