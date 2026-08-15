import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { isAuthenticated } from "@/lib/auth";

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect("/");
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <span>
            <strong>WP Support Copilot</strong>
            <small>Private writing assistant</small>
          </span>
        </div>
        <div className="login-copy">
          <p className="eyebrow">Private access</p>
          <h1>Welcome back, Predrag.</h1>
          <p>Enter the application password to continue.</p>
        </div>
        <LoginForm />
        <p className="login-note">Protected with a secure, server-side session.</p>
      </section>
    </main>
  );
}
