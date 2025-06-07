import { useState } from "react";
import {
  ChevronDown,
  PlusCircle,
  FolderKanban,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  WorkspaceSummaryItem,
} from "@/types/api";
import { toast } from "@/components/ui/sonner";

interface WorkspaceSelectorProps {
  workspaces: WorkspaceSummaryItem[];
  selectedWorkspace: WorkspaceSummaryItem | null;
  isLoadingWorkspaces: boolean;
  isCreatingWorkspace: boolean;
  onSelectWorkspace: (workspace: WorkspaceSummaryItem) => void;
  onCreateWorkspace: (name: string) => Promise<WorkspaceSummaryItem | null>;
}

export const WorkspaceSelector = ({
  workspaces,
  selectedWorkspace,
  isLoadingWorkspaces,
  isCreatingWorkspace,
  onSelectWorkspace,
  onCreateWorkspace,
}: WorkspaceSelectorProps) => {
  const [isCreateWorkspaceDialogOpen, setIsCreateWorkspaceDialogOpen] =
    useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");

  const handleCreateSubmit = async () => {
    if (!newWorkspaceName.trim()) {
      toast.warning("Workspace name cannot be empty.");
      return;
    }
    
    const newWs = await onCreateWorkspace(newWorkspaceName.trim());
    if (newWs) {
        setNewWorkspaceName("");
        setIsCreateWorkspaceDialogOpen(false);
    }
  };

  return (
    <Dialog
      open={isCreateWorkspaceDialogOpen}
      onOpenChange={setIsCreateWorkspaceDialogOpen}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="min-w-[180px] justify-between bg-sidebar-accent hover:bg-sidebar-accent-foreground hover:text-sidebar-foreground ring-1 ring-sidebar-border">
            {isLoadingWorkspaces ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : selectedWorkspace ? (
              <>
                <FolderKanban className="w-4 h-4 mr-2" />
                <span className="truncate max-w-[120px]">
                  {selectedWorkspace.name}
                </span>
              </>
            ) : (
              "Select Workspace"
            )}
            <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {isLoadingWorkspaces && (
            <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
          )}
          {!isLoadingWorkspaces && workspaces.length === 0 && (
            <DropdownMenuItem disabled>No workspaces found.</DropdownMenuItem>
          )}
          {workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.workspaceId}
              onClick={() => onSelectWorkspace(ws)}
            >
              {ws.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DialogTrigger asChild>
            <DropdownMenuItem>
              <PlusCircle className="w-4 h-4 mr-2" />
              Create New Workspace
            </DropdownMenuItem>
          </DialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
          <DialogDescription>
            Enter a name for your new workspace. Click create when you're done.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="workspace-name" className="text-right">
              Name
            </Label>
            <Input
              id="workspace-name"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              className="col-span-3"
              placeholder="My Awesome Project"
              onKeyDown={(e) => e.key === 'Enter' && !isCreatingWorkspace && newWorkspaceName.trim() && handleCreateSubmit()}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" onClick={() => setNewWorkspaceName("")}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            onClick={handleCreateSubmit}
            disabled={isCreatingWorkspace || !newWorkspaceName.trim()}
          >
            {isCreatingWorkspace ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}; 