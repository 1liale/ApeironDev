import { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken, createClerkClient } from "@clerk/backend";
import admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";

interface WorkspaceInvitation {
    invitation_id: string;
    workspace_id: string;
    invitee_email: string;
    invitee_role: "viewer" | "editor" | "owner";
    inviter_id: string;
    status: "pending" | "accepted" | "expired" | "revoked";
    created_at: string;
    expires_at: string;
    clerk_invitation_id?: string;
  }
  
  interface WorkspaceMembership {
    membership_id: string;
    workspace_id: string;
    user_id: string;
    role: "owner" | "editor" | "viewer";
    joined_at: string;
  }
  

// Initialize Firebase Admin SDK if not already initialized
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY as string);
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
async function checkWorkspacePermission(
  userId: string,
  workspaceId: string
): Promise<boolean> {
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

    const membership = membershipQuery.docs[0].data() as WorkspaceMembership;
    // Only owners can invite others
    return membership.role === "owner";
  } catch (error) {
    console.error("Error checking workspace permission:", error);
    return false;
  }
}

// Helper function to create invitation in Firestore
async function createInvitation(
  workspaceId: string,
  inviteeEmail: string,
  role: "viewer" | "editor" | "owner",
  inviterId: string
): Promise<WorkspaceInvitation> {
  const invitationId = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation: WorkspaceInvitation = {
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
async function hasExistingInvitation(
  workspaceId: string,
  email: string
): Promise<boolean> {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { workspaceId } = req.query as { workspaceId: string };
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
    // Verify the session token using Clerk's official verifyToken method
    const verifiedToken = await verifyToken(token, {
      jwtKey: process.env.CLERK_JWT_KEY,
      authorizedParties: [
        process.env.APP_BASE_URL || 'http://localhost:8080',
      ],
    });

    if (!verifiedToken || !verifiedToken.sub) {
      return res.status(401).json({ error: "Invalid session token" });
    }

    const userId = verifiedToken.sub as string;
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
