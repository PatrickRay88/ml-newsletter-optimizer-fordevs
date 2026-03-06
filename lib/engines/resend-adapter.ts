import {
  retrieveResendEmailStatus,
  sendResendEmailBatch,
  sendResendEmail,
  testResendConnection
} from "../resend";
import type { EmailEngineAdapter } from "./adapter";

export const resendEngineAdapter: EmailEngineAdapter = {
  provider: "resend",
  async sendEmail(input) {
    const result = await sendResendEmail(input);
    return {
      provider: "resend",
      messageId: result.id
    };
  },
  async sendEmailBatch(input) {
    const result = await sendResendEmailBatch({ messages: input.messages });
    return {
      provider: "resend",
      messageIds: result.ids
    };
  },
  async testConnection() {
    const result = await testResendConnection();
    return {
      provider: "resend",
      ...result
    };
  },
  async retrieveEmailStatus(messageId: string) {
    const result = await retrieveResendEmailStatus(messageId);
    return {
      provider: "resend",
      ...result
    };
  }
};
