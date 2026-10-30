import { createFileRoute, Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { ConnectionForm } from "@/components/database/connection-form";
import { databases } from "@/lib/databases";

export const Route = createFileRoute("/_onboarding/connect/$database")({ component: Connection });

function Connection() {
  const { database } = Route.useParams();
  const selectedDatabase = databases.find((item) => item.id === database);

  return (
    <section className="page-enter mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-10 sm:py-12">
      <Link to="/connect" className="mb-8 flex w-fit items-center gap-2 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <HugeiconsIcon icon={ArrowLeft02Icon} size={16} aria-hidden="true" />
        All databases
      </Link>
      {selectedDatabase ? (
        <ConnectionForm key={selectedDatabase.id} database={selectedDatabase} />
      ) : (
        <div className="py-12">
          <h1 className="text-2xl font-medium tracking-tight">That database isn’t supported yet.</h1>
          <p className="mt-3 text-sm text-muted-foreground">Choose PostgreSQL, SQL Server, or MongoDB to continue.</p>
        </div>
      )}
    </section>
  );
}
