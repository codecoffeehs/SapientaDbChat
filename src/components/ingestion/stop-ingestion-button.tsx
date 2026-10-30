import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/queries";

export function StopIngestionButton({ workspaceId, saving = false }: { workspaceId: string; saving?: boolean }) {
  const queryClient = useQueryClient();
  const { mutate: stop, isPending, error } = useMutation({
    mutationFn: () => invoke<boolean>("stop_ingestion", { workspaceId }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["ingestion", workspaceId] }); await queryClient.invalidateQueries({ queryKey: ["active-ingestions"] }); },
  });
  return <div className="text-right"><Button variant="outline" size="sm" disabled={isPending || saving} onClick={() => stop()}>{saving ? "Finishing save…" : isPending ? "Confirm stop…" : "Stop task"}</Button>{error != null && <p role="alert" className="mt-2 max-w-sm text-[11px] text-destructive">{errorMessage(error, "Could not stop this task.")}</p>}</div>;
}
