import { verifyToken } from "@clerk/backend";
import {
  db,
  clerkClient,
} from "../../_lib/workspaceService.js";

// Helper function to validate invitation
async function validateInvitation(invitationId) {
  console.log(`[VALIDATE] Checking invitation ${invitationId}`);
  
  const invitationDoc = await db
    .collection("workspace_invitations")
    .doc(invitationId)
    .get();

  if (!invitationDoc.exists) {
    console.log(`[VALIDATE] Invitation ${invitationId} not found`);
    throw new Error("Invitation not found");
  }

  const invitation = invitationDoc.data();
  const now = new Date();
  const expiresAt = new Date(invitation.expires_at);

  if (expiresAt <= now) {
    console.log(`[VALIDATE] Invitation ${invitationId} expired at ${invitation.expires_at}`);
    throw new Error("Invitation has expired");
  }

  // For email invitations, check if already accepted
  if (invitation.invitation_type === "email" && invitation.status !== "pending") {
    console.log(`[VALIDATE] Email invitation ${invitationId} already ${invitation.status}`);
    throw new Error("Invitation has already been processed");
  }

  // For link invitations, they should be active
  if (invitation.invitation_type === "link" && invitation.status !== "active") {
    console.log(`[VALIDATE] Link invitation ${invitationId} is not active (status: ${invitation.status})`);
    throw new Error("Invitation link is not active");
  }

  console.log(`[VALIDATE] Invitation ${invitationId} is valid (type: ${invitation.invitation_type}, role: ${invitation.invitee_role})`);
  return invitation;
}

// Helper function to check if user is already a member
async function checkExistingMembership(userId, workspaceId) {
  const membershipQuery = await db
    .collection("workspace_memberships")
    .where("user_id", "==", userId)
    .where("workspace_id", "==", workspaceId)
    .limit(1)
    .get();

  return !membershipQuery.empty ? membershipQuery.docs[0].data() : null;
}

// Helper function to create workspace membership
async function createWorkspaceMembership(userId, workspaceId, role, invitationId) {
  console.log(`[VALIDATE] Creating membership for user ${userId} in workspace ${workspaceId} with role ${role}`);
  
  const membership = {
    user_id: userId,
    workspace_id: workspaceId,
    role: role,
    joined_at: new Date().toISOString(),
    invited_by_invitation_id: invitationId,
  };

  await db
    .collection("workspace_memberships")
    .add(membership);

  console.log(`[VALIDATE] Created membership for user ${userId} in workspace ${workspaceId}`);
  return membership;
}

// Helper function to update invitation status
async function updateInvitationStatus(invitationId, invitationType, userId = null) {
  const updates = {};
  
  if (invitationType === "email") {
    // Email invitations become "accepted" and are consumed
    updates.status = "accepted";
    updates.accepted_at = new Date().toISOString();
    updates.accepted_by_user_id = userId;
  } else if (invitationType === "link") {
    // Link invitations increment usage count but stay active
    const invitationDoc = await db.collection("workspace_invitations").doc(invitationId).get();
    const currentUsageCount = invitationDoc.data()?.usage_count || 0;
    updates.usage_count = currentUsageCount + 1;
    updates.last_used_at = new Date().toISOString();
    updates.last_used_by_user_id = userId;
  }

  await db
    .collection("workspace_invitations")
    .doc(invitationId)
    .update(updates);

  console.log(`[VALIDATE] Updated invitation ${invitationId} status for ${invitationType} type`);
}

export default async function handler(req, res) {
  console.log(`[VALIDATE] ${req.method} request for invitation validation`);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { invitationId } = req.query;
  const token = req.headers.authorization?.replace("Bearer ", "");

  console.log(`[VALIDATE] Processing invitation ${invitationId}`);

  if (!token) {
    return res.status(401).json({ error: "Authentication token required" });
  }

  if (!invitationId) {
    return res.status(400).json({ error: "Invitation ID is required" });
  }

  try {
    // Verify the user's token
    const verifiedToken = await verifyToken(token, { 
      secretKey: process.env.CLERK_SECRET_KEY 
    });
    
    if (!verifiedToken?.sub) {
      return res.status(401).json({ error: "Invalid session token" });
    }

    const userId = verifiedToken.sub;
    console.log(`[VALIDATE] User ${userId} validating invitation ${invitationId}`);

    // Validate the invitation
    const invitation = await validateInvitation(invitationId);

    // Check if user is already a member of this workspace
    const existingMembership = await checkExistingMembership(userId, invitation.workspace_id);
    if (existingMembership) {
      console.log(`[VALIDATE] User ${userId} already member of workspace ${invitation.workspace_id} with role ${existingMembership.role}`);
      return res.status(200).json({
        success: true,
        message: "You are already a member of this workspace",
        workspaceId: invitation.workspace_id,
        currentRole: existingMembership.role,
        alreadyMember: true,
      });
    }

    // For email invitations, validate the email matches (if specified)
    if (invitation.invitation_type === "email" && invitation.invitee_email) {
      const userInfo = await clerkClient.users.getUser(userId);
      const userEmail = userInfo.emailAddresses?.[0]?.emailAddress;
      
      if (userEmail !== invitation.invitee_email) {
        console.log(`[VALIDATE] Email mismatch: expected ${invitation.invitee_email}, got ${userEmail}`);
        return res.status(403).json({ 
          error: "This invitation was sent to a different email address" 
        });
      }
    }

    // Create workspace membership
    await createWorkspaceMembership(
      userId, 
      invitation.workspace_id, 
      invitation.invitee_role, 
      invitationId
    );

    // Update invitation status
    await updateInvitationStatus(invitationId, invitation.invitation_type, userId);

    console.log(`[VALIDATE] Successfully processed invitation ${invitationId} for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: "Successfully joined the workspace!",
      workspaceId: invitation.workspace_id,
      assignedRole: invitation.invitee_role,
      alreadyMember: false,
    });

  } catch (error) {
    console.error(`[VALIDATE] Error processing invitation ${invitationId}:`, error);
    
    // Return appropriate error messages
    const errorMessage = error.message || "Internal server error";
    const statusCode = 
      errorMessage.includes("not found") ? 404 :
      errorMessage.includes("expired") ? 410 :
      errorMessage.includes("already been processed") ? 409 :
      errorMessage.includes("different email") ? 403 :
      500;

    return res.status(statusCode).json({ error: errorMessage });
  }
}
