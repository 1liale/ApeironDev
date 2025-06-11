import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Terminal, Brain } from "lucide-react";
import { ChatPanel } from "./ChatPanel"; 
import { Textarea } from "@/components/ui/textarea"; 
import { useCodeExecutionContext } from "@/contexts/CodeExecutionContext";
import { useEffect, useRef, useState } from "react";

export const RightPanel = () => {
  const { consoleOutput, consoleInputValue, setConsoleInputValue } = useCodeExecutionContext();
  const outputEndRef = useRef<HTMLDivElement>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const [expandedSections, setExpandedSections] = useState<string[]>(["input", "output"]);

   // Keep track of the previous expanded state of the "output" section
   const prevOutputExpandedRef = useRef(false);

   // Function to scroll to bottom
   const scrollToBottom = () => {
     if (outputEndRef.current) {
       outputEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
     }
   };
 
   // Auto-scroll to bottom when new output is added (existing logic, keep this)
   useEffect(() => {
     // Use requestAnimationFrame to ensure DOM is updated
     requestAnimationFrame(() => {
       scrollToBottom();
     });
   }, [consoleOutput]);
 
   // Auto-scroll to bottom ONLY when the "output" accordion is newly expanded
   useEffect(() => {
     const isOutputCurrentlyExpanded = expandedSections.includes("output");
     const wasOutputPreviouslyExpanded = prevOutputExpandedRef.current;
 
     // Only scroll if output is now expanded AND it was not expanded before
     if (isOutputCurrentlyExpanded && !wasOutputPreviouslyExpanded) {
       const timer = setTimeout(() => {
         requestAnimationFrame(() => {
           scrollToBottom();
         });
       }, 300); // Allow accordion animation to complete
       return () => clearTimeout(timer);
     }
 
     // Update the ref for the next render
     prevOutputExpandedRef.current = isOutputCurrentlyExpanded;
   }, [expandedSections]); // Depend on expandedSections to detect changes

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
          <div className="h-full grid grid-rows-[auto_1fr]">
            {/* Input Section */}
            <Accordion 
              type="multiple" 
              value={expandedSections}
              onValueChange={setExpandedSections}
              className="contents"
            >
              <AccordionItem value="input" className="border-b border-border">
                <AccordionTrigger className="h-10 px-4 hover:no-underline hover:bg-muted/50">
                  <div className="flex items-center space-x-2">
                    <Terminal className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground font-medium">Input</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="p-3">
                    <Textarea
                      value={consoleInputValue}
                      onChange={(e) => setConsoleInputValue(e.target.value)}
                      placeholder="Enter inputs here (one per line)..."
                      className="bg-muted text-foreground border-border focus:ring-ring focus:border-ring resize-vertical text-sm font-mono p-3 min-h-[120px] max-h-[400px]"
                      rows={6}
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Input will be passed to your program's stdin. Each line represents separate input.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Output Section */}
              <AccordionItem value="output" className="min-h-0 border-0 flex flex-col">
                <AccordionTrigger className="h-10 px-4 hover:no-underline hover:bg-muted/50 border-b border-border">
                  <div className="flex items-center space-x-2">
                    <Terminal className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground font-medium">Output</span>
                    {consoleOutput.length > 0 && (
                      <span className="text-xs bg-muted px-2 py-1 rounded-full">
                        {consoleOutput.length} lines
                      </span>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="flex-1 max-h-full overflow-auto min-h-0 p-0">
                  <div 
                    ref={outputContainerRef}
                    className="h-full p-4 overflow-auto bg-muted/20"
                  >
                    <div className="space-y-1 font-mono text-sm">
                      {consoleOutput.length === 0 ? (
                        <div className="text-muted-foreground italic">
                          No output yet. Run your code to see results here.
                        </div>
                      ) : (
                        consoleOutput.map((line, index) => (
                          <div key={index} className="text-foreground pb-1 break-all">
                            <span className="text-muted-foreground mr-2 select-none">$</span>
                            <span className="whitespace-pre-wrap">{line}</span>
                          </div>
                        ))
                      )}
                      <div ref={outputEndRef} />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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