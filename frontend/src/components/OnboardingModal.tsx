import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { X, ChevronLeft, ChevronRight, Code, Shield, Sparkles, FolderKanban, Terminal } from "lucide-react";

interface OnboardingModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function OnboardingModal({ isOpen, onOpenChange }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  
  const steps = [
    {
      title: "Welcome to ApeironDev IDE!",
      subtitle: "Supercharge Your Code with Intelligent AI Code-Assist",
      content: (
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <img src="/logo.png" alt="App Logo" className="h-24 w-24 object-contain" />
          </div>
          <div className="space-y-4">
            <p className="text-lg text-muted-foreground max-w-lg mx-auto">
              They say Apeiron is the <strong>'unlimited'</strong>, the <strong>'boundless'</strong> <br />Discover your unlimited potential with ApeironDev
            </p>
            <div className="flex justify-center pt-4 gap-2">
              <Badge variant="outline">No Setup Required</Badge>
              <Badge variant="outline">Fast Execution</Badge>
              <Badge variant="outline">Secure Sandbox Runtime</Badge>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Quick Tips",
      subtitle: "Everything you need to know to get started",
      content: (
        <div className="space-y-6 w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border">
              <CardContent className="p-4 text-center">
                <FolderKanban className="h-8 w-8 mx-auto mb-3 text-primary" />
                <h3 className="font-semibold mb-2">Workspace</h3>
                <p className="text-sm text-muted-foreground">Manage your files and folders within the workspace.</p>
              </CardContent>
            </Card>
            <Card className="border">
              <CardContent className="p-4 text-center">
                <Code className="h-8 w-8 mx-auto mb-3 text-primary" />
                <h3 className="font-semibold mb-2">Editor</h3>
                <p className="text-sm text-muted-foreground">Use the powerful editor to write and modify your code.</p>
              </CardContent>
            </Card>
            <Card className="border">
              <CardContent className="p-4 text-center">
                <Terminal className="h-8 w-8 mx-auto mb-3 text-primary" />
                <h3 className="font-semibold mb-2">Output Panel</h3>
                <p className="text-sm text-muted-foreground">Results, errors, and logs will appear in the output panel.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )
    },
    {
      title: "Usage Guidelines",
      subtitle: "What you need to know about limits and features",
      content: (
        <div className="space-y-6 w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border">
              <CardContent className="p-4">
                <Shield className="h-6 w-6 mb-3 text-primary" />
                <h3 className="font-semibold mb-3">Security & Limits</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Each execution is sandboxed for security.</p>
                  <p>Resource limits apply: 10s CPU time, 256MB memory.</p>
                  <p>Please use the service responsibly.</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border">
              <CardContent className="p-4">
                <Sparkles className="h-6 w-6 mb-3 text-primary" />
                <h3 className="font-semibold mb-3">Free Tier Benefits</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>As a new user, you receive <strong>120 free LLM suggestion requests</strong> per month.</p>
                  <p>Only authenticated users may manage workspaces. Users are limited to 3 workspaces per account.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )
    },
    {
      title: "About ApeironDev",
      subtitle: "Powerful open-source IDE for AI-driven coding",
      content: (
        <div className="text-center space-y-6 max-w-xl mx-auto w-full">
          <div className="space-y-4">
            <p className="text-lg text-muted-foreground">
              
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
              <Card className="border">
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-2">Currently Supports</h3>
                  <p className="text-sm text-muted-foreground">
                    <strong>Python3 scripts</strong> — more languages coming soon!
                  </p>
                </CardContent>
              </Card>
              <Card className="border">
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-2">Built With</h3>
                  <p className="text-sm text-muted-foreground">
                    Powered by GCP's Free Tier, built with a modern microservice stack, Vertex AI, and automated CI/CD.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
          <div className="space-y-3 mt-6">
            <Button 
              onClick={() => onOpenChange(false)} 
              size="lg" 
              className="w-full text-lg py-6"
            >
              Got it! Let's Code
            </Button>
            <p className="text-xs text-muted-foreground">
              Ready to start your boundless coding journey
            </p>
          </div>
        </div>
      )
    }
  ];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogContent 
          className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-3xl translate-x-[-50%] translate-y-[-50%] gap-0 border bg-popover p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-700 sm:rounded-lg md:w-full text-popover-foreground overflow-hidden shadow-xl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* Close button */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>

          {/* Progress bar */}
          <div className="w-full bg-muted h-1">
            <div 
              className="h-1 bg-primary transition-all duration-300 ease-out"
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            />
          </div>

          {/* Content */}
          <div className="p-6 md:p-8 min-h-[450px] md:min-h-[500px] flex flex-col">
            <div className="text-center mb-6 md:mb-8">
              <h1 className="text-2xl md:text-3xl font-bold mb-2">{steps[currentStep].title}</h1>
              <p className="text-base md:text-lg text-muted-foreground">{steps[currentStep].subtitle}</p>
            </div>

            <div className="flex-1 flex items-center justify-center">
              {steps[currentStep].content}
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center mt-6 md:mt-8">
              <Button 
                variant="ghost" 
                onClick={prevStep} 
                disabled={currentStep === 0}
                className="flex items-center gap-2"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>

              <div className="flex gap-2">
                {steps.map((_, index) => (
                  <div
                    key={index}
                    className={`h-2 w-2 rounded-full transition-all duration-200 ${
                      index === currentStep 
                        ? 'bg-primary w-6' 
                        : index < currentStep 
                          ? 'bg-primary/60' 
                          : 'bg-muted'
                    }`}
                  />
                ))}
              </div>

              {currentStep < steps.length - 1 ? (
                <Button onClick={nextStep} className="flex items-center gap-2">
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                // Spacer to maintain layout, slightly adjusted for potentially smaller button
                <div style={{ width: 'calc(4rem + 0.5rem)' }} /> 
              )}
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
} 