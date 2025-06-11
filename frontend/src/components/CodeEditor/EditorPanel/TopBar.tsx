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
        <Link to="/" className="flex items-center mr-6">
          <img src="/logo.png" alt="Code Editor" width={50} height={50} />
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
      
      <div className="flex items-center space-x-2 sm:space-x-4">
        <div className="flex items-center space-x-2">
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
            <UserButton appearance={{
              elements: {
                avatarBox: "w-8 h-8",
              },
            }} />
          </SignedIn>
        </div>

        <Button
          onClick={triggerExecution}
          disabled={isExecuting}
          size="sm"
          className={`m-2 ${!isExecuting ? "bg-success hover:bg-success/90 text-success-foreground" : "bg-destructive/70 hover:bg-destructive/90 text-destructive-foreground"}`}
        >
          {isExecuting ? (
            <>
              <Square className="w-4 h-4 fill-current text-red-500" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Run
            </>
          )}
        </Button>

        <ThemeToggle isDark={isDark} onToggleTheme={onToggleTheme} />
      </div>
    </div>
  );
}; 