import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { useCodeExecutionContext } from "@/contexts/CodeExecutionContext";

interface TopBarProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

export const TopBar = ({ isDark, onToggleTheme }: TopBarProps) => {
  const { triggerExecution, isExecuting } = useCodeExecutionContext();

  return (
    <div className="h-14 bg-background border-b border-border flex items-center justify-between px-4 py-2">
      <div className="flex items-center space-x-4">
        <div className="text-foreground font-semibold">Code Editor</div>
      </div>
      
      <div className="flex items-center space-x-2">
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
              <Play className="w-4 h-4" />
              Run
            </>
          )}
        </Button>
        <ThemeToggle isDark={isDark} onToggleTheme={onToggleTheme} />
      </div>
    </div>
  );
};
