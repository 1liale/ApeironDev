import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/CodeEditor/RightPanel/ThemeToggle";
import { Home } from "lucide-react"; // Removed ArrowLeft as it's not used
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/react-router";
import { Link } from "react-router-dom";

// Simplified TopBar for NotFound page that doesn't depend on contexts
const SimpleTopBar = ({ isDark, onToggleTheme }: { isDark: boolean; onToggleTheme: () => void }) => {
  return (
    <div className="h-14 bg-background border-b border-border flex items-center justify-between px-6 py-2">
      <div className="flex items-center space-x-2">
        <Link to="/" className="flex items-center mr-6">
          <img src="/logo.png" alt="Code Editor" width={50} height={50} />
          <div className="text-foreground font-semibold text-xl ml-2">
            ApeironDev
          </div>
        </Link>
      </div>

      <div className="flex items-center space-x-2">
        <ThemeToggle isDark={isDark} onToggleTheme={onToggleTheme} />

        <div className="flex items-center space-x-2">
          <SignedOut>
            <SignInButton mode="modal">
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground hover:text-foreground/80 px-2"
              >
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground hover:text-foreground/80 px-2"
              >
                Sign Up
              </Button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "w-8 h-8 ml-1",
                },
              }}
            />
          </SignedIn>
        </div>
      </div>
    </div>
  );
};

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    return savedTheme ? savedTheme === "dark" : true;
  });

  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    // Dispatch a custom event so ClerkThemeProviderWrapper can react immediately
    window.dispatchEvent(new CustomEvent("themeChanged"));
  }, [isDark]);

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  const handleGoHome = () => {
    navigate("/");
  };

  return (
    <div className={`h-screen flex flex-col ${isDark ? "dark" : ""}`}>
      <SimpleTopBar isDark={isDark} onToggleTheme={toggleTheme} />
      
      <div className="flex-1 flex items-center justify-center bg-background text-foreground">
        <div className="text-center max-w-xl mx-auto p-8">
          <img 
            src="/404.png" 
            alt="404 Not Found" 
            className="w-full max-w-md mx-auto"
          />

          <h1 className="text-3xl sm:text-4xl font-bold mb-3 text-primary">
            Page Not Found
          </h1>
          <p className="text-lg text-muted-foreground mb-8">
            Oops! The page you're looking for doesn't exist. It might have been moved or deleted.
          </p>

          <div className="flex justify-center">
            <Button 
              variant="default" 
              size="lg"
              className="text-lg px-8 py-3 flex items-center gap-2"
              onClick={handleGoHome}
            >
              <Home className="h-5 w-5" />
              Go Home
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;