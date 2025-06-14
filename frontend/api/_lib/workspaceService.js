import { createClerkClient } from "@clerk/backend";
import admin from "firebase-admin";

// Helper function to get initialized Firebase app
function getFirebaseApp() {
  // Check if app already exists (for reuse within the same function execution)
  if (admin.apps.length > 0) {
    return admin.apps[0];
  }

  // Parse service account from environment variable
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY environment variable is required");
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Helper function to get Firestore database instance
export function getDb() {
  const app = getFirebaseApp();
  return admin.firestore(app);
}

// Helper function to get Clerk client
export function getClerkClient() {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY environment variable is required");
  }

  return createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });
}

// Helper function to check if user has permission to invite to workspace
export async function checkWorkspaceOwnerPermission(userId, workspaceId) {
  try {
    const db = getDb();
    
    const membershipQuery = await db
      .collection("workspace_memberships")
      .where("user_id", "==", userId)
      .where("workspace_id", "==", workspaceId)
      .limit(1)
      .get();
    
    if (membershipQuery.empty) {
      return false;
    }

    const membership = membershipQuery.docs[0].data();
    // Only owners can invite others
    return membership.role === "owner";
  } catch (error) {
    console.error("Error checking workspace permission:", error);
    return false;
  }
}

export async function getInviterInfo(userId) {
  try {
    const clerkClient = getClerkClient();
    const inviterUser = await clerkClient.users.getUser(userId);
    
    return {
      email: inviterUser.emailAddresses?.[0]?.emailAddress || "",
      name: `${inviterUser.firstName || ""} ${inviterUser.lastName || ""}`.trim(),
    };
  } catch (error) {
    console.error("Error getting inviter info:", error);
    throw error;
  }
} 