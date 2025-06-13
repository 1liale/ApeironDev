import { Play, Square, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/CodeEditor/RightPanel/ThemeToggle";
import { useCodeExecutionContext } from "@/contexts/CodeExecutionContext";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/react-router";
import { Link } from "react-router-dom";
import { WorkspaceSelector } from "@/components/Workspaces/WorkspaceSelector";
import { ShareWorkspaceDialog } from "@/components/Workspaces/ShareWorkspaceDialog";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useState } from "react";

interface TopBarProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

export const TopBar = ({ isDark, onToggleTheme }: TopBarProps) => {
  const { triggerExecution, isExecuting } = useCodeExecutionContext();
  const {
    workspaces,
    selectedWorkspace,
    isLoadingWorkspaces,
    isCreatingWorkspace,
    selectWorkspace,
    createNewWorkspace,
    refreshWorkspaces,
  } = useWorkspace();
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);

  return (
    <div className="h-14 bg-background border-b border-border flex items-center justify-between px-6 py-2">
      <div className="flex items-center space-x-2">
        <Link to="/" className="flex items-center mr-6">
          <img src="/logo.png" alt="Code Editor" width={50} height={50} />
          <div className="text-foreground font-semibold text-xl ml-2">
            ApeironDev
          </div>
        </Link>

        <SignedIn>
          <WorkspaceSelector
            workspaces={workspaces}
            selectedWorkspace={selectedWorkspace}
            isLoadingWorkspaces={isLoadingWorkspaces}
            isCreatingWorkspace={isCreatingWorkspace}
            onSelectWorkspace={selectWorkspace}
            onCreateWorkspace={createNewWorkspace}
            onRefreshWorkspaces={refreshWorkspaces}
          />
        </SignedIn>
      </div>

      <div className="flex items-center space-x-2">
        <Button
          onClick={triggerExecution}
          disabled={isExecuting}
          className={`${isExecuting ? "bg-destructive/70 hover:bg-destructive/90 text-destructive-foreground" : "bg-success hover:bg-success/90 text-success-foreground"}`}
        >
          {isExecuting ? (
            <><Square className="w-4 h-4 fill-current text-red-500" /> Running...</>
          ) : (
            <><Play className="w-4 h-4 fill-current" /> Run</>
          )}
        </Button>

        {selectedWorkspace && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsShareDialogOpen(true)}
            className="ml-2"
          >
            <Share2 className="w-4 h-4" />
          </Button>
        )}

        <ThemeToggle isDark={isDark} onToggleTheme={onToggleTheme} />

        <div className="flex items-center space-x-2">
          <SignedOut>
            <SignInButton mode="modal">
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground hover:text-foreground/80 px-2"
              >
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground hover:text-foreground/80 px-2"
              >
                Sign Up
              </Button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "w-8 h-8 ml-1",
                },
              }}
            />
          </SignedIn>
        </div>
      </div>

      {selectedWorkspace && (
        <ShareWorkspaceDialog
          workspace={selectedWorkspace}
          isOpen={isShareDialogOpen}
          onClose={() => setIsShareDialogOpen(false)}
        />
      )}
    </div>
  );
};
