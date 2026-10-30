import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { appDataOptions, errorMessage } from "@/lib/queries";
import type { Workspace } from "@/lib/workspaces";

export function DeleteWorkspaceButton({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isDeleting = useIsMutating({ mutationKey: ["delete-workspace"] }) > 0;
  const { mutate: deleteWorkspace, isPending } = useMutation({
    mutationKey: ["delete-workspace"],
    mutationFn: async (id: string) => {
      if (!isTauri()) throw new Error("Open the desktop app to delete a saved workspace.");
      return invoke<boolean>("delete_workspace", { id });
    },
    onSuccess: async (deleted, id) => {
      if (!deleted) return;
      await queryClient.cancelQueries(appDataOptions);
      queryClient.setQueryData(appDataOptions.queryKey, (data) => data && ({
        ...data, workspaces: data.workspaces.filter((item) => item.id !== id),
      }));
      if (router.state.location.pathname === `/workspaces/${id}`) {
        await router.navigate({ to: "/workspaces", replace: true });
      }
      toast.add({ title: "Workspace deleted", description: "The saved connection was removed from this device.", type: "success" });
      await queryClient.invalidateQueries(appDataOptions);
    },
    onError: (error) => toast.add({ title: "Couldn’t delete workspace", description: errorMessage(error, "Please try again."), type: "error" }),
  });

  return (
    <Button variant="ghost" size="icon-sm" disabled={isDeleting}
      aria-label={`Delete workspace ${workspace.name}`} title="Delete workspace"
      aria-busy={isPending}
      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      onClick={() => {
        if (!queryClient.isMutating({ mutationKey: ["delete-workspace"] })) deleteWorkspace(workspace.id);
      }}>
      <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
    </Button>
  );
}
