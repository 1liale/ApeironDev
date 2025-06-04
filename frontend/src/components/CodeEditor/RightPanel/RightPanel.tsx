import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, Brain } from "lucide-react";
import { ChatPanel } from "./ChatPanel"; 
import { Textarea } from "@/components/ui/textarea"; 
import { useCodeExecutionContext } from "@/contexts/CodeExecutionContext";

export const RightPanel = () => {
  const { consoleOutput } = useCodeExecutionContext();

  return (
    <div className="h-full flex flex-col bg-background border-l border-border overflow-hidden">
      <Tabs
        defaultValue="console"
        className="h-full flex flex-col overflow-hidden"
      >
        <div className="border-b border-border p-2 flex-shrink-0">
          <TabsList className="grid w-full grid-cols-2 bg-muted">
            <TabsTrigger
              value="console"
              className="flex items-center gap-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
            >
              <Terminal className="w-4 h-4" />
              Console
            </TabsTrigger>
            <TabsTrigger
              value="chat"
              className="flex items-center gap-2 text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
            >
              <Brain className="w-4 h-4" />
              LLM
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="console" className="flex-1 m-0 overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="h-10 bg-background border-b border-border flex items-center px-4 flex-shrink-0">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Input</span>
              </div>
            </div>

            <div className="p-2 border-b border-border flex-shrink-0">
              <Textarea
                placeholder={"Enter inputs here..."}
                className="bg-muted text-foreground border-border focus:ring-ring focus:border-ring resize-none text-sm h-20 font-mono p-2"
              />
            </div>
            <div className="h-10 bg-background border-b border-border flex items-center px-4 flex-shrink-0">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Output</span>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-auto">
              <div className="space-y-1 font-mono text-sm">
                {consoleOutput.map((line, index) => (
                  <div key={index} className="text-foreground pb-1">
                    <span className="text-muted-foreground mr-2">$</span>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="chat" className="flex-1 m-0 overflow-hidden h-full">
          <div className="h-full overflow-hidden">
            <ChatPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}; 