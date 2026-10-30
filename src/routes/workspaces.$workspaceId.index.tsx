import { invoke } from "@tauri-apps/api/core";
import { activeIngestionStatuses, canChatWithRun, type IngestionRun } from "@/lib/ingestion";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChatWorkspace } from "@/components/workspace/chat-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { appDataOptions, errorMessage } from "@/lib/queries";

export const Route = createFileRoute("/workspaces/$workspaceId/")({ component: WorkspaceChat });

function WorkspaceChat() {
  const { workspaceId } = Route.useParams();
  const { data, isPending, error, refetch } = useQuery(appDataOptions);
  const { data: ingestion, isPending: loadingIngestion, error: ingestionError, refetch: retryIngestion } = useQuery({
    queryKey: ["ingestion", workspaceId],
    queryFn: () => invoke<IngestionRun | null>("get_ingestion", { workspaceId }),
    staleTime: 0,
    refetchInterval: ({ state: { data } }) => data && activeIngestionStatuses.includes(data.status) ? 800 : false,
  });
  const workspaces = data?.workspaces ?? [];
  const workspace = workspaces.find((item) => item.id === workspaceId);

  if (isPending) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground" role="status">Opening workspace…</div>;
  if (error && !data) return (
    <div className="m-auto p-8 text-center" role="alert">
      <h1 className="text-xl font-medium">Couldn’t open your workspace.</h1>
      <p className="mt-3 text-sm text-muted-foreground">{errorMessage(error, "Could not load your saved workspaces.")}</p>
      <Button variant="outline" className="mt-5" onClick={() => void refetch()}>Try again</Button>
    </div>
  );
  if (!workspace) return (
    <div className="m-auto p-8 text-center">
      <h1 className="text-xl font-medium">This workspace isn’t on this device.</h1>
      <p className="mt-3 text-sm text-muted-foreground">Choose one of your saved databases to continue.</p>
      <Link to="/workspaces" className={buttonVariants({ variant: "outline", className: "mt-5" })}>All workspaces</Link>
    </div>
  );

  if (loadingIngestion) return <p role="status" className="m-auto p-8 text-sm text-muted-foreground">Checking database context…</p>;
  if (ingestionError) return <div role="alert" className="m-auto p-8 text-center"><p className="text-sm">{errorMessage(ingestionError, "Could not check ingestion.")}</p><Button className="mt-4" variant="outline" onClick={() => void retryIngestion()}>Retry</Button></div>;
  if (!canChatWithRun(ingestion)) return <div className="page-enter m-auto w-full max-w-xl px-8 py-16 text-center">
    <p className="mb-3 text-xs text-muted-foreground">{workspace.name} · One step before conversation</p>
    <h1 className="text-3xl font-medium tracking-tight">Let’s understand your database.</h1>
    <p className="mt-4 text-sm leading-7 text-muted-foreground">Ingest your schema to build the context for this workspace. We’ll show which tables contain data, skip empty ones, and save your catalog where you choose.</p>
    <Link to="/workspaces/$workspaceId/ingestion" params={{ workspaceId }} className={buttonVariants({ className: "mt-7" })}>{ingestion ? "View ingestion" : "Prepare my database"}</Link>
    <p className="mt-4 text-xs text-muted-foreground">Chat is available as soon as at least one selected table has a completed description and the current task has stopped.</p>
  </div>;

  return (
    <>
      {error != null && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b px-6 py-3 text-xs text-muted-foreground">
          <p>Couldn’t refresh this workspace. Showing its saved details.</p>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}
      <ChatWorkspace key={workspace.id} workspace={workspace} />
    </>
  );
}
