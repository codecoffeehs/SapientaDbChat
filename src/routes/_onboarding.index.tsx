import { useShallow } from "zustand/react/shallow";
import { useUiStore } from "@/stores/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon, ArrowRight02Icon, ArrowUp02Icon, ComputerIcon,
  Folder01Icon, GridViewIcon, Message01Icon, CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { buttonVariants } from "@/components/ui/button";
import { databases } from "@/lib/databases";
import { useQuery } from "@tanstack/react-query";
import { appDataOptions } from "@/lib/queries";

const previewQuestions = ["What’s in my database?", "How does it all connect?", "Where should I look next?"];

export const Route = createFileRoute("/_onboarding/")({ component: Welcome });

function Welcome() {
  const { data } = useQuery(appDataOptions);
  const workspaces = data?.workspaces ?? [];
  const { previewDatabase: selected, previewQuestion: question, setUi } = useUiStore(useShallow(
    ({ previewDatabase, previewQuestion, setUi }) => ({ previewDatabase, previewQuestion, setUi }),
  ));
  const database = databases[selected];

  return (
    <section className="page-enter mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:py-14">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
        <div>
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            <HugeiconsIcon icon={ComputerIcon} size={13} aria-hidden="true" />A personal workspace for your data
          </span>
          <h1 className="text-[clamp(2.8rem,5vw,4.2rem)] leading-[1.08] font-medium tracking-[-0.065em]">
            Big questions.<br /><span className="text-muted-foreground">Meet your data.</span>
          </h1>
          <p className="mt-6 max-w-90 text-sm leading-7 text-muted-foreground">A calmer place to work with your databases. Bring your connections together, and make room for a little curiosity.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to={workspaces.length ? "/workspaces" : "/connect"} className={buttonVariants({ className: "h-11 gap-5 rounded-xl px-5" })}>
              {workspaces.length ? "Open workspaces" : "Get started"}
              <HugeiconsIcon icon={ArrowRight02Icon} size={18} aria-hidden="true" />
            </Link>
            <Link to={workspaces.length ? "/connect" : "/workspaces"} className={buttonVariants({ variant: "ghost", className: "h-11 px-3 text-muted-foreground" })}>
              {workspaces.length ? "Add a database" : "View workspaces"}
            </Link>
          </div>
          <p className="mt-4 text-[11px] text-muted-foreground">No account. Just you and your next idea.</p>

          <div className="mt-9 flex flex-wrap gap-2" role="group" aria-label="Preview a database workspace">
            {databases.map((item, index) => (
              <button key={item.id} type="button" onClick={() => setUi({ previewDatabase: index })} aria-pressed={selected === index}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-ring ${selected === index ? "border-foreground/20 bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/60"}`}>
                <HugeiconsIcon icon={item.icon} size={15} aria-hidden="true" />{item.name}
              </button>
            ))}
          </div>
        </div>

        <div className="relative isolate min-w-0">
          <div className="welcome-grid pointer-events-none absolute -inset-8 -z-10" aria-hidden="true" />
          <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_18px_70px_-32px_var(--ring)]">
            <div className="grain-gradient flex h-10 items-center justify-between border-b bg-muted/20 px-4">
              <span className="text-[10px] font-medium text-muted-foreground">Your workspace, previewed</span>
              <div className="flex gap-1" aria-hidden="true"><span className="size-1.5 rounded-full bg-border" /><span className="size-1.5 rounded-full bg-border" /><span className="size-1.5 rounded-full bg-border" /></div>
            </div>
            <div className="flex min-h-80">
              <div className="hidden w-27 shrink-0 flex-col gap-4 border-r bg-sidebar px-3 py-5 min-[450px]:flex">
                <span className="text-xs font-semibold tracking-tight">sapienta<span className="text-primary">.</span></span>
                <span className="mt-1 flex items-center gap-1.5 text-[8px] text-muted-foreground"><HugeiconsIcon icon={GridViewIcon} size={12} aria-hidden="true" />Workspaces</span>
                <span className="mt-3 text-[7px] tracking-wider text-muted-foreground uppercase">Databases</span>
                {databases.map((item, index) => (
                  <button key={item.id} type="button" onClick={() => setUi({ previewDatabase: index })} aria-label={`Preview ${item.name}`} aria-pressed={selected === index}
                    className={`-mx-1 flex items-center gap-1.5 rounded-md px-1.5 py-2 text-left text-[8px] transition-colors focus-visible:outline-2 focus-visible:outline-ring ${selected === index ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/50"}`}>
                    <HugeiconsIcon icon={item.icon} size={12} className="shrink-0" aria-hidden="true" />{item.name}
                  </button>
                ))}
                <span className="mt-auto flex items-center gap-1.5 text-[8px] text-muted-foreground"><HugeiconsIcon icon={ComputerIcon} size={12} aria-hidden="true" />Just for you</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center p-5 sm:p-6">
                <span key={database.id} className={`page-enter mb-4 flex size-10 items-center justify-center rounded-xl ${database.color}`}>
                  <HugeiconsIcon icon={database.icon} size={23} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <p className="text-base font-medium tracking-tight">A place for your next question.</p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">Start with {database.name}. Follow your curiosity.</p>
                <div className="mt-5 rounded-xl border bg-background p-3.5 shadow-xs">
                  <p className="min-h-10 text-[11px] leading-5" aria-live="polite">{previewQuestions[question]}</p>
                  <div className="mt-3 flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5 text-[8px]"><HugeiconsIcon icon={database.icon} size={11} aria-hidden="true" />{database.name}</span>
                    <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-muted"><HugeiconsIcon icon={ArrowUp02Icon} size={12} /></span>
                  </div>
                </div>
                <div className="mt-3 flex gap-1.5" role="group" aria-label="Preview questions">
                  {previewQuestions.map((text, index) => <button key={text} type="button" aria-label={text} aria-pressed={question === index} onClick={() => setUi({ previewQuestion: index })} className={`h-5 flex-1 rounded-md border text-[8px] transition-colors focus-visible:outline-2 focus-visible:outline-ring ${question === index ? "bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/60"}`}>{["Explore", "Connect", "Discover"][index]}</button>)}
                </div>
                <Link to="/connect/$database" params={{ database: database.id }} className="mt-5 flex w-fit items-center gap-1.5 rounded text-[10px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                  Connect {database.name}<HugeiconsIcon icon={ArrowRight02Icon} size={12} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} aria-hidden="true" />Connections today. Conversations next.</p>
        </div>
      </div>

      <div className="mt-12 grid gap-5 border-t pt-7 sm:grid-cols-3 lg:mt-16">
        {[
          { icon: Add01Icon, title: "Bring your database", description: "PostgreSQL, SQL Server, or MongoDB." },
          { icon: Folder01Icon, title: "Give it a home", description: "Your connections, saved on your device." },
          { icon: Message01Icon, title: "Make space for questions", description: "A new way to explore. Coming next." },
        ].map((item, index) => (
          <div key={item.title} className="flex items-start gap-3">
            <HugeiconsIcon icon={item.icon} size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div><p className="text-xs font-medium"><span className="mr-2 font-mono text-[10px] text-muted-foreground">0{index + 1}</span>{item.title}</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{item.description}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}
