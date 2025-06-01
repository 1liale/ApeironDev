import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { useCodeExecutionContext } from "@/contexts/CodeExecutionContext";
import { SignedIn, SignedOut, UserButton } from "@clerk/react-router";
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
        <Link to="/"><div className="text-foreground font-semibold">Code Editor</div></Link>
      </div>
      
      <div className="flex items-center space-x-4">
        {/* <div className="flex items-center space-x-2">
          <SignedOut>
            <Button asChild variant="link" size="sm" className="text-foreground hover:text-foreground/80 no-underline hover:no-underline px-1">
              <Link to="/sign-in">Sign In</Link>
            </Button>
            <Button asChild variant="link" size="sm" className="text-foreground hover:text-foreground/80 no-underline hover:no-underline px-1">
              <Link to="/sign-up">Sign Up</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <UserButton afterSignOutUrl="/sign-in" />
          </SignedIn>
        </div> */}

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
