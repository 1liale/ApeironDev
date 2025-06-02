import { Routes, Route } from "react-router-dom";
import NotFound from "./pages/NotFound";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ClerkLoaded } from "@clerk/react-router";
import HomePage from "./pages/HomePage";
import { FirebaseAuthProvider } from "./contexts/FirebaseAuthProvider";
import { useState, useEffect } from 'react';
import { OnboardingModal } from '@/components/OnboardingModal';

const App = () => {
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  useEffect(() => {
    const onboardingShownKey = 'onboardingModalShownThisSession';
    const hasOnboardingBeenShown = sessionStorage.getItem(onboardingShownKey);

    if (!hasOnboardingBeenShown) {
      const timer = setTimeout(() => {
        setShowOnboardingModal(true);
        sessionStorage.setItem(onboardingShownKey, 'true');
      }, 2000); // Keep your existing delay or adjust as needed

      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <TooltipProvider>
      <Toaster />
      <ClerkLoaded>
        <FirebaseAuthProvider>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          {showOnboardingModal && <OnboardingModal isOpen={showOnboardingModal} onOpenChange={setShowOnboardingModal} />}
        </FirebaseAuthProvider>
      </ClerkLoaded>
    </TooltipProvider>
  );
};

export default App;