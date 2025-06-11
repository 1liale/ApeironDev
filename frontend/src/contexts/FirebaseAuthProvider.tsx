import { Spinner } from "@/components/ui/spinner";
import { auth } from "@/lib/firebase";
import { useAuth } from "@clerk/react-router";
import { signInWithCustomToken, signOut as firebaseSignOut, type Auth } from "firebase/auth";
import { useEffect, createContext, useContext, useState } from "react";

// Create context for Firebase auth
export const FirebaseAuthContext = createContext<Auth | null>(null);

// Custom hook to use the Firebase auth context
export const useFirebaseAuth = () => {
  const context = useContext(FirebaseAuthContext);
  if (context === undefined) {
    throw new Error("useFirebaseAuth must be used within a FirebaseAuthProvider");
  }
  return context;
};

interface FirebaseAuthProviderProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const FirebaseAuthProvider = ({ children, fallback }: FirebaseAuthProviderProps) => {
    const { getToken, userId, isSignedIn } = useAuth();
    const [isFirebaseReady, setIsFirebaseReady] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);

    useEffect(() => {
        const syncFirebaseAuth = async () => {
            setIsInitializing(true);
            setIsFirebaseReady(false);
            
            if (!isSignedIn || !userId) {
                // User is not signed in with Clerk, so Firebase should also be signed out
                if (auth.currentUser) {
                    try {
                        await firebaseSignOut(auth);
                    } catch (error) {
                        console.error('FirebaseAuthProvider: Error signing out from Firebase:', error);
                    }
                }
                setIsFirebaseReady(false);
                setIsInitializing(false);
                return;
            }

            try {
                // Check if we already have a Firebase user
                if (auth.currentUser) {
                    // Verify the existing token is still valid
                    try {
                        await auth.currentUser.getIdToken(true); // Force refresh
                        setIsFirebaseReady(true);
                        setIsInitializing(false);
                        return;
                    } catch (tokenError) {
                        console.warn("FirebaseAuthProvider: Existing token invalid, re-authenticating...");
                        await firebaseSignOut(auth);
                    }
                }

                // If no Firebase user or token was invalid, sign in with Clerk token
                const token = await getToken({ template: 'integration_firebase' });
                if (token) {
                    await signInWithCustomToken(auth, token);
                    setIsFirebaseReady(true);
                } else {
                    console.warn("FirebaseAuthProvider: Clerk token for Firebase was null. Firebase sign-in skipped.");
                    setIsFirebaseReady(false);
                }
            } catch (err) {
                console.error('FirebaseAuthProvider: Firebase auth sync failed during sign-in:', err);
                if (auth.currentUser) {
                    try {
                        await firebaseSignOut(auth);
                    } catch (signOutError) {
                        console.error('FirebaseAuthProvider: Error during cleanup sign out:', signOutError);
                    }
                }
                setIsFirebaseReady(false);
            } finally {
                setIsInitializing(false);
            }
        };

        void syncFirebaseAuth();
    }, [isSignedIn, userId, getToken]); // Re-run when Clerk auth state changes

    // Don't render children until Firebase auth is ready (when user is signed in)
    const shouldRenderChildren = !isSignedIn || (!isInitializing && isFirebaseReady);

    if (!shouldRenderChildren) {
        return <div className="flex flex-col items-center justify-center h-screen">
            <Spinner size="large" />
            <p className="mt-4 text-muted-foreground">Initializing workspace...</p>
        </div>;
    }

    return (
        <FirebaseAuthContext.Provider value={auth}>
            {children}
        </FirebaseAuthContext.Provider>
    );
};

