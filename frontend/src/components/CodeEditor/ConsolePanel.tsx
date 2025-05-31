
import { Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConsolePanelProps {
  output: string[];
}

export const ConsolePanel = ({ output }: ConsolePanelProps) => {
  return (
    <div className="h-full flex flex-col bg-gray-900 border-l border-gray-700">
      <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-300">Console</span>
        </div>
        <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-1 font-mono text-sm">
          {output.map((line, index) => (
            <div key={index} className="text-gray-300">
              <span className="text-gray-500 mr-2">$</span>
              {line}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
