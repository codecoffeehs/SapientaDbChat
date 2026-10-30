import { useShallow } from "zustand/react/shallow";
import { useUiStore } from "@/stores/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon, ArrowRight02Icon, ComputerIcon, Database02Icon,
  Folder01Icon, GridViewIcon, Menu01Icon, Search01Icon,
} from "@hugeicons/core-free-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { appDataOptions, errorMessage } from "@/lib/queries";
import { databases } from "@/lib/databases";
import { DeleteWorkspaceButton } from "@/components/workspace/delete-workspace-button";

export const Route = createFileRoute("/workspaces/")({ component: Workspaces });

function Workspaces() {
  const { data, isPending, error, refetch } = useQuery(appDataOptions);
  const workspaces = data?.workspaces ?? [];
  const { workspaceSearch: search, workspaceView: view, setUi } = useUiStore(useShallow(
    ({ workspaceSearch, workspaceView, setUi }) => ({ workspaceSearch, workspaceView, setUi }),
  ));
  const filtered = workspaces.filter((workspace) =>
    `${workspace.name} ${workspace.databaseName} ${workspace.provider}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <section className="page-enter mx-auto w-full max-w-6xl px-6 py-10 lg:px-12 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">A home for your data</p>
          <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">Your workspaces<span className="text-primary">.</span></h1>
          <p className="mt-3 text-sm text-muted-foreground">Pick up where curiosity takes you.</p>
        </div>
        <Link to="/connect" className={buttonVariants({ className: "h-10 gap-2 rounded-xl px-4" })}>
          <HugeiconsIcon icon={Add01Icon} size={17} aria-hidden="true" />Add database
        </Link>
      </div>
      {workspaces.length > 0 && <div className="mt-10 flex items-center justify-between gap-3 border-b pb-5">
        <div className="relative w-full max-w-72">
          <HugeiconsIcon icon={Search01Icon} size={16} className="pointer-events-none absolute top-2.5 left-3 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Search workspaces" placeholder="Search your workspaces…" value={search}
            onChange={(event) => setUi({ workspaceSearch: event.target.value })} className="h-9 bg-muted/30 pl-9 text-xs md:text-xs" />
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-0.5" role="group" aria-label="Workspace layout">
          <Button variant={view === "grid" ? "secondary" : "ghost"} size="icon-sm" onClick={() => setUi({ workspaceView: "grid" })} aria-label="Grid view" aria-pressed={view === "grid"}>
            <HugeiconsIcon icon={GridViewIcon} size={15} aria-hidden="true" />
          </Button>
          <Button variant={view === "list" ? "secondary" : "ghost"} size="icon-sm" onClick={() => setUi({ workspaceView: "list" })} aria-label="List view" aria-pressed={view === "list"}>
            <HugeiconsIcon icon={Menu01Icon} size={15} aria-hidden="true" />
          </Button>
        </div>
      </div>}


      {error != null && data && (
        <div role="alert" className="mt-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs text-muted-foreground">
          <p>Couldn’t refresh your workspaces. Showing the last saved list.</p>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}
      {isPending ? (
        <div className="grid gap-4 py-7 sm:grid-cols-2" role="status" aria-label="Loading workspaces">
          {[0, 1].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl border bg-muted/40" />)}
        </div>
      ) : error && !data ? (
        <div className="py-16 text-center" role="alert">
          <h2 className="font-medium">Your workspaces couldn’t be loaded.</h2>
          <p className="mt-2 text-sm text-muted-foreground">{errorMessage(error, "Could not load your saved workspaces.")}</p>
          <Button variant="outline" onClick={() => void refetch()} className="mt-5">Try again</Button>
        </div>
      ) : workspaces.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed bg-muted/10 px-6 py-16 text-center mt-7">
          <span className="mb-6 flex size-16 items-center justify-center rounded-2xl border bg-background shadow-xs">
            <HugeiconsIcon icon={Folder01Icon} size={30} strokeWidth={1.3} className="text-primary" aria-hidden="true" />
          </span>
          <h2 className="text-xl font-medium tracking-tight">Good things start with a connection.</h2>
          <p className="mt-3 max-w-80 text-sm leading-6 text-muted-foreground">Add your first database and give your next big question a place to begin.</p>
          <Link to="/connect" className={buttonVariants({ className: "mt-6 h-10 gap-3 px-4" })}>
            Connect a database<HugeiconsIcon icon={ArrowRight02Icon} size={16} aria-hidden="true" />
          </Link>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {databases.map((database) => <span key={database.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><HugeiconsIcon icon={database.icon} size={14} aria-hidden="true" />{database.name}</span>)}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <h2 className="font-medium">No workspaces match “{search}”.</h2>
          <Button variant="ghost" onClick={() => setUi({ workspaceSearch: "" })} className="mt-3 text-muted-foreground">Clear search</Button>
        </div>
      ) : (
        <>
          <p className="mt-6 text-[11px] text-muted-foreground">{filtered.length} {filtered.length === 1 ? "workspace" : "workspaces"}</p>
          <div className={`mt-4 grid gap-4 ${view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1"}`}>
            {filtered.map((workspace) => {
              const database = databases.find((item) => item.id === workspace.provider);
              return (
                <article key={workspace.id} className="relative rounded-2xl border bg-card transition-colors hover:border-primary/40">
                  <Link to="/workspaces/$workspaceId" params={{ workspaceId: workspace.id }}
                    className={`group h-full rounded-2xl p-5 outline-none transition-shadow hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 ${view === "list" ? "flex items-center gap-4 pr-16" : "flex flex-col"}`}>
                    <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${database?.color ?? "bg-muted text-muted-foreground"}`}>
                      <HugeiconsIcon icon={database?.icon ?? Database02Icon} size={24} strokeWidth={1.6} aria-hidden="true" />
                    </span>
                    <div className={`min-w-0 flex-1 ${view === "grid" ? "mt-5" : ""}`}>
                      <h2 className="truncate text-sm font-medium tracking-tight">{workspace.name}</h2>
                      <p className="mt-1.5 truncate text-xs text-muted-foreground">{database?.name} <span className="px-1 opacity-40">/</span> {workspace.databaseName}</p>
                    </div>
                    <div className={`flex items-center justify-between gap-3 ${view === "grid" ? "mt-6 border-t pt-4" : ""}`}>
                      <span className={`flex items-center gap-1.5 text-[10px] text-muted-foreground ${view === "list" ? "hidden lg:flex" : ""}`}>
                        <HugeiconsIcon icon={ComputerIcon} size={13} aria-hidden="true" />Saved locally
                      </span>
                      <HugeiconsIcon icon={ArrowRight02Icon} size={17} className="text-muted-foreground transition-all group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true" />
                    </div>
                  </Link>
                  <div className={`absolute right-3 ${view === "grid" ? "top-3" : "top-1/2 -translate-y-1/2"}`}>
                    <DeleteWorkspaceButton workspace={workspace} />
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-8 flex items-center gap-2 text-[11px] leading-5 text-muted-foreground">
        <HugeiconsIcon icon={ComputerIcon} size={14} className="shrink-0" aria-hidden="true" />
        Saved on this device. Open a workspace to start drafting your next question.
      </p>
    </section>
  );
}
