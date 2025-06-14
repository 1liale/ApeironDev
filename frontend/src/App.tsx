import { Routes, Route, useLocation } from "react-router-dom";
import NotFound from "./pages/NotFound";
import { ClerkLoaded } from "@clerk/react-router";
import HomePage from "./pages/HomePage";
import InvitationPage from "./pages/InvitationPage";
import { FirebaseAuthProvider } from "./contexts/FirebaseAuthProvider";
import { useState, useEffect } from "react";
import { OnboardingModal } from "@/components/OnboardingModal";
import { useAuth } from "@clerk/react-router";

const App = () => {
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const { isSignedIn } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const onboardingShownKey = "onboardingModalShownThisSession";
    const hasOnboardingBeenShown = sessionStorage.getItem(onboardingShownKey);
    const isInvitationRoute = location.pathname.startsWith("/invitation/");

    const definedRoutes = [
      "/",
      /^\/workspaces\/[^/]+$/,
      /^\/invitations\/[^/]+$/,
    ];
    const isDefinedRoute = definedRoutes.some((route) =>
      typeof route === "string"
        ? location.pathname === route
        : route.test(location.pathname)
    );

    if (
      !hasOnboardingBeenShown &&
      isSignedIn &&
      !isInvitationRoute &&
      isDefinedRoute
    ) {
      const timer = setTimeout(() => {
        setShowOnboardingModal(true);
        sessionStorage.setItem(onboardingShownKey, "true");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSignedIn, location.pathname]);

  return (
    <ClerkLoaded>
      <FirebaseAuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/workspaces/:workspaceId" element={<HomePage />} />
          <Route path="/invitations/:invitationId" element={<InvitationPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        {showOnboardingModal && (
          <OnboardingModal
            isOpen={showOnboardingModal}
            onOpenChange={setShowOnboardingModal}
          />
        )}
      </FirebaseAuthProvider>
    </ClerkLoaded>
  );
};

export default App;
