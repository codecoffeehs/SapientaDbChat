import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceLayout } from "@/components/layout/workspace-layout";

export const Route = createFileRoute("/workspaces")({ component: WorkspaceLayout });
