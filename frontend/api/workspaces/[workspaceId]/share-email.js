import { verifyToken } from "@clerk/backend";
import { v4 as uuidv4 } from "uuid";
import {
  db,
  clerkClient,
  checkWorkspaceOwnerPermission,
  getInviterInfo,
} from "../../_lib/workspaceService";

// Helper function to create invitation in Firestore
async function createInvitation(workspaceId, inviteeEmail, role, inviterId, inviterInfo) {
  const invitationId = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = {
    invitation_id: invitationId,
    workspace_id: workspaceId,
    invitee_email: inviteeEmail,
    invitee_role: role,
    inviter_id: inviterId,
    inviter_email: inviterInfo.email,
    inviter_name: inviterInfo.name,
    status: "pending", // Email invitations start as "pending" until accepted
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    invitation_type: "email", // Add type for consistency
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
  console.log(`[SHARE-EMAIL] ${req.method} request received`);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { workspaceId } = req.query;
  const { email, role } = req.body;
  const token = req.headers.authorization?.replace("Bearer ", "");
  
  console.log(`[SHARE-EMAIL] Request for workspace: ${workspaceId}, email: ${email}, role: ${role}`);
  
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
    const verifiedToken = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    
    if (!verifiedToken || !verifiedToken.sub) {
      return res.status(401).json({ error: "Invalid session token" });
    }
    
    const userId = verifiedToken.sub;
    console.log(`[SHARE-EMAIL] User ${userId} inviting ${email} to workspace ${workspaceId}`);

    if (!["viewer", "editor", "owner"].includes(role)) {
      return res
        .status(400)
        .json({ error: "Invalid role. Must be viewer, editor, or owner" });
    }

    // Get inviter information from Clerk
    const inviterInfo = await getInviterInfo(userId);

    // Check if user has permission to invite to this workspace
    const hasPermission = await checkWorkspaceOwnerPermission(userId, workspaceId);
    if (!hasPermission) {
      console.log(`[SHARE-EMAIL] Permission denied for user ${userId} on workspace ${workspaceId}`);
      return res
        .status(403)
        .json({
          error: "You do not have permission to invite users to this workspace",
        });
    }

    // Check for existing pending invitation
    const hasExisting = await hasExistingInvitation(workspaceId, email);
    if (hasExisting) {
      console.log(`[SHARE-EMAIL] Duplicate invitation attempt for ${email} to workspace ${workspaceId}`);
      return res
        .status(409)
        .json({ error: "An invitation for this email already exists" });
    }

    // Create the invitation
    const invitation = await createInvitation(workspaceId, email, role, userId, inviterInfo);
    console.log(`[SHARE-EMAIL] Created invitation ${invitation.invitation_id} for ${email}`);

    // Send email invitation using Clerk
    const baseUrl = process.env.APP_BASE_URL || 'https://www.apeirondev.tech';
    const redirectUrl = `${baseUrl}/invitations/${invitation.invitation_id}`;
    
    console.log(`[SHARE-EMAIL] Sending Clerk invitation to ${email} with redirect: ${redirectUrl}`);
    
    const clerkInvitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: redirectUrl,
      publicMetadata: {
        workspaceId: workspaceId,
        invitationId: invitation.invitation_id,
        role: role,
      },
      notify: true,
    });

    // Update our invitation with Clerk's invitation ID
    await db
      .collection("workspace_invitations")
      .doc(invitation.invitation_id)
      .update({
        clerk_invitation_id: clerkInvitation.id,
      });

    console.log(`[SHARE-EMAIL] Successfully sent invitation ${invitation.invitation_id} to ${email}`);

    return res.status(201).json({
      success: true,
      message: "Invitation sent successfully",
    });
  } catch (error) {
    console.error(`[SHARE-EMAIL] Error for workspace ${workspaceId}, email ${email}:`, error);
    return res.status(500).json({ error: "Internal server error" });
  }
} 