export const WORKSPACE_MODES = ["TEST", "PRODUCTION"] as const;
export type WorkspaceModeValue = (typeof WORKSPACE_MODES)[number];

export function isWorkspaceMode(value: unknown): value is WorkspaceModeValue {
  return typeof value === "string" && (value === "TEST" || value === "PRODUCTION");
}
