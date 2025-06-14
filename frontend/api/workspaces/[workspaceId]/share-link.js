import { verifyToken } from "@clerk/backend";
import { v4 as uuidv4 } from "uuid";
import {
  db,
  checkWorkspaceOwnerPermission,
  getInviterInfo,
} from "../../_lib/workspaceService.js";

async function getOrCreateShareableInvite(workspaceId, role, inviterId, inviterInfo) {
  // For shareable links, we look for active (not pending) invitations that haven't expired
  const existingQuery = await db
    .collection("workspace_invitations")
    .where("workspace_id", "==", workspaceId)
    .where("invitee_role", "==", role)
    .where("invitation_type", "==", "shareable_link")
    .where("status", "==", "active")
    .get();

  // Check if we have a valid, non-expired shareable link
  for (const doc of existingQuery.docs) {
    const invitation = doc.data();
    if (new Date(invitation.expires_at) > new Date()) {
      return invitation; // Return existing valid link
    } else {
      // Clean up expired link
      await db.collection("workspace_invitations").doc(doc.id).delete();
    }
  }

  const invitationId = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const newInvitation = {
    invitation_id: invitationId,
    workspace_id: workspaceId,
    invitee_email: null, // Shareable links don't have specific emails
    invitee_role: role,
    inviter_id: inviterId,
    inviter_email: inviterInfo.email,
    inviter_name: inviterInfo.name,
    status: "active", // Shareable links are "active", not "pending"
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    invitation_type: "link",
    usage_count: 0, // Track how many times this link has been used
  };

  await db.collection("workspace_invitations").doc(invitationId).set(newInvitation);
  return newInvitation;
}

export default async function handler(req, res) {
  console.log(`[SHARE-LINK] ${req.method} request received`);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { workspaceId } = req.query;
  const { role } = req.body;
  const token = req.headers.authorization?.replace("Bearer ", "");

  console.log(`[SHARE-LINK] Request for workspace: ${workspaceId}, role: ${role}`);

  if (!token) return res.status(401).json({ error: "Authentication token required." });
  if (!role) return res.status(400).json({ error: "Role is required." });
  if (!["viewer", "editor", "owner"].includes(role)) return res.status(400).json({ error: "Invalid role specified." });

  try {
    const verifiedToken = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    if (!verifiedToken?.sub) return res.status(401).json({ error: "Invalid session token." });
    
    const userId = verifiedToken.sub;
    console.log(`[SHARE-LINK] User ${userId} requesting link for workspace ${workspaceId}`);
    
    const hasPermission = await checkWorkspaceOwnerPermission(userId, workspaceId);
    if (!hasPermission) {
      console.log(`[SHARE-LINK] Permission denied for user ${userId} on workspace ${workspaceId}`);
      return res.status(403).json({ error: "You don't have permission to create invite links." });
    }

    const inviterInfo = await getInviterInfo(userId);
    const invitation = await getOrCreateShareableInvite(workspaceId, role, userId, inviterInfo);
    
    console.log(`[SHARE-LINK] Generated/retrieved invitation ${invitation.invitation_id} for workspace ${workspaceId}`);
    
    const baseUrl = process.env.APP_BASE_URL || 'https://www.apeirondev.tech';
    const shareableLink = `${baseUrl}/invitations/${invitation.invitation_id}`;

    return res.status(200).json({
      success: true,
      message: "Shareable link retrieved successfully.",
      invitation: {
        shareable_link: shareableLink,
        invitee_role: invitation.invitee_role,
        expires_at: invitation.expires_at,
      },
    });
  } catch (error) {
    console.error(`[SHARE-LINK] Error for workspace ${workspaceId}:`, error);
    return res.status(500).json({ error: "Internal server error." });
  }
} 