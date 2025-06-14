import { verifyToken } from "@clerk/backend";
import {
  getDb,
  getClerkClient,
} from "../../_lib/workspaceService.js";
import { v4 as uuidv4 } from "uuid";

// Helper function to validate invitation
async function validateInvitation(invitationId) {
  console.log(`[VALIDATE] Checking invitation ${invitationId}`);
  const db = getDb();
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

  return invitation;
}

// Helper function to check if user is already a member
async function checkExistingMembership(userId, workspaceId) {
  const db = getDb();
  const membershipQuery = await db
    .collection("workspace_memberships")
    .where("user_id", "==", userId)
    .where("workspace_id", "==", workspaceId)
    .limit(1)
    .get();

  return !membershipQuery.empty ? membershipQuery.docs[0].data() : null;
}

// Helper function to create workspace membership
async function createWorkspaceMembership(userId, workspaceId, role, userInfo) {
  const db = getDb();
  console.log(`[VALIDATE] Creating membership for user ${userId} in workspace ${workspaceId} with role ${role}`);
  
  const membershipId = uuidv4();
  const membership = {
    membership_id: membershipId,
    user_id: userId,
    user_email: userInfo.emailAddresses?.[0]?.emailAddress || "",
    user_name: `${userInfo.firstName || ""} ${userInfo.lastName || ""}`.trim() || userInfo.emailAddresses?.[0]?.emailAddress || "",
    workspace_id: workspaceId,
    role: role,
    joined_at: new Date().toISOString(),
  };

  await db
    .collection("workspace_memberships")
    .doc(membershipId)
    .set(membership);

  console.log(`[VALIDATE] Created membership for user ${userId} in workspace ${workspaceId}`);
  return membership;
}

// Helper function to handle invitation after acceptance
async function handleInvitationAfterAcceptance(invitationId, invitationType, userEmail, workspaceId) {
  const db = getDb();
  
    if (invitationType === "email") {
    // Delete the accepted email invitation
    await db.collection("workspace_invitations").doc(invitationId).delete();
    console.log(`[VALIDATE] Deleted email invitation ${invitationId} after acceptance`);
  }

  // Clean up any other pending email invitations for this user in this workspace
  const pendingInvitationsQuery = await db
    .collection("workspace_invitations")
    .where("workspace_id", "==", workspaceId)
    .where("invitee_email", "==", userEmail)
    .where("invitation_type", "==", "email")
    .where("status", "==", "pending")
    .get();

  if (!pendingInvitationsQuery.empty) {
    const batch = db.batch();
    pendingInvitationsQuery.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`[VALIDATE] Cleaned up ${pendingInvitationsQuery.docs.length} pending email invitation(s) for ${userEmail} in workspace ${workspaceId}`);
  }
}

export default async function handler(req, res) {  
  console.log(`[VALIDATE] ${req.method} request for invitation validation`);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { invitationId } = req.query;
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) return res.status(401).json({ error: "Authentication token required" });
  if (!invitationId) return res.status(400).json({ error: "Invitation ID is required" });
  
  try {
    const clerkClient = getClerkClient();
    
    // Verify the user's token
    const verifiedToken = await verifyToken(token, { 
      secretKey: process.env.CLERK_SECRET_KEY 
    });
    
    if (!verifiedToken?.sub) {
      return res.status(401).json({ error: "Invalid session token" });
    }

    const userId = verifiedToken.sub;
    console.log(`[VALIDATE] User ${userId} validating invitation ${invitationId}`);

    // Get user info for membership creation
    const userInfo = await clerkClient.users.getUser(userId);

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

    // For email invitations, validate the email matches
    if (invitation.invitation_type === "email" && invitation.invitee_email) {
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
      userInfo
    );

    // Handle invitation after acceptance (delete email invites, increment usage for links, cleanup other pending invites)
    const userEmail = userInfo.emailAddresses?.[0]?.emailAddress;
    await handleInvitationAfterAcceptance(invitationId, invitation.invitation_type, userEmail, invitation.workspace_id);

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
      errorMessage.includes("already been used") ? 409 :
      errorMessage.includes("different email") ? 403 :
      500;

    return res.status(statusCode).json({ error: errorMessage });
  }
}
