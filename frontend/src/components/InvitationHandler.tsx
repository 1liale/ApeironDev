import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";

const InvitationHandler = () => {
  const { invitationId } = useParams<{ invitationId: string }>();
  const { getToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleAcceptance = async () => {
      if (!invitationId) {
        sessionStorage.setItem(
          "invitation_status",
          JSON.stringify({
            status: "error",
            message: "No invitation ID found in the URL.",
          })
        );
        navigate("/");
        return;
      }

      try {
        const token = await getToken();
        if (!token) {
          throw new Error("You must be signed in to accept an invitation.");
        }

        const response = await fetch(
          `/api/invitations/${invitationId}/accept`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to accept the invitation.");
        }
        
        sessionStorage.setItem(
          "invitation_status",
          JSON.stringify({
            status: "success",
            message: "Successfully joined the workspace!",
          })
        );
        navigate(`/${data.workspaceId}`);
      } catch (error) {
        const e = error as Error;
        sessionStorage.setItem(
          "invitation_status",
          JSON.stringify({
            status: "error",
            message: e.message,
          })
        );
        navigate("/");
      }
    };

    handleAcceptance();
  }, [invitationId, getToken, navigate]);

  // This component renders nothing. It's purely for logic and redirection.
  return null;
};

export default InvitationHandler; 