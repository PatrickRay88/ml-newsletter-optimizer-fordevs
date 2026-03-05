export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

const DEFAULT_DEMO_EMAIL = "patrick.d.ray.88@gmail.com";

// Placeholder session source until real auth is wired in.
export async function getSessionUser(): Promise<SessionUser | null> {
  if (process.env.DISABLE_DEMO_SESSION === "true") {
    return null;
  }

  const configuredEmail = process.env.DEMO_USER_EMAIL?.trim();
  const email = configuredEmail && configuredEmail.length > 0 ? configuredEmail : DEFAULT_DEMO_EMAIL;

  return {
    id: "demo-user",
    email,
    name: "Demo User"
  };
}
