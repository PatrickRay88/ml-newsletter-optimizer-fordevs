import AppSidebar from "@/app/components/app-sidebar";
import Walkthrough from "@/app/components/walkthrough";
import { getSessionUser } from "@/lib/auth";

export default async function ProductLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();

  return (
    <div className="app-shell">
      <AppSidebar userEmail={sessionUser?.email ?? "patrick.d.ray.88@gmail.com"} />
      <div className="app-content">
        <Walkthrough />
        {children}
      </div>
    </div>
  );
}
