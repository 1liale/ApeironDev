import { verifyToken, createClerkClient } from "@clerk/backend";
import admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";

// Initialize Firebase Admin SDK if not already initialized
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Initialize Clerk client
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// Helper function to check if user has permission to invite to workspace
async function checkWorkspacePermission(userId, workspaceId) {
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

// Helper function to create invitation in Firestore
async function createInvitation(workspaceId, inviteeEmail, role, inviterId) {
  const invitationId = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = {
    invitation_id: invitationId,
    workspace_id: workspaceId,
    invitee_email: inviteeEmail,
    invitee_role: role,
    inviter_id: inviterId,
    status: "pending",
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  await db
    .collection("workspace_invitations")
    .doc(invitationId)
    .set(invitation);
  return invitation;
}

// Helper function to check for existing pending invitation
async function hasExistingInvitation(workspaceId, email) {
  try {
    const existingQuery = await db
      .collection("workspace_invitations")
      .where("workspace_id", "==", workspaceId)
      .where("invitee_email", "==", email)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    return !existingQuery.empty;
  } catch (error) {
    console.error("Error checking existing invitation:", error);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { workspaceId } = req.query;
  const { email, role } = req.body;
  const token = req.headers.authorization?.replace("Bearer ", "");
  
  if (!token) {
    return res
      .status(401)
      .json({ error: "Token not found. User must sign in." });
  }
  
  if (!email || !role) {
    return res.status(400).json({ error: "Email and role are required" });
  }

  // Extract and verify Clerk session token
  try {
    console.log("Attempting to verify token...");
    
    // Use the standard verifyToken function with proper configuration
    const verifiedToken = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    
    if (!verifiedToken || !verifiedToken.sub) {
      return res.status(401).json({ error: "Invalid session token" });
    }
    
    const userId = verifiedToken.sub;
    console.log("Token verified successfully, userId:", userId);

    if (!["viewer", "editor", "owner"].includes(role)) {
      return res
        .status(400)
        .json({ error: "Invalid role. Must be viewer, editor, or owner" });
    }

    // Check if user has permission to invite to this workspace
    const hasPermission = await checkWorkspacePermission(userId, workspaceId);
    if (!hasPermission) {
      return res
        .status(403)
        .json({
          error: "You do not have permission to invite users to this workspace",
        });
    }

    // Check for existing pending invitation
    const hasExisting = await hasExistingInvitation(workspaceId, email);
    if (hasExisting) {
      return res
        .status(409)
        .json({ error: "An invitation for this email already exists" });
    }

    // Create the invitation
    const invitation = await createInvitation(workspaceId, email, role, userId);

    // Send email invitation using Clerk
    const redirectUrl = `${process.env.APP_BASE_URL}/accept-workspace-invite/${invitation.invitation_id}`;
    
    const clerkInvitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: redirectUrl,
      publicMetadata: {
        workspaceId: workspaceId,
        invitationId: invitation.invitation_id,
        role: role,
      },
    });

    // Update our invitation with Clerk's invitation ID
    await db
      .collection("workspace_invitations")
      .doc(invitation.invitation_id)
      .update({
        clerk_invitation_id: clerkInvitation.id,
      });

    return res.status(201).json({
      success: true,
      message: "Invitation sent successfully",
    });
  } catch (error) {
    console.error("Error in invitations API:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
} 