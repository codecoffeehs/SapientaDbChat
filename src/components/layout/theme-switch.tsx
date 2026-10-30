import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { appDataOptions, systemTheme } from "@/lib/queries";
import type { Theme } from "@/lib/workspaces";

export function ThemeSwitch() {
  const queryClient = useQueryClient();
  const { data, isPending: isLoading } = useQuery(appDataOptions);
  const theme = data?.theme ?? systemTheme;
  const isSaving = useIsMutating({ mutationKey: ["set-theme"] }) > 0;
  const { mutate: changeTheme } = useMutation({
    mutationKey: ["set-theme"],
    mutationFn: async (theme: Theme) => { if (isTauri()) await invoke("set_theme", { theme }); },
    onMutate: async (theme) => {
      await queryClient.cancelQueries(appDataOptions);
      const previous = queryClient.getQueryData(appDataOptions.queryKey)?.theme ?? systemTheme;
      queryClient.setQueryData(appDataOptions.queryKey, (data) => ({ workspaces: [], ...data, theme }));
      return previous;
    },
    onError: (_error, _theme, previous) => {
      queryClient.setQueryData(appDataOptions.queryKey, (data) => data && ({ ...data, theme: previous ?? systemTheme }));
      toast.add({ title: "Couldn’t save appearance", description: "Please try switching the theme again.", type: "error" });
    },
    onSettled: () => { if (isTauri()) return queryClient.invalidateQueries(appDataOptions); },
  });

  return (
    <div className="flex shrink-0 items-center gap-2.5 rounded-full border bg-background/70 px-3 py-2" title="Appearance">
      <HugeiconsIcon icon={Sun03Icon} size={15} className={theme === "light" ? "text-foreground" : "text-muted-foreground"} aria-hidden="true" />
      <Switch checked={theme === "dark"} onCheckedChange={(checked) => {
        if (!queryClient.isMutating({ mutationKey: ["set-theme"] })) changeTheme(checked ? "dark" : "light");
      }} disabled={isLoading || !data || isSaving} aria-label="Dark mode" size="sm" />
      <HugeiconsIcon icon={Moon02Icon} size={15} className={theme === "dark" ? "text-foreground" : "text-muted-foreground"} aria-hidden="true" />
    </div>
  );
}
