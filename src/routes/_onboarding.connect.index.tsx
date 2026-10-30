import { createFileRoute, Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon, ArrowRight02Icon, LockKeyIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { databases } from "@/lib/databases";

export const Route = createFileRoute("/_onboarding/connect/")({ component: Databases });

function Databases() {
  return (
    <section className="page-enter mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-10 sm:py-16">
      <Link to="/" className="mb-10 flex w-fit items-center gap-2 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <HugeiconsIcon icon={ArrowLeft02Icon} size={16} aria-hidden="true" />
        Back to welcome
      </Link>
      <p className="mb-3 text-[11px] font-medium tracking-[0.18em] text-primary uppercase">01 / Make a connection</p>
      <h1 className="text-3xl leading-tight font-medium tracking-[-0.045em] sm:text-[38px]">Where does your data live?</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Choose a database to get started. We’ll take it from there.</p>

      <div className="mt-9 grid gap-4 sm:grid-cols-3">
        {databases.map((database) => (
          <Link
            key={database.id}
            to="/connect/$database"
            params={{ database: database.id }}
            className="group flex flex-col rounded-2xl border bg-card p-6 outline-none transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_8px_30px_-15px_var(--ring)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0"
          >
            <div className={`mb-7 flex size-12 items-center justify-center rounded-xl ${database.color}`}>
              <HugeiconsIcon icon={database.icon} size={27} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold tracking-tight">{database.name}</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">{database.label}</p>
            <p className="mt-4 flex-1 text-sm leading-6 text-muted-foreground">{database.description}</p>
            <div className="mt-7 flex items-center justify-between">
              <Badge variant="secondary" className="text-[10px] font-normal">{database.type}</Badge>
              <HugeiconsIcon icon={ArrowRight02Icon} size={18} className="text-muted-foreground transition-all group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true" />
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-7 flex items-start gap-2.5 rounded-xl border border-dashed px-4 py-3.5 text-xs leading-5 text-muted-foreground">
        <HugeiconsIcon icon={LockKeyIcon} size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>Test your connection, then save it to a workspace on this device. Your database stays unchanged.</p>
      </div>
    </section>
  );
}
