import { verifyToken, createClerkClient } from "@clerk/backend";
import admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";

// Initialize Firebase Admin SDK if not already initialized
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Initialize Clerk client
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { invitationId } = req.query;
  if (typeof invitationId !== "string") {
    return res.status(400).json({ error: "Invalid invitation ID" });
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res
      .status(401)
      .json({ error: "Token not found. User must sign in." });
  }

  try {
    console.log("Attempting to verify token for invitation acceptance...");
    
    // Try using the Clerk client to verify the session instead
    let userId;
    try {
      // Alternative approach: use Clerk client to verify session
      const sessionToken = await clerkClient.verifyToken(token);
      userId = sessionToken.sub;
      console.log("Token verified successfully with Clerk client");
    } catch (clerkError) {
      console.log("Clerk client verification failed, trying verifyToken function...");
      // Fallback to the original verifyToken function
      const verifiedToken = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
      
      if (!verifiedToken || !verifiedToken.sub) {
        return res.status(401).json({ error: "Invalid session token" });
      }
      userId = verifiedToken.sub;
      console.log("Token verified successfully with verifyToken function");
    }

    if (!userId) {
      return res.status(401).json({ error: "Could not extract user ID from token" });
    }

    // Use a transaction to ensure atomicity
    const { workspaceId, role } = await db.runTransaction(async (transaction) => {
      const invitationRef = db
        .collection("workspace_invitations")
        .doc(invitationId);
      const invitationDoc = await transaction.get(invitationRef);

      if (!invitationDoc.exists) {
        throw new Error("Invitation not found");
      }

      const invitation = invitationDoc.data();

      if (invitation.status !== "pending") {
        throw new Error(`Invitation has already been ${invitation.status}.`);
      }

      if (new Date(invitation.expires_at) < new Date()) {
        throw new Error("Invitation has expired.");
      }

      // 1. Create the new membership
      const membershipId = uuidv4();
      const newMembership = {
        membership_id: membershipId,
        workspace_id: invitation.workspace_id,
        user_id: userId,
        role: invitation.invitee_role,
        joined_at: new Date().toISOString(),
      };
      const membershipRef = db
        .collection("workspace_memberships")
        .doc(membershipId);
      transaction.set(membershipRef, newMembership);

      // 2. Delete the invitation now that it has been used
      transaction.delete(invitationRef);

      console.log(
        `User ${userId} accepted invitation and was added to workspace ${invitation.workspace_id}`
      );
      
      return { workspaceId: invitation.workspace_id, role: invitation.invitee_role };
    });
    
    res.status(200).json({
      message: "Invitation accepted successfully!",
      workspaceId: workspaceId,
      role: role,
    });
  } catch (error) {
    console.error("Error accepting invitation:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
} 