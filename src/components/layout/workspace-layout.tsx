import { useAiSettings } from "@/stores/ai-settings";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { Link, Outlet, useMatch } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon, Folder01Icon, GridViewIcon,
  Settings01Icon, Search01Icon, SidebarLeft01Icon, ArrowRight02Icon,
} from "@hugeicons/core-free-icons";
import { Brand } from "@/components/layout/brand";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { appDataOptions } from "@/lib/queries";
import { useUiStore } from "@/stores/ui";
import { databases } from "@/lib/databases";
import { DeleteWorkspaceButton } from "@/components/workspace/delete-workspace-button";

function WorkspaceSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data, isPending, error } = useQuery(appDataOptions);
  const workspaces = data?.workspaces ?? [];
  const { sidebarSearch: search, setUi } = useUiStore(useShallow(
    ({ sidebarSearch, setUi }) => ({ sidebarSearch, setUi }),
  ));
  const setSettingsOpen = useAiSettings((state) => state.setOpen);
  const filtered = workspaces.filter((workspace) => workspace.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-18 shrink-0 items-center px-5"><Brand /></div>
      <div className="px-3">
        <Link to="/connect" onClick={onNavigate} className="flex h-10 items-center gap-2.5 rounded-lg border bg-background px-3 text-xs font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
          <HugeiconsIcon icon={Add01Icon} size={17} aria-hidden="true" />New database
        </Link>
        <Link to="/workspaces" activeOptions={{ exact: true }} onClick={onNavigate}
          activeProps={{ className: "bg-sidebar-accent text-foreground" }}
          className="mt-3 flex h-9 items-center gap-2.5 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
          <HugeiconsIcon icon={GridViewIcon} size={17} aria-hidden="true" />All workspaces
          <span className="ml-auto text-[10px] tabular-nums">{workspaces.length}</span>
        </Link>
      </div>
      {workspaces.length > 0 &&
        <>
          <div className="mt-7 flex items-center justify-between px-5">
            <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Your databases</span>
            <Link to="/connect" onClick={onNavigate} aria-label="Add a database" className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              <HugeiconsIcon icon={Add01Icon} size={15} aria-hidden="true" />
            </Link>
          </div>

          <div className="relative mx-3 mt-3">
            <HugeiconsIcon icon={Search01Icon} size={14} className="pointer-events-none absolute top-2.5 left-3 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(event) => setUi({ sidebarSearch: event.target.value })} aria-label="Filter sidebar databases"
              placeholder="Find a database…" className="h-9 border-transparent bg-muted/50 pl-8 text-xs md:text-xs" />
          </div>
        </>}
      <nav aria-label="Database workspaces" className="mt-2 flex-1 space-y-1 overflow-y-auto px-3 pb-5">
        {isPending ? <p className="px-3 py-5 text-xs text-muted-foreground" role="status">Loading workspaces…</p>
          : error && !data ? <p className="px-3 py-5 text-xs leading-5 text-destructive">Workspaces couldn’t be loaded.</p>
            : filtered.length === 0 ? <p className="px-3 py-5 text-xs leading-5 text-muted-foreground">{search ? "No matching databases." : "Your saved databases will feel right at home here."}</p>
              : filtered.map((workspace) => {
                const database = databases.find((item) => item.id === workspace.provider);
                return (
                  <Link key={workspace.id} to="/workspaces/$workspaceId" params={{ workspaceId: workspace.id }} onClick={onNavigate}
                    activeProps={{ className: "bg-sidebar-accent text-foreground" }}
                    className="group flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
                    <HugeiconsIcon icon={database?.icon ?? Folder01Icon} size={17} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-xs">{workspace.name}</span>
                    <HugeiconsIcon icon={ArrowRight02Icon} size={12} className="shrink-0 opacity-0 group-hover:opacity-100" aria-hidden="true" />
                  </Link>
                );
              })}
      </nav>
      <Button variant="ghost" className="mx-3 mb-3 justify-start gap-2.5 text-xs text-muted-foreground" onClick={() => { onNavigate?.(); setSettingsOpen(true); }}><HugeiconsIcon icon={Settings01Icon} size={17} aria-hidden="true" />Settings</Button>
      <div className="flex items-center gap-2.5 border-t px-5 py-4">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">S</span>
        <div><p className="text-xs font-medium">Personal workspace</p><p className="mt-0.5 text-[10px] text-muted-foreground">Local edition</p></div>
      </div>
    </div>
  );
}

export function WorkspaceLayout() {
  const { data } = useQuery(appDataOptions);
  const workspaces = data?.workspaces ?? [];
  const workspaceId = useMatch({
    from: "/workspaces/$workspaceId",
    shouldThrow: false,
    select: ({ params }) => params.workspaceId,
  });
  const current = workspaces.find((workspace) => workspace.id === workspaceId);
  const { sidebarOpen, mobileOpen, setUi } = useUiStore(useShallow(
    ({ sidebarOpen, mobileOpen, setUi }) => ({ sidebarOpen, mobileOpen, setUi }),
  ));
  useEffect(() => () => setUi({ mobileOpen: false }), [setUi]);

  return (
    <div className="flex h-svh min-h-0 overflow-hidden bg-background">
      <aside id="workspace-sidebar" aria-label="Sidebar" aria-hidden={!sidebarOpen} inert={!sidebarOpen}
        data-open={sidebarOpen} className="workspace-sidebar hidden shrink-0 overflow-hidden md:block">
        <div className="workspace-sidebar-content h-full w-61 border-r"><WorkspaceSidebar /></div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="hidden text-muted-foreground md:inline-flex"
              onClick={() => setUi({ sidebarOpen: !sidebarOpen })} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={sidebarOpen} aria-controls="workspace-sidebar">
              <HugeiconsIcon icon={SidebarLeft01Icon} size={18} aria-hidden="true" />
            </Button>
            <Sheet open={mobileOpen} onOpenChange={(mobileOpen) => setUi({ mobileOpen })}>
              <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open sidebar" />}>
                <HugeiconsIcon icon={SidebarLeft01Icon} size={18} aria-hidden="true" />
              </SheetTrigger>
              <SheetContent side="left" className="w-72! gap-0 p-0">
                <SheetTitle className="sr-only">Workspaces</SheetTitle>
                <SheetDescription className="sr-only">Navigate your saved databases.</SheetDescription>
                <WorkspaceSidebar onNavigate={() => setUi({ mobileOpen: false })} />
              </SheetContent>
            </Sheet>
            <Link to="/workspaces" className="shrink-0 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Workspaces</Link>
            {current && <><span className="text-xs text-border">/</span><span className="truncate text-xs font-medium">{current.name}</span></>}
          </div>
          <div className="flex items-center gap-2">
            {current && <DeleteWorkspaceButton workspace={current} />}
            <ThemeSwitch />
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto"><Outlet /></main>
      </div>
    </div>
  );
}
