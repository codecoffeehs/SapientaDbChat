import { Link, Outlet } from "@tanstack/react-router";
import { ComputerIcon, ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Brand } from "@/components/layout/brand";
import { ThemeSwitch } from "@/components/layout/theme-switch";

export function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-20 shrink-0 items-center justify-between gap-4 px-6 sm:px-10">
        <Brand />
        <div className="flex items-center gap-5">
          <Link to="/workspaces" className="hidden items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:flex">
            Workspaces <HugeiconsIcon icon={ArrowRight02Icon} size={15} aria-hidden="true" />
          </Link>
          <ThemeSwitch />
        </div>
      </header>
      <main className="flex flex-1 flex-col"><Outlet /></main>
      <footer className="mx-6 flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-t py-4 text-[11px] text-muted-foreground sm:mx-10">
        <span className="flex items-center gap-1.5"><HugeiconsIcon icon={ComputerIcon} size={14} aria-hidden="true" />Local by design. Yours to explore.</span>
        <span>Your data, closer.</span>
      </footer>
    </div>
  );
}
