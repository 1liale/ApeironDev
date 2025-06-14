import { createClerkClient } from "@clerk/backend";
import admin from "firebase-admin";

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();

// Initialize Clerk client
export const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// Helper function to check if user has permission to invite to workspace
export async function checkWorkspaceOwnerPermission(userId, workspaceId) {
  try {
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
    const inviterUser = await clerkClient.users.getUser(userId);
    return {
      email: inviterUser.emailAddresses?.[0]?.emailAddress || "",
      name: `${inviterUser.firstName || ""} ${inviterUser.lastName || ""}`.trim(),
    };
} 