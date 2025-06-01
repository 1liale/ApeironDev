import { Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { ClerkLoaded } from "@clerk/react-router";
import SignUpPage from "./pages/SignUpPage";
import SignInPage from "./pages/SignInPage";

const App = () => (
  <TooltipProvider>
    <Toaster />
    <ClerkLoaded>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ClerkLoaded>
  </TooltipProvider>
);

export default App;