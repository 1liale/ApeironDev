import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, useClerk } from "@clerk/clerk-react";
import { toast } from "@/components/ui/sonner";
import HomePage from "./HomePage";

type InvitationStatus = "idle" | "processing" | "success" | "error";

/**
 * InvitationPage - A wrapper around HomePage that handles workspace invitation flows
 * 
 * This component renders the full HomePage UI while handling invitation logic in the background.
 * It uses Clerk's built-in modal system for authentication instead of custom dialogs.
 */
const InvitationPage = () => {
  const { invitationId } = useParams<{ invitationId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isSignedIn, getToken } = useAuth();
  const { openSignUp } = useClerk();

  const [invitationStatus, setInvitationStatus] = useState<InvitationStatus>("idle");
  const hasProcessedRef = useRef(false);

  const clerkTicket = searchParams.get('__clerk_ticket');
  const isFromClerkInvitation = !!clerkTicket;

  console.log(`[INVITATION] Invitation page loaded for ${invitationId}, signed in: ${isSignedIn}`);

  const processInvitation = async () => {
    if (!invitationId) {
      console.log(`[INVITATION] No invitation ID found`);
      toast.error("Invalid invitation link. Please check your email for the correct link.");
      setTimeout(() => navigate("/"), 2000);
      return;
    }

    if (!isSignedIn) {
      console.log(`[INVITATION] User not signed in, opening signup modal`);
      setInvitationStatus("idle");
      // Open Clerk's signup modal
      openSignUp({
        redirectUrl: window.location.href, // Stay on the same page after signup
      });
      return;
    }

    if (hasProcessedRef.current) {
      console.log(`[INVITATION] Already processed invitation ${invitationId}`);
      return;
    }

    console.log(`[INVITATION] Processing invitation ${invitationId}`);
    setInvitationStatus("processing");
    hasProcessedRef.current = true;

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Authentication token not available");
      }

      const response = await fetch(`/api/invitations/${invitationId}/validate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process the invitation");
      }

      console.log(`[INVITATION] Successfully processed invitation ${invitationId}`);
      setInvitationStatus("success");

      // Show success toast
      if (data.alreadyMember) {
        toast.success("You're already a member of this workspace!");
      } else {
        toast.success(`Successfully joined the workspace as ${data.assignedRole}!`);
      }

      // Redirect to workspace
      setTimeout(() => {
        navigate(`/workspaces/${data.workspaceId}`);
      }, 1500);

    } catch (error) {
      const e = error as Error;
      console.error(`[INVITATION] Error processing invitation ${invitationId}:`, e);
      
      setInvitationStatus("error");
      toast.error(e.message);
      
      // Reset processed flag so user can try again
      hasProcessedRef.current = false;
      
      // Redirect to home after error
      setTimeout(() => navigate("/"), 3000);
    }
  };

  // Handle invitation flow - combines processing and UI feedback
  useEffect(() => {
    if (!invitationId) {
      return;
    }

    // Show processing toast when status changes
    if (invitationStatus === "processing") {
      toast.loading("Processing your invitation...", {
        id: "invitation-processing",
      });
    } else {
      toast.dismiss("invitation-processing");
    }

    // Handle invitation processing based on auth state
    if (!hasProcessedRef.current) {
      if (isSignedIn && invitationStatus === "idle") {
        // User is signed in, process the invitation
        processInvitation();
      } else if (!isSignedIn) {
        // User needs to sign in/up
        console.log(`[INVITATION] Opening signup modal (Clerk email: ${isFromClerkInvitation})`);
        openSignUp({
          redirectUrl: window.location.href,
        });
      }
    }
  }, [invitationId, isSignedIn, invitationStatus, isFromClerkInvitation, openSignUp]);

  // Just render HomePage - all invitation logic happens in the background
  return <HomePage />;
};

export default InvitationPage; 