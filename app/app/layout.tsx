import AppSidebar from "@/app/components/app-sidebar";
import Walkthrough from "@/app/components/walkthrough";

export default function ProductLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <AppSidebar />
      <div className="app-content">
        <Walkthrough />
        {children}
      </div>
    </div>
  );
}
