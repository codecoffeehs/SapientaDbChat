import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ComputerIcon, Folder01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/queries";
import type { IngestionDestination, S3Draft } from "@/lib/ingestion";
import { useIngestionUi } from "@/stores/ingestion-ui";

const fields: { key: keyof S3Draft; label: string; placeholder: string; type?: string; optional?: boolean }[] = [
  { key: "name", label: "Destination name", placeholder: "Production schemas" },
  { key: "endpoint", label: "S3 endpoint", placeholder: "https://s3.gra.io.cloud.ovh.net", type: "url" },
  { key: "accessKeyId", label: "Access key ID", placeholder: "Your S3 access key", type: "password" },
  { key: "secretAccessKey", label: "Secret access key", placeholder: "Your S3 secret key", type: "password" },
  { key: "bucket", label: "Bucket", placeholder: "db.schemas" },
  { key: "publicBaseUrl", label: "Public base URL", placeholder: "https://schemas.example.com", type: "url" },
  { key: "region", label: "Signing region", placeholder: "Detected from OVH endpoints", optional: true },
];

export function StoragePicker({ workspaceId, selectedId = "", disabled = false, kind }: { workspaceId?: string; selectedId?: string; disabled?: boolean; kind?: "local" | "s3" }) {
  const queryClient = useQueryClient();
  const selectDestination = useIngestionUi((state) => state.selectDestination);
  const [s3Open, setS3Open] = useState(false);
  const [s3Draft, updateDraft] = useState<S3Draft>({ name: "", endpoint: "", accessKeyId: "", secretAccessKey: "", bucket: "", publicBaseUrl: "", region: "" });
  const setS3Draft = (value: Partial<S3Draft>) => updateDraft((previous) => ({ ...previous, ...value }));
  const closeS3 = () => { setS3Open(false); updateDraft({ name: "", endpoint: "", accessKeyId: "", secretAccessKey: "", bucket: "", publicBaseUrl: "", region: "" }); };
  const { data: destinations = [], isPending, error, refetch } = useQuery({
    queryKey: ["ingestion-destinations"],
    queryFn: () => invoke<IngestionDestination[]>("list_ingestion_destinations"),
  });
  const { mutate: chooseFolder, isPending: isChoosing, error: folderError } = useMutation({
    mutationKey: ["choose-ingestion-folder"],
    mutationFn: () => invoke<IngestionDestination | null>("choose_ingestion_folder"),
    onSuccess: async (destination) => {
      if (!destination) return;
      if (workspaceId) selectDestination(workspaceId, destination.id);
      await queryClient.invalidateQueries({ queryKey: ["ingestion-destinations"] });
    },
  });
  const { mutate: saveS3, isPending: isSaving, error: saveError, reset } = useMutation({
    mutationKey: ["save-s3-destination"],
    mutationFn: (input: S3Draft) => invoke<IngestionDestination>("save_s3_destination", { input }),
    onSuccess: async (destination) => {
      if (workspaceId) selectDestination(workspaceId, destination.id);
      closeS3();
      toast.add({ title: "Storage settings saved", description: "You can reuse this destination for other databases.", type: "success" });
      await queryClient.invalidateQueries({ queryKey: ["ingestion-destinations"] });
    },
  });

  return (
    <div className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted"><HugeiconsIcon icon={Folder01Icon} size={18} aria-hidden="true" /></span>
        <div><h2 className="text-sm font-medium">{kind === "local" ? "Download locations" : kind === "s3" ? "S3 buckets" : "Save your database guide"}</h2><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{kind === "local" ? "Add folders for saving your database guides. Choose a saved folder during ingestion." : kind === "s3" ? "Connect an S3-compatible bucket to save your guides in the cloud." : "Choose a local folder or an S3 cloud storage location."}</p></div>
      </div>
      {isPending ? <p role="status" className="mt-5 text-xs text-muted-foreground">Loading saved destinations…</p>
        : error ? <div role="alert" className="mt-4 text-xs text-destructive">{errorMessage(error, "Could not load storage settings.")} <Button variant="ghost" size="xs" onClick={() => void refetch()}>Retry</Button></div>
        : <fieldset disabled={disabled || isChoosing || isSaving} className="mt-5 space-y-2">
          <legend className="sr-only">Storage destination</legend>
          {destinations.filter((destination) => !kind || destination.kind === kind).map((destination) => (
            <label key={destination.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors has-disabled:cursor-default ${selectedId === destination.id ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40"}`}>
              {workspaceId && <input type="radio" name="ingestion-destination" value={destination.id} checked={selectedId === destination.id}
                onChange={() => selectDestination(workspaceId, destination.id)} className="size-4 shrink-0 accent-primary" />}
              <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{destination.name}</span><span className={`mt-1 block text-[11px] leading-5 text-muted-foreground ${selectedId === destination.id ? "break-all" : "truncate"}`} title={destination.description}>{destination.description}</span></span>
              <span className="text-[10px] text-muted-foreground">{destination.kind === "local" ? "Local" : "S3"}</span>
            </label>
          ))}
          {!destinations.some((destination) => !kind || destination.kind === kind) && <p className="rounded-xl border border-dashed p-4 text-xs leading-5 text-muted-foreground">{kind === "local" ? "No folders added yet. Choose a folder below." : kind === "s3" ? "No buckets connected yet. Add your first bucket below." : "Choose a folder, or add your first S3 destination."}</p>}
        </fieldset>}
      <div className="mt-4 flex flex-wrap gap-2">
        {kind !== "s3" && <Button variant="outline" size="sm" disabled={disabled || isChoosing || isSaving} onClick={() => {
          if (!queryClient.isMutating({ mutationKey: ["choose-ingestion-folder"] })) chooseFolder();
        }} className="gap-2"><HugeiconsIcon icon={isChoosing ? Loading03Icon : ComputerIcon} size={15} className={isChoosing ? "animate-spin" : ""} aria-hidden="true" />Choose a folder</Button>}
        {kind !== "local" && <Button variant="outline" size="sm" disabled={disabled || isSaving} onClick={() => { reset(); setS3Open(true); }} className="gap-2"><HugeiconsIcon icon={Add01Icon} size={15} aria-hidden="true" />Add S3 bucket</Button>}
      </div>
      {folderError != null && <p role="alert" className="mt-3 text-xs text-destructive">{errorMessage(folderError, "Could not choose a folder.")}</p>}
      <p className="mt-4 text-[11px] leading-5 text-muted-foreground">Your progress stays saved on this device. Cloud storage passwords are never sent to AI.</p>

      <Dialog open={s3Open} onOpenChange={(open) => { if (!isSaving) { if (open) setS3Open(true); else closeS3(); reset(); } }}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg" showCloseButton={!isSaving}>
          <DialogHeader><DialogTitle>Add S3 storage</DialogTitle><DialogDescription>Use an OVH or S3-compatible bucket. Save once, reuse across workspaces.</DialogDescription></DialogHeader>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!queryClient.isMutating({ mutationKey: ["save-s3-destination"] })) saveS3(s3Draft);
          }} className="mt-1 space-y-4">
            {fields.map(({ key, label, placeholder, type, optional }) => (
              <div key={key}><Label htmlFor={`s3-${key}`}>{label}{optional && <span className="ml-2 text-[10px] font-normal text-muted-foreground">Optional for OVH</span>}</Label>
                <Input id={`s3-${key}`} type={type ?? "text"} required={!optional} maxLength={key === "name" ? 80 : 2048}
                  value={s3Draft[key]} onChange={(event) => setS3Draft({ [key]: event.target.value })} disabled={isSaving}
                  placeholder={placeholder} autoComplete="off" spellCheck={false} className="mt-2 h-10 text-xs md:text-xs" />
              </div>
            ))}
            <p className="text-[11px] leading-5 text-muted-foreground">The public base URL is saved for future links. Uploading does not change your bucket’s access permissions. The region is required for other S3 providers.</p>
            {saveError != null && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">{errorMessage(saveError, "Could not save S3 settings.")}</p>}
            <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="ghost" disabled={isSaving} onClick={() => { closeS3(); reset(); }}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save destination"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
