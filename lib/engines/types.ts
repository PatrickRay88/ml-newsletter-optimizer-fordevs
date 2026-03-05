export type EmailEngineProvider = "resend";

export type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
  from?: string;
  tags?: Record<string, string>;
};

export type EmailSendResult = {
  provider: EmailEngineProvider;
  messageId: string;
};

export type EngineConnectionTestResult = {
  provider: EmailEngineProvider;
  success: boolean;
  status: number;
  message: string;
  accountName?: string;
  accountId?: string;
};

export type RetrieveEmailStatusResult = {
  provider: EmailEngineProvider;
  success: boolean;
  status: number;
  message: string;
  lastEvent?: string;
};
