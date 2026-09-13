import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths } from "@neondatabase/auth-ui/server";
import { Mark } from "@/app/mark";

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
      <section className="authIntro">
        <p className="eyebrow">YOUR PRIVATE STUDY LEDGER</p>
        <h1>
          Return to
          <br />
          <em>the work.</em>
        </h1>
        <p>An hour of focus. A record of progress. Recall when it matters.</p>
      </section>
      <section className="authPanel">
        <AuthView path={path} />
      </section>
    </main>
  );
}
