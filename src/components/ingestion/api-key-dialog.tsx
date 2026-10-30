import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StoragePicker } from "@/components/ingestion/storage-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon, Folder01Icon, CloudServerIcon, Key01Icon } from "@hugeicons/core-free-icons";
import { errorMessage } from "@/lib/queries";
import { useAiSettings } from "@/stores/ai-settings";

const sections = [
  { id: "api", label: "AI access", icon: Key01Icon },
  { id: "local", label: "Download locations", icon: Folder01Icon },
  { id: "s3", label: "S3 buckets", icon: CloudServerIcon },
] as const;

export function ApiKeyDialog() {
  const queryClient = useQueryClient();
  const { open, setOpen } = useAiSettings();
  const [section, setSection] = useState<"api" | "local" | "s3">("api");
  const { data: hasKey, isPending, error, refetch } = useQuery({
    queryKey: ["ai-key"], queryFn: () => invoke<boolean>("has_ai_key"), enabled: isTauri(),
  });
  const saveKey = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const key = String(new FormData(form).get("apiKey") ?? "");
      form.reset();
      return invoke<boolean>("save_ai_key", { key });
    },
    onSuccess: (saved) => { if (saved) queryClient.setQueryData(["ai-key"], true); },
  });
  if (!isTauri()) return null;
  const needsKey = !isPending && (hasKey === false || !!error);
  const current = needsKey ? "api" : section;
  return <Dialog open={open || needsKey} onOpenChange={(next) => {
    if (!saveKey.isPending && !needsKey) { setOpen(next); if (!next) saveKey.reset(); }
  }}>
    <DialogContent showCloseButton={!needsKey && !saveKey.isPending} className="max-h-[90svh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
      <DialogHeader className="border-b px-6 py-5"><DialogTitle className="flex items-center gap-2"><HugeiconsIcon icon={Settings01Icon} size={20} />Settings</DialogTitle><DialogDescription>Manage your AI access and where your guides are saved.</DialogDescription></DialogHeader>
      <div className="flex min-h-96 flex-col overflow-hidden sm:flex-row">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b bg-muted/25 p-3 sm:w-52 sm:shrink-0 sm:flex-col sm:border-r sm:border-b-0">{sections.map((item) => <button key={item.id} type="button" aria-current={current === item.id ? "page" : undefined} disabled={saveKey.isPending || (needsKey && item.id !== "api")} onClick={() => setSection(item.id)} className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 ${current === item.id ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground hover:bg-muted"}`}><HugeiconsIcon icon={item.icon} size={17} />{item.label}</button>)}</nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-7 max-h-[65svh]">
          {current === "api" ? <div className="space-y-5"><div><h2 className="text-base font-medium">AI access</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Add an API key to connect your AI provider. This key is shared across your workspaces.</p></div>
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs"><span className={`size-1.5 rounded-full ${hasKey ? "bg-emerald-500" : "bg-amber-500"}`} />{isPending ? "Checking saved key…" : hasKey ? "API key saved" : "No API key added"}</div>
            {error != null && <div role="alert" className="text-xs text-destructive">{errorMessage(error, "Secure storage is unavailable.")} <Button variant="ghost" size="sm" onClick={() => void refetch()}>Retry</Button></div>}
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!saveKey.isPending) saveKey.mutate(event.currentTarget); }}>
              <div><Label htmlFor="ai-api-key">{hasKey ? "New API key" : "API key"}</Label><Input id="ai-api-key" name="apiKey" type="password" required maxLength={8192} autoComplete="off" spellCheck={false} disabled={saveKey.isPending} placeholder="Paste your API key" className="mt-2" /></div>
              <p className="text-xs leading-5 text-muted-foreground">Stored in your system’s secure credential store. Saving a new key replaces the current key.</p>
              {saveKey.error != null && <p role="alert" className="text-xs text-destructive">{errorMessage(saveKey.error, "Could not save the key.")}</p>}
              {saveKey.isSuccess && saveKey.data && <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">Your API key has been saved.</p>}
              <Button type="submit" disabled={saveKey.isPending}>{saveKey.isPending ? "Saving…" : hasKey ? "Replace API key" : "Save API key"}</Button>
            </form>
          </div> : <StoragePicker key={current} kind={current} />}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
