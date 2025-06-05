import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/CodeEditor/RightPanel/ThemeToggle";
import { useCodeExecutionContext } from "@/contexts/CodeExecutionContext";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/react-router";
import { Link } from "react-router-dom";
import { WorkspaceSelector } from "@/components/WorkspaceSelector/WorkspaceSelector";
import { useWorkspace } from "@/contexts/WorkspaceContext";

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
  } = useWorkspace();


  return (
    <div className="h-14 bg-background border-b border-border flex items-center justify-between px-4 py-2">
      <div className="flex items-center space-x-2">
        <Link to="/" className="flex items-center">
          <img src="/logo.png" alt="Code Editor" width={45} height={45} />
          <div className="text-foreground font-semibold text-xl ml-2">ApeironDev</div>
        </Link>

        <SignedIn>
          <WorkspaceSelector 
            workspaces={workspaces}
            selectedWorkspace={selectedWorkspace}
            isLoadingWorkspaces={isLoadingWorkspaces}
            isCreatingWorkspace={isCreatingWorkspace}
            onSelectWorkspace={selectWorkspace}
            onCreateWorkspace={createNewWorkspace}
          />
        </SignedIn>
      </div>
      
      <div className="flex items-center space-x-2 sm:space-x-3">
        <div className="flex items-center space-x-1">
          <SignedOut>
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm" className="text-foreground hover:text-foreground/80 px-2">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
            <Button variant="ghost" size="sm" className="text-foreground hover:text-foreground/80 px-2">
                Sign Up
              </Button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>

        <Button
          onClick={triggerExecution}
          disabled={isExecuting}
          size="sm"
          className="bg-success hover:bg-success/90 text-success-foreground"
        >
          {isExecuting ? (
            <>
              <Square className="w-4 h-4 mr-2 bg-red-500" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2 fill-current" />
              Run
            </>
          )}
        </Button>

        <ThemeToggle isDark={isDark} onToggleTheme={onToggleTheme} />
      </div>
    </div>
  );
}; 