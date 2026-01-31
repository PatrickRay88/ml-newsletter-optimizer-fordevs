import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./encryption";
import type { WorkspaceModeValue } from "./workspace";

const SETTINGS_ID = 1;

export type SettingsSummary = {
  mode: WorkspaceModeValue;
  testModeEnabled: boolean;
  hasResendApiKey: boolean;
  resendLastValidatedAt: Date | null;
  webhookEnabled: boolean;
  webhookLastReceivedAt: Date | null;
  onboardingTestListCreatedAt: Date | null;
  onboardingTestBroadcastSentAt: Date | null;
};

type UpdateSettingsInput = {
  mode: WorkspaceModeValue;
  resendApiKey?: string | null;
  webhookSecret?: string | null;
  webhookEnabled?: boolean;
};

async function ensureSettingsRow() {
  const existing = await prisma.settings.findUnique({ where: { id: SETTINGS_ID } });

  if (existing) {
    return existing;
  }

  return prisma.settings.create({
    data: {
      id: SETTINGS_ID,
      mode: "TEST",
      testModeEnabled: true
    }
  });
}

export async function getSettingsSummary(): Promise<SettingsSummary> {
  const settings = await ensureSettingsRow();

  return {
    mode: settings.mode,
    testModeEnabled: settings.testModeEnabled,
    hasResendApiKey: Boolean(settings.resendApiKeyCiphertext),
    resendLastValidatedAt: settings.resendLastValidatedAt,
    webhookEnabled: settings.webhookEnabled,
    webhookLastReceivedAt: settings.webhookLastReceivedAt ?? null,
    onboardingTestListCreatedAt: settings.onboardingTestListCreatedAt ?? null,
    onboardingTestBroadcastSentAt: settings.onboardingTestBroadcastSentAt ?? null
  };
}

export async function updateSettings(input: UpdateSettingsInput): Promise<SettingsSummary> {
  const payload = await ensureSettingsRow();
  const trimmedKey = typeof input.resendApiKey === "string" ? input.resendApiKey.trim() : input.resendApiKey;

  const updateData: {
    mode: WorkspaceModeValue;
    testModeEnabled: boolean;
    resendApiKeyCiphertext?: string | null;
    resendApiKeyNonce?: string | null;
    resendApiKeyTag?: string | null;
    resendLastValidatedAt?: Date | null;
    webhookSecretCiphertext?: string | null;
    webhookSecretNonce?: string | null;
    webhookSecretTag?: string | null;
    webhookEnabled?: boolean;
  } = {
    mode: input.mode,
    testModeEnabled: input.mode === "TEST"
  };

  if (trimmedKey === null) {
    updateData.resendApiKeyCiphertext = null;
    updateData.resendApiKeyNonce = null;
    updateData.resendApiKeyTag = null;
    updateData.resendLastValidatedAt = null;
  } else if (typeof trimmedKey === "string" && trimmedKey.length > 0) {
    const encrypted = encryptSecret(trimmedKey);
    updateData.resendApiKeyCiphertext = encrypted.ciphertext;
    updateData.resendApiKeyNonce = encrypted.iv;
    updateData.resendApiKeyTag = encrypted.authTag;
    updateData.resendLastValidatedAt = null;
  }

  const trimmedWebhookSecret = typeof input.webhookSecret === "string" ? input.webhookSecret.trim() : input.webhookSecret;
  if (trimmedWebhookSecret === null) {
    updateData.webhookSecretCiphertext = null;
    updateData.webhookSecretNonce = null;
    updateData.webhookSecretTag = null;
  } else if (typeof trimmedWebhookSecret === "string" && trimmedWebhookSecret.length > 0) {
    const encrypted = encryptSecret(trimmedWebhookSecret);
    updateData.webhookSecretCiphertext = encrypted.ciphertext;
    updateData.webhookSecretNonce = encrypted.iv;
    updateData.webhookSecretTag = encrypted.authTag;
  }

  if (typeof input.webhookEnabled === "boolean") {
    updateData.webhookEnabled = input.webhookEnabled;
  }

  const updated = await prisma.settings.update({
    where: { id: payload.id },
    data: updateData
  });

  return {
    mode: updated.mode,
    testModeEnabled: updated.testModeEnabled,
    hasResendApiKey: Boolean(updated.resendApiKeyCiphertext),
    resendLastValidatedAt: updated.resendLastValidatedAt,
    webhookEnabled: updated.webhookEnabled,
    webhookLastReceivedAt: updated.webhookLastReceivedAt ?? null,
    onboardingTestListCreatedAt: updated.onboardingTestListCreatedAt ?? null,
    onboardingTestBroadcastSentAt: updated.onboardingTestBroadcastSentAt ?? null
  };
}

export async function getResendApiKey(): Promise<string | null> {
  const settings = await ensureSettingsRow();

  if (
    !settings.resendApiKeyCiphertext ||
    !settings.resendApiKeyNonce ||
    !settings.resendApiKeyTag
  ) {
    return null;
  }

  return decryptSecret({
    ciphertext: settings.resendApiKeyCiphertext,
    iv: settings.resendApiKeyNonce,
    authTag: settings.resendApiKeyTag
  });
}

export async function getWebhookSecret(): Promise<string | null> {
  const settings = await ensureSettingsRow();

  if (
    !settings.webhookSecretCiphertext ||
    !settings.webhookSecretNonce ||
    !settings.webhookSecretTag
  ) {
    return null;
  }

  return decryptSecret({
    ciphertext: settings.webhookSecretCiphertext,
    iv: settings.webhookSecretNonce,
    authTag: settings.webhookSecretTag
  });
}

export async function updateResendValidationTimestamp(timestamp: Date | null): Promise<void> {
  await ensureSettingsRow();
  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: {
      resendLastValidatedAt: timestamp
    }
  });
}

export async function updateWebhookReceipt(timestamp: Date = new Date()): Promise<void> {
  await ensureSettingsRow();
  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: {
      webhookLastReceivedAt: timestamp
    }
  });
}

export async function recordTestListCreated(timestamp: Date = new Date()): Promise<void> {
  await ensureSettingsRow();
  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: {
      onboardingTestListCreatedAt: timestamp
    }
  });
}

export async function recordTestBroadcastSent(timestamp: Date = new Date()): Promise<void> {
  await ensureSettingsRow();
  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: {
      onboardingTestBroadcastSentAt: timestamp
    }
  });
}
