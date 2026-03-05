export const WORKSPACE_MODES = ["TEST", "PRODUCTION"] as const;
export type WorkspaceModeValue = (typeof WORKSPACE_MODES)[number];

export const WORKSPACE_MODE_DISPLAY_LABELS: Record<WorkspaceModeValue, string> = {
  TEST: "Sandbox",
  PRODUCTION: "Live"
};

export function isSandboxMode(mode: WorkspaceModeValue): boolean {
  return mode === "TEST";
}

export function workspaceModeDisplayLabel(mode: WorkspaceModeValue): string {
  return WORKSPACE_MODE_DISPLAY_LABELS[mode];
}

export function isWorkspaceMode(value: unknown): value is WorkspaceModeValue {
  return typeof value === "string" && (value === "TEST" || value === "PRODUCTION");
}
