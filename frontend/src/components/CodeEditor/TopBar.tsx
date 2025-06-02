import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { useCodeExecutionContext } from "@/contexts/CodeExecutionContext";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/react-router";
import { Link } from "react-router-dom";

interface TopBarProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

export const TopBar = ({ isDark, onToggleTheme }: TopBarProps) => {
  const { triggerExecution, isExecuting } = useCodeExecutionContext();

  return (
    <div className="h-14 bg-background border-b border-border flex items-center justify-between px-4 py-2">
      <div className="flex items-center space-x-4">
        <Link to="/" className="flex items-center">
          <img src="/logo.png" alt="Code Editor" width={45} height={45} />
          <div className="text-foreground font-semibold text-xl ml-2">ApeironDev</div>
        </Link>
      </div>
      
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <SignedOut>
            <SignInButton mode="modal">
              <Button variant="link" size="sm" className="text-foreground hover:text-foreground/80 no-underline hover:no-underline px-1">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button variant="link" size="sm" className="text-foreground hover:text-foreground/80 no-underline hover:no-underline px-1">
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
              <Square className="w-4 h-4 mr-2" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Run
            </>
          )}
        </Button>

        <ThemeToggle isDark={isDark} onToggleTheme={onToggleTheme} />
      </div>
    </div>
  );
};
