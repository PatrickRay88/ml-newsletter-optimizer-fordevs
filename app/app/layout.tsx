import AppSidebar from "@/app/components/app-sidebar";
import Walkthrough from "@/app/components/walkthrough";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ProductLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    redirect("/");
  }

  return (
    <div className="app-shell">
      <AppSidebar userEmail={sessionUser.email} />
      <div className="app-content">
        <Walkthrough />
        {children}
      </div>
    </div>
  );
}
