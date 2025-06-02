import { auth } from "@/lib/firebase";
import { useAuth } from "@clerk/react-router";
import { signInWithCustomToken, signOut as firebaseSignOut, type Auth } from "firebase/auth";
import { useEffect, createContext, useContext } from "react";

// Create a context for the Firebase auth instance
export const FirebaseAuthContext = createContext<Auth | null>(null);

// Custom hook to use the Firebase auth context
export const useFirebaseAuth = () => {
  const context = useContext(FirebaseAuthContext);
  if (context === undefined) {
    throw new Error("useFirebaseAuth must be used within a FirebaseAuthProvider");
  }
  return context;
};

export const FirebaseAuthProvider = ({ children }: { children: React.ReactNode }) => {
    const { getToken, userId } = useAuth();

    useEffect(() => {
        const syncFirebaseAuth = async () => {
            if (userId) {
                try {
                    // Only attempt signInWithCustomToken if there's no current Firebase user
                    if (!auth.currentUser) { 
                        const token = await getToken({ template: 'integration_firebase' });
                        if (token) {
                            await signInWithCustomToken(auth, token);
                            console.log("FirebaseAuthProvider: Successfully signed into Firebase.");
                        } else {
                            console.warn("FirebaseAuthProvider: Clerk token for Firebase was null. Firebase sign-in skipped.");
                            // If token is null, and there's an existing Firebase user, sign them out.
                            if (auth.currentUser) await firebaseSignOut(auth);
                        }
                    }
                } catch (err) {
                    console.error('FirebaseAuthProvider: Firebase auth sync failed during sign-in:', err);
                    if (auth.currentUser) {
                        await firebaseSignOut(auth);
                    }
                }
            }
        };

        void syncFirebaseAuth();
    }, [userId, getToken]); // Re-run when Clerk user or token acquisition method changes

    return (
        <FirebaseAuthContext.Provider value={auth}>
            {children}
        </FirebaseAuthContext.Provider>
    );
};