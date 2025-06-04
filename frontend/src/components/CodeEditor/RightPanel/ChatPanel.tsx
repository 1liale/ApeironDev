import { Send, Brain, User } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

export const ChatPanel = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: 'Hello! I\'m your AI coding assistant. How can I help you with your code today?',
      role: 'assistant',
      timestamp: new Date()
    },
    {
      id: '2',
      content: 'THIS FEATURE IS IN DEVELOPMENT! AVAILABLE SOON!',
      role: 'assistant',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input,
      role: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Simulate AI response - replace this with Vertex AI integration later
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: 'I understand your request. Once you integrate Vertex AI, I\'ll be able to provide more helpful responses about your code.',
        role: 'assistant',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsLoading(false);
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      <div 
        ref={messagesContainerRef} 
        className="flex-1 overflow-y-auto overflow-x-hidden"
      > 
        <div className="p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1">
                  <Brain className="w-3.5 h-3.5 text-primary-foreground" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                <span className="text-xs text-muted-foreground opacity-70 mt-1 block">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              </div>
              {message.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-accent-foreground flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-3.5 h-3.5 text-accent" />
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1">
                <Brain className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <div className="bg-muted text-muted-foreground rounded-lg px-3 py-2">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="border-t border-border p-3 bg-background w-full flex-shrink-0">
        <div className="flex items-end gap-2 bg-muted rounded-lg border border-border p-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask about your code..."
            className="flex-1 bg-transparent border-0 text-foreground placeholder:text-muted-foreground min-h-[60px] max-h-60 focus-visible:ring-0 focus-visible:ring-offset-0 pr-1 text-sm self-center resize-none"
            disabled={isLoading}
            rows={2}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground h-7 w-7 p-0 flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 px-1">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}; 