import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import { useAuth } from '@clerk/react-router';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useJobStatus } from '@/hooks/useJobStatus';
import { ragQuery, type RagQueryRequestBody } from '@/lib/api';
import { auth } from '@/lib/firebase';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  isProcessing?: boolean;
  jobId?: string;
}

export const ChatPanel = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isSignedIn } = useAuth();
  const { selectedWorkspace } = useWorkspace();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle job completion
  const handleJobEnd = (output: string) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.jobId === currentJobId 
          ? { ...msg, content: output, isProcessing: false }
          : msg
      )
    );
    setIsProcessing(false);
    setCurrentJobId(null);
  };

  // Use job status polling hook
  useJobStatus(currentJobId, handleJobEnd);

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedWorkspace || !isSignedIn) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue.trim(),
      role: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsProcessing(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const queryRequest: RagQueryRequestBody = {
        query: userMessage.content,
        workspaceId: selectedWorkspace.workspaceId,
      };

      const data = await ragQuery(queryRequest, token);
      const jobId = data.job_id;

      // Add processing message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: 'Thinking...',
        role: 'assistant',
        timestamp: new Date(),
        isProcessing: true,
        jobId: jobId,
      };

      setMessages(prev => [...prev, assistantMessage]);
      setCurrentJobId(jobId);

    } catch (error) {
      console.error('Error sending message:', error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: error instanceof Error ? error.message : 'Sorry, there was an error processing your request.',
        role: 'assistant',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
      setIsProcessing(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatContent = (content: string) => {
    // Simple formatting for code blocks and line breaks
    return content.split('\n').map((line, index) => (
      <span key={index}>
        {line}
        {index < content.split('\n').length - 1 && <br />}
      </span>
    ));
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Bot className="mx-auto h-12 w-12 mb-4 text-muted-foreground/50" />
            <p className="text-lg font-medium mb-2">AI Assistant</p>
            <p className="text-sm">
              Ask questions about your code, get explanations, or request help with your workspace.
            </p>
            {!selectedWorkspace && (
              <p className="text-sm text-yellow-600 mt-2">
                Select a workspace to enable AI assistance with your codebase.
              </p>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <div className="flex items-start gap-2">
                  {message.role === 'assistant' && (
                    <Bot className="h-4 w-4 mt-1 flex-shrink-0" />
                  )}
                  {message.role === 'user' && (
                    <User className="h-4 w-4 mt-1 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <div className="text-sm">
                      {message.isProcessing ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>{message.content}</span>
                        </div>
                      ) : (
                        formatContent(message.content)
                      )}
                    </div>
                    <div className="text-xs opacity-70 mt-1">
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-4">
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={
              selectedWorkspace 
                ? "Ask about your code..." 
                : "Select a workspace to enable AI assistance"
            }
            disabled={isProcessing || !selectedWorkspace}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isProcessing || !selectedWorkspace}
            size="icon"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        {!selectedWorkspace && (
          <p className="text-xs text-muted-foreground mt-2">
            Select a workspace to ask questions about your codebase
          </p>
        )}
      </div>
    </div>
  );
}; 