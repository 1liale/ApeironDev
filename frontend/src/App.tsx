import { Routes, Route, useLocation } from "react-router-dom";
import NotFound from "./pages/NotFound";
import { ClerkLoaded } from "@clerk/react-router";
import HomePage from "./pages/HomePage";
import { FirebaseAuthProvider } from "./contexts/FirebaseAuthProvider";
import { useState, useEffect } from 'react';
import { OnboardingModal } from '@/components/OnboardingModal';
import { useAuth } from "@clerk/react-router";

const App = () => {
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const { isSignedIn } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const onboardingShownKey = 'onboardingModalShownThisSession';
    const hasOnboardingBeenShown = sessionStorage.getItem(onboardingShownKey);

    // Check if we're on an invitation route
    const isInvitationRoute = location.pathname.startsWith('/accept-workspace-invite/');
    
    // Check if we're on a 404 route (not one of our defined routes)
    const definedRoutes = ['/', /^\/workspace\/[^/]+$/, /^\/accept-workspace-invite\/[^/]+$/];
    const isDefinedRoute = definedRoutes.some(route => {
      if (typeof route === 'string') {
        return location.pathname === route;
      }
      return route.test(location.pathname);
    });

    // Only show onboarding modal if:
    // 1. It hasn't been shown this session
    // 2. User is signed in (for invitation flows, wait until after signup)
    // 3. Not on an invitation route (to avoid conflicts with signup modal)
    // 4. On a defined route (not 404)
    if (!hasOnboardingBeenShown && isSignedIn && !isInvitationRoute && isDefinedRoute) {
      const timer = setTimeout(() => {
        setShowOnboardingModal(true);
        sessionStorage.setItem(onboardingShownKey, 'true');
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [isSignedIn, location.pathname]);

  return (
    <ClerkLoaded>
      <FirebaseAuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/workspace/:workspaceId" element={<HomePage />} />
          <Route
            path="/accept-workspace-invite/:invitationId"
            element={<HomePage />}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        {showOnboardingModal && <OnboardingModal isOpen={showOnboardingModal} onOpenChange={setShowOnboardingModal} />}
      </FirebaseAuthProvider>
    </ClerkLoaded>
  );
};

export default App;