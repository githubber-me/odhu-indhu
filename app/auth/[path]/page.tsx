import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths } from "@neondatabase/auth-ui/server";
import { Mark } from "@/app/mark";
import { AuthIntro } from "@/app/auth/auth-intro";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(authViewPaths).map((path) => ({ path }));
}

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;
  return (
    <main className="authShell">
      <header className="authBrand">
        <Mark />
        <span>ODHU INDHU</span>
      </header>
      <AuthIntro />
      <section className="authPanel">
        <AuthView path={path} />
      </section>
    </main>
  );
}
