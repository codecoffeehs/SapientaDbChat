import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon, ArrowRight02Icon, CheckmarkCircle02Icon,
  Loading03Icon, ComputerIcon, ViewIcon, ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { appDataOptions, errorMessage } from "@/lib/queries";
import { useConnectionDraft } from "@/stores/connection-draft";
import type { Database } from "@/lib/databases";
import type { ConnectionTest, Workspace } from "@/lib/workspaces";

export function ConnectionForm({ database }: { database: Database }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { name, connectionString, showConnectionString, setDraft, resetDraft } = useConnectionDraft();
  useEffect(() => () => resetDraft(), [resetDraft]);

  const { mutate: testConnection, data: verified, isPending: isTesting, error: testError, reset: resetTest } = useMutation({
    mutationKey: ["test-connection"],
    mutationFn: async () => {
      if (!isTauri()) throw new Error("Open the Sapienta desktop app to test and save database connections.");
      return invoke<ConnectionTest>("test_connection", {
        request: { database: database.id, connectionString: connectionString.trim() },
      });
    },
    onSuccess: () => {
      toast.add({ title: "Test connection successful", description: "You’re ready to save this database to your workspaces.", type: "success" });
    },
    onError: (error) => toast.add({ title: "Connection test failed", description: errorMessage(error, "Check your connection details and try again."), type: "error" }),
  });

  const { mutate: saveWorkspace, isPending: isSaving, error: saveError, reset: resetSave } = useMutation({
    mutationKey: ["save-workspace"],
    mutationFn: ({ name, testId }: { name: string; testId: string }) => invoke<Workspace>("save_workspace", { name, testId }),
    onSuccess: async (workspace) => {
      await queryClient.cancelQueries(appDataOptions);
      queryClient.setQueryData(appDataOptions.queryKey, (data) => ({
        theme: null, ...data, workspaces: [workspace, ...(data?.workspaces ?? []).filter((item) => item.id !== workspace.id)],
      }));
      toast.add({ title: "Database saved", description: `${workspace.name} is ready in your workspaces.`, type: "success" });
      await queryClient.invalidateQueries(appDataOptions);
    },
    onError: () => toast.add({ title: "Couldn’t save the database", description: "Your details are still here. Check the message and try again.", type: "error" }),
  });
  const busy = isTesting || isSaving;
  const error = saveError ?? testError;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className={`flex size-12 items-center justify-center rounded-2xl ${database.color}`}>
          <HugeiconsIcon icon={database.icon} size={27} strokeWidth={1.6} aria-hidden="true" />
        </span>
        <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Your next workspace</span>
      </div>
      <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-[36px]">Make room for {database.name}.</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Give it a name, check the connection, and make it yours.</p>

      <form onSubmit={(event) => {
        event.preventDefault();
        if (busy || !connectionString.trim() || queryClient.isMutating({ mutationKey: ["test-connection"] })) return;
        resetSave();
        testConnection(undefined, {
          onSuccess: (result) => setDraft({ showConnectionString: false, name: name.trim() ? name : result.databaseName.slice(0, 80) }),
        });
      }} aria-busy={busy} className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="space-y-6 p-6 sm:p-7">
          <div>
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name" value={name} maxLength={80} disabled={busy}
              onChange={(event) => { setDraft({ name: event.target.value }); resetSave(); }}
              placeholder="e.g. Product analytics" autoComplete="off"
              className="mt-3 h-11 bg-background"
              aria-describedby="workspace-name-help"
            />
            <p id="workspace-name-help" className="mt-2 text-xs text-muted-foreground">Something you’ll recognize in your sidebar.</p>
          </div>
          <div>
            <Label htmlFor="connection-string">Connection string</Label>
            <div className="relative mt-3">
              <Input
                id="connection-string" name="connection-string"
                type={showConnectionString ? "text" : "password"}
                value={connectionString}
                onChange={(event) => {
                  setDraft({ connectionString: event.target.value });
                  resetTest();
                  resetSave();
                }}
                placeholder={database.placeholder} required maxLength={16384}
                autoComplete="off" autoCapitalize="none" spellCheck={false}
                disabled={busy} aria-invalid={Boolean(error)}
                aria-describedby={error ? "connection-help connection-error" : "connection-help"}
                className="h-12 bg-background pr-12 font-mono text-xs md:text-xs"
              />
              <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 text-muted-foreground"
                onClick={() => setDraft({ showConnectionString: !showConnectionString })}
                aria-label={showConnectionString ? "Hide connection string" : "Show connection string"}
                aria-pressed={showConnectionString} disabled={busy}>
                <HugeiconsIcon icon={showConnectionString ? ViewOffSlashIcon : ViewIcon} size={17} aria-hidden="true" />
              </Button>
            </div>
            <p id="connection-help" className="mt-3 text-xs leading-5 text-muted-foreground">{database.help}</p>
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="w-fit cursor-pointer rounded py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">See an example</summary>
              <code className="mt-2 block rounded-lg bg-muted/60 p-3 leading-6 break-all select-text">{database.example}</code>
            </details>
          </div>

          {error != null && (
            <div id="connection-error" role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-xs leading-5 text-destructive">
              <HugeiconsIcon icon={AlertCircleIcon} size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>{errorMessage(error, "Check your connection details and try again.")}</p>
            </div>
          )}
          <div role="status" aria-live="polite" className={`flex items-center gap-2 text-xs ${verified ? "text-primary" : "text-muted-foreground"}`}>
            <HugeiconsIcon icon={isTesting ? Loading03Icon : verified ? CheckmarkCircle02Icon : ComputerIcon}
              size={16} className={isTesting ? "animate-spin" : ""} aria-hidden="true" />
            {isTesting ? "Checking your connection… this can take up to 20 seconds."
              : verified ? "Connection verified. You’re ready to save."
              : "Test the connection before saving your database."}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/25 p-5 sm:px-7">
          <Button type="submit" variant="outline" disabled={!connectionString.trim() || busy} className="h-10 px-4">
            {isTesting ? "Testing…" : "Test connection"}
          </Button>
          <Button type="button" onClick={() => {
            if (busy || !verified || !name.trim() || queryClient.isMutating({ mutationKey: ["save-workspace"] })) return;
            saveWorkspace({ name: name.trim(), testId: verified.testId }, {
              onSuccess: () => {
                resetDraft();
                resetTest();
                void navigate({ to: "/workspaces" });
              },
            });
          }} disabled={!verified || !name.trim() || busy} className="h-10 gap-3 px-4">
            {isSaving ? "Saving…" : "Save database"}
            <HugeiconsIcon icon={isSaving ? Loading03Icon : ArrowRight02Icon} className={isSaving ? "animate-spin" : ""} size={17} aria-hidden="true" />
          </Button>
        </div>
      </form>
      <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <HugeiconsIcon icon={ComputerIcon} size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        Saved on this device, including your connection details. No account needed.
      </p>
    </div>
  );
}
