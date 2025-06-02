import { Routes, Route } from "react-router-dom";
import NotFound from "./pages/NotFound";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { ClerkLoaded } from "@clerk/react-router";
import SignUpPage from "./pages/SignUpPage";
import SignInPage from "./pages/SignInPage";
import HomePage from "./pages/HomePage";
import { FirebaseAuthProvider } from "./contexts/FirebaseAuthProvider";

const App = () => (
  <TooltipProvider>
    <Toaster />
    <ClerkLoaded>
      <FirebaseAuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/sign-up" element={<SignUpPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </FirebaseAuthProvider>
    </ClerkLoaded>
  </TooltipProvider>
);

export default App;