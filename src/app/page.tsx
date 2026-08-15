import { redirect } from "next/navigation";

import { SupportCopilot } from "@/app/support-copilot";
import { isAuthenticated } from "@/lib/auth";

export default async function Home() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  return <SupportCopilot />;
}
