package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	cloudtasks "cloud.google.com/go/cloudtasks/apiv2"
	cloudtaskspb "cloud.google.com/go/cloudtasks/apiv2/cloudtaskspb"
	"cloud.google.com/go/firestore"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"google.golang.org/api/iterator"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// checkWorkspaceMembership queries Firestore to see if a user is a member of a workspace.
func checkWorkspaceMembership(ctx context.Context, fsClient *firestore.Client, userID string, workspaceID string) (bool, error) {
	logCtx := log.WithFields(log.Fields{
		"user_id":      userID,
		"workspace_id": workspaceID,
		"function":     "checkWorkspaceMembership",
	})

	query := fsClient.Collection("workspace_memberships").
		Where("user_id", "==", userID).
		Where("workspace_id", "==", workspaceID).
		Limit(1)

	iter := query.Documents(ctx)
	defer iter.Stop()

	_, err := iter.Next()
	if err == iterator.Done {
		logCtx.Info("User is not a member of the workspace.")
		return false, nil // No document found, so user is not a member
	}
	if err != nil {
		logCtx.WithError(err).Error("Failed to query workspace membership.")
		return false, fmt.Errorf("failed to query workspace membership: %w", err)
	}

	logCtx.Info("User is a member of the workspace.")
	return true, nil // Document found, user is a member
}

// ApiController holds dependencies for HTTP handlers.
type ApiController struct {
	FirestoreClient         *firestore.Client
	TasksClient             *cloudtasks.Client
	R2PresignClient         *s3.PresignClient
	R2S3Client              *s3.Client
	R2BucketName            string
	PythonWorkerURL         string
	WorkerSAEmail           string
	CloudTasksQueuePath     string
	FirestoreJobsCollection string
}

// NewApiController creates a new ApiController.
func NewApiController(fs *firestore.Client, tasksClient *cloudtasks.Client, presignClient *s3.PresignClient, r2S3Client *s3.Client, r2BucketName, pythonWorkerURL, workerSAEmail, cloudTasksQueuePath, firestoreJobsCollection string) *ApiController {
	return &ApiController{
		FirestoreClient:         fs,
		TasksClient:             tasksClient,
		R2PresignClient:         presignClient,
		R2S3Client:              r2S3Client,
		R2BucketName:            r2BucketName,
		PythonWorkerURL:         pythonWorkerURL,
		WorkerSAEmail:           workerSAEmail,
		CloudTasksQueuePath:     cloudTasksQueuePath,
		FirestoreJobsCollection: firestoreJobsCollection,
	}
}

// HandleSync processes a batch of client file states, compares with Firestore, 
// and returns necessary actions (like generating pre-signed URLs for uploads/deletes).
// This is phase 1 of 2PC.
func (ac *ApiController) HandleSync(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID") // Get userID from context set by AuthMiddleware
	if userID == "" {
		log.Error("UserID not found in context or is empty after auth middleware. This should not happen if middleware is effective.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "User authentication error"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"workspace_id": workspaceID,
		"user_id":      userID,
		"handler":      "HandleSync",
	})

	// Authorization check
	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User does not have access to this workspace.")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to this workspace"})
		return
	}
	logCtx.Info("User authorized for workspace access.") // Log successful authorization

	var req SyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logCtx.WithError(err).Warn("Invalid request body")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	if len(req.Files) == 0 {
		logCtx.Info("Request received with no files to sync.")
		c.JSON(http.StatusOK, SyncResponse{Actions: []SyncResponseFileAction{}})
		return
	}

	ctx := c.Request.Context()

	wsDocRef := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID)
	wsDocSnap, err := wsDocRef.Get(ctx)
	if err != nil {
		logCtx.WithError(err).Errorf("Failed to get workspace %s for OCC check", workspaceID)
		c.JSON(http.StatusNotFound, gin.H{"error": "Workspace not found for sync"})
		return
	}
	var currentServerWorkspace Workspace
	if err := wsDocSnap.DataTo(&currentServerWorkspace); err != nil {
		logCtx.WithError(err).Errorf("Failed to parse workspace data for %s (OCC check)", workspaceID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse server workspace data"})
		return
	}

	if req.WorkspaceVersion != currentServerWorkspace.WorkspaceVersion {
		logCtx.Warnf("Workspace version conflict. Client: %s, Server: %s", req.WorkspaceVersion, currentServerWorkspace.WorkspaceVersion)
		c.JSON(http.StatusConflict, SyncResponse{
			Status:              "workspace_conflict",
			Actions:             []SyncResponseFileAction{},
			NewWorkspaceVersion: currentServerWorkspace.WorkspaceVersion,
			ErrorMessage:        "Workspace version conflict. Please refresh.",
		})
		return
	}

	responseActions := make([]SyncResponseFileAction, 0, len(req.Files))
	presignDuration := 15 * time.Minute
	filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)

	for _, clientFile := range req.Files {
		r2ObjectKey := "" // Will be determined based on whether it's new or existing
		currentAction := SyncResponseFileAction{
			FilePath:    clientFile.FilePath,
			// R2ObjectKey will be set below
		}
		itemLogCtx := logCtx.WithField("filePath", clientFile.FilePath)

		switch clientFile.Action {
		case "new", "modified":
			var serverMeta FileMetadata
			foundServerMeta := false
			serverHash := ""

			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()

			if err != nil {
				itemLogCtx.WithError(err).Error("Firestore query failed for existing file metadata.")
			} else if len(docs) > 0 {
				if err := docs[0].DataTo(&serverMeta); err == nil {
					foundServerMeta = true
					serverHash = serverMeta.Hash
					r2ObjectKey = serverMeta.R2ObjectKey // Use existing R2 key for modified files
				} else {
					itemLogCtx.WithError(err).Error("Error unmarshalling Firestore data for existing file.")
				}
			}
			currentAction.R2ObjectKey = r2ObjectKey // Set it for the response action

			if clientFile.Action == "new" || !foundServerMeta || (clientFile.Action == "modified" && clientFile.ClientHash != serverHash) {
				if clientFile.Action == "new" || r2ObjectKey == "" { // Ensure a unique R2 key for new files or if not found
					currentAction.R2ObjectKey = fmt.Sprintf("workspaces/%s/files/%s/%s", workspaceID, uuid.New().String(), filepath.Base(clientFile.FilePath))
				}

				presignedPutURL, presignErr := ac.R2PresignClient.PresignPutObject(ctx, &s3.PutObjectInput{
					Bucket: aws.String(ac.R2BucketName),
					Key:    aws.String(currentAction.R2ObjectKey),
				}, func(po *s3.PresignOptions) {
					po.Expires = presignDuration
				})
				if presignErr != nil {
					itemLogCtx.WithError(presignErr).Error("Failed to generate PUT URL for sync.")
					currentAction.ActionRequired = "none"
					currentAction.Message = "Error generating upload URL"
				} else {
					currentAction.ActionRequired = "upload"
					currentAction.PresignedURL = presignedPutURL.URL
				}
			} else {
				currentAction.ActionRequired = "none"
				currentAction.Message = "File up to date or hash matches"
			}

		case "deleted":
			// Fetch R2ObjectKey for deletion from server's metadata
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()
			if err != nil || len(docs) == 0 {
				itemLogCtx.WithError(err).Warn("File metadata not found for deletion.")
				currentAction.ActionRequired = "none"
				currentAction.Message = "File to delete not found on server."
			} else {
				var serverMeta FileMetadata
				if err := docs[0].DataTo(&serverMeta); err == nil {
					currentAction.R2ObjectKey = serverMeta.R2ObjectKey
				currentAction.ActionRequired = "delete"
					itemLogCtx.Info("Marked for deletion. Server will delete on confirm.")
				} else {
					itemLogCtx.WithError(err).Error("Error unmarshalling Firestore data for file to delete.")
					currentAction.ActionRequired = "none"
					currentAction.Message = "Server error processing delete request."
				}
			}

		case "unchanged":
			currentAction.ActionRequired = "none"
			currentAction.Message = "File unchanged as per client"
			// We still need to ensure R2ObjectKey is in the response for client consistency, if known
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(ctx).GetAll()
			if err == nil && len(docs) > 0 {
				var serverMeta FileMetadata
				if docs[0].DataTo(&serverMeta) == nil {
					currentAction.R2ObjectKey = serverMeta.R2ObjectKey
				}
			}

		default:
			itemLogCtx.WithField("action", clientFile.Action).Warn("Unknown action in sync request for file.")
			currentAction.ActionRequired = "none"
			currentAction.Message = "Unknown action specified"
		}
		responseActions = append(responseActions, currentAction)
	}

	var newTentativeVersion string
	currentVersionStr := currentServerWorkspace.WorkspaceVersion
	if currentVersionStr == "" {
		// This case implies an unversioned workspace on the server.
		// If req.WorkspaceVersion (client's version) was also "", the OCC check above passed.
		// So, this can be considered the first versioning action.
		newTentativeVersion = "1"
		logCtx.Infof("Workspace %s is currently unversioned. Initializing tentative version to '1'.", workspaceID)
	} else {
		currentVersionInt, err := strconv.Atoi(currentVersionStr)
		if err != nil {
			logCtx.WithError(err).Errorf("Failed to parse current workspace version '%s' to int for incrementing. Workspace ID: %s", currentVersionStr, workspaceID)
			c.JSON(http.StatusInternalServerError, SyncResponse{
				Status:       "error",
				Actions:      responseActions, // Send actions processed so far, though client should probably discard on error
				ErrorMessage: fmt.Sprintf("Server error: Invalid current workspace version format ('%s') on workspace %s. Cannot proceed with sync.", currentVersionStr, workspaceID),
			})
			return
		}
		newTentativeVersion = strconv.Itoa(currentVersionInt + 1)
		logCtx.Infof("Incremented workspace version from '%s' to tentative '%s' for workspace %s.", currentVersionStr, newTentativeVersion, workspaceID)
	}

	// If no files were in the request, but the version check passed, it's "no_changes".
	if len(req.Files) == 0 {
		logCtx.Info("HandleSync: No files in request, version matches. Responding with no_changes.")
		c.JSON(http.StatusOK, SyncResponse{
			Status:              "no_changes",
			Actions:             []SyncResponseFileAction{},
			NewWorkspaceVersion: currentServerWorkspace.WorkspaceVersion, // Return current server version
		})
		return
	}

	// Check if any actual changes are proposed by the client for files that require action
	actualChangesProposed := false
	for _, action := range responseActions {
		if action.ActionRequired == "upload" || action.ActionRequired == "delete" {
			actualChangesProposed = true
			break
		}
	}

	if !actualChangesProposed {
		logCtx.Info("HandleSync: No effective changes required after processing files (all 'none' or client-side issues).")
		c.JSON(http.StatusOK, SyncResponse{
			Status:              "no_changes",
			Actions:             responseActions, // Return the actions, even if they are all 'none'
			NewWorkspaceVersion: currentServerWorkspace.WorkspaceVersion, // No version change if no effective file changes
		})
		return
	}

	logCtx.WithField("processed_files_count", len(req.Files)).WithField("new_tentative_version", newTentativeVersion).Info("HandleSync request processed, pending confirmation.")
	c.JSON(http.StatusOK, SyncResponse{
		Status:              "pending_confirmation",
		Actions:             responseActions,
		NewWorkspaceVersion: newTentativeVersion,
	})
}

// ConfirmSync handles the commit phase of the 2PC file synchronization.
func (ac *ApiController) ConfirmSync(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID")

	logCtx := log.WithFields(log.Fields{
		"workspace_id": workspaceID,
		"user_id":      userID,
		"handler":      "ConfirmSync",
	})

	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User forbidden from accessing workspace.")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to this workspace"})
		return
	}
	logCtx.Info("User authorized for workspace access.")

	var req ConfirmSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logCtx.WithError(err).Warn("Invalid request body for ConfirmSync")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	finalVersionToCommit := req.NewWorkspaceVersion

	results := make([]ConfirmSyncResponseItem, 0, len(req.Actions))
	var overallErrorMessage string

	err = ac.FirestoreClient.RunTransaction(c.Request.Context(), func(ctx context.Context, tx *firestore.Transaction) error {
		wsRef := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID)
		wsDoc, err := tx.Get(wsRef)
		if err != nil {
			logCtx.WithError(err).Error("Transaction: Failed to get workspace document for version check.")
			return fmt.Errorf("could not retrieve workspace for confirmation: %w", err)
		}

		var workspaceData Workspace
		if err := wsDoc.DataTo(&workspaceData); err != nil {
			logCtx.WithError(err).Error("Transaction: Failed to parse workspace data.")
			return fmt.Errorf("could not parse workspace data: %w", err)
		}

		if workspaceData.WorkspaceVersion != req.BaseVersion {
			logCtx.Warnf("Transaction: Aborting due to version conflict. Client base: %s, Server current: %s", req.BaseVersion, workspaceData.WorkspaceVersion)
			return fmt.Errorf("workspace_conflict")
		}

		filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)
		var transactionError error

		for _, fileConfirm := range req.Actions {
			itemLogCtx := logCtx.WithField("filePath", fileConfirm.FilePath)
			responseItem := ConfirmSyncResponseItem{FilePath: fileConfirm.FilePath}

			if fileConfirm.Status != "success" {
				itemLogCtx.WithField("client_error", fileConfirm.Error).Warn("Client reported failed operation for file.")
				responseItem.Status = "confirmation_skipped_client_failure"
				responseItem.Message = fmt.Sprintf("Client reported operation failed: %s", fileConfirm.Error)
				results = append(results, responseItem)
				continue
			}

			var existingDocRef *firestore.DocumentRef
			var existingMetaData FileMetadata
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("file_path", "==", fileConfirm.FilePath).Limit(1)

			docs, qErr := tx.Documents(query).GetAll()
			if qErr != nil {
				itemLogCtx.WithError(qErr).Error("Transaction: Firestore query failed for file metadata.")
				responseItem.Status = "confirmation_failed_server_error"
				responseItem.Message = "Server error querying file metadata."
				results = append(results, responseItem)
				transactionError = qErr
				break
			}
			if len(docs) > 0 {
				existingDocRef = docs[0].Ref
				if errData := docs[0].DataTo(&existingMetaData); errData != nil {
					itemLogCtx.WithError(errData).Warn("Failed to parse existing metadata, CreatedAt might be reset.")
				}
			}

			switch fileConfirm.ActionConfirmed {
			case "uploaded":
				if fileConfirm.ClientHash == "" {
					itemLogCtx.Warn("Missing clientHash for uploaded file confirmation.")
					responseItem.Status = "confirmation_failed_missing_data"
					responseItem.Message = "Missing essential data (hash) for uploaded file."
					transactionError = fmt.Errorf("missing data for uploaded file %s", fileConfirm.FilePath)
					break
				}
				fileMetadata := FileMetadata{
					FileName:    filepath.Base(fileConfirm.FilePath),
					FilePath:    fileConfirm.FilePath,
					R2ObjectKey: fileConfirm.R2ObjectKey,
					Size:        fileConfirm.Size,
					ContentType: fileConfirm.ContentType,
					UserID:      userID,
					WorkspaceID: workspaceID,
					Hash:        fileConfirm.ClientHash,
					UpdatedAt:   time.Now().UTC(),
				}
				var firestoreErr error
				if existingDocRef != nil {
					fileMetadata.CreatedAt = existingMetaData.CreatedAt
					if fileMetadata.CreatedAt.IsZero() {
						fileMetadata.CreatedAt = time.Now().UTC()
					}
					firestoreErr = tx.Set(existingDocRef, fileMetadata)
					responseItem.FileID = existingDocRef.ID
				} else {
					newFileID := uuid.New().String()
					fileMetadata.FileID = newFileID
					fileMetadata.CreatedAt = time.Now().UTC()
					newDocRef := ac.FirestoreClient.Collection(filesCollectionPath).Doc(newFileID)
					firestoreErr = tx.Set(newDocRef, fileMetadata)
					responseItem.FileID = newFileID
				}
				if firestoreErr != nil {
					itemLogCtx.WithError(firestoreErr).Error("Transaction: Failed to set file metadata in Firestore.")
					responseItem.Status = "confirmation_failed_firestore_error"
					responseItem.Message = "Failed to update/create file metadata."
					transactionError = firestoreErr
				} else {
					responseItem.Status = "metadata_updated_or_created"
				}

			case "deleted":
				if fileConfirm.R2ObjectKey == "" {
					itemLogCtx.Warn("Missing R2ObjectKey for deleted file confirmation.")
				}

				if existingDocRef != nil {
					if fileConfirm.R2ObjectKey != "" {
						_, r2Err := ac.R2S3Client.DeleteObject(c.Request.Context(), &s3.DeleteObjectInput{
							Bucket: aws.String(ac.R2BucketName),
							Key:    aws.String(fileConfirm.R2ObjectKey),
						})
						if r2Err != nil {
							var nsk *types.NoSuchKey
							if errors.As(r2Err, &nsk) {
								itemLogCtx.Warnf("R2 object %s not found for deletion, already deleted?", fileConfirm.R2ObjectKey)
								responseItem.Status = "r2_object_not_found_assumed_deleted"
							} else {
								itemLogCtx.WithError(r2Err).Errorf("Failed to delete object %s from R2.", fileConfirm.R2ObjectKey)
								responseItem.Status = "confirmation_failed_r2_delete"
								responseItem.Message = "Server failed to delete file from storage: " + r2Err.Error()
								transactionError = r2Err
								break
							}
						}
					}
					fsErr := tx.Delete(existingDocRef)
					if fsErr != nil {
						itemLogCtx.WithError(fsErr).Error("Transaction: Failed to delete file metadata.")
						responseItem.Status = "confirmation_failed_firestore_delete"
						responseItem.Message = "Failed to delete file metadata."
						transactionError = fsErr
					} else {
						responseItem.Status = "metadata_deleted"
					}
				} else {
					itemLogCtx.Warn("File metadata not found for deletion, assuming already deleted.")
					responseItem.Status = "metadata_not_found_assumed_deleted"
				}
			}
			results = append(results, responseItem)
			if transactionError != nil {
				break
			}
		}

		if transactionError != nil {
			overallErrorMessage = transactionError.Error()
			return transactionError
		}

		return tx.Update(wsRef, []firestore.Update{
			{Path: "workspace_version", Value: finalVersionToCommit},
		})
	})

	if err != nil {
		logCtx.WithError(err).Error("ConfirmSync transaction failed.")
		if strings.Contains(err.Error(), "workspace_conflict") {
			c.JSON(http.StatusConflict, ConfirmSyncResponse{
				Status:       "error",
				ErrorMessage: "Workspace was updated by another session. Please refresh and try again.",
			})
		} else {
			c.JSON(http.StatusInternalServerError, ConfirmSyncResponse{
				Status:       "error",
				Results:      results,
				ErrorMessage: "A server error occurred during final confirmation: " + overallErrorMessage,
			})
		}
		return
	}

	logCtx.WithField("final_version", finalVersionToCommit).Info("ConfirmSync successful.")
	c.JSON(http.StatusOK, ConfirmSyncResponse{
		Status:                "success",
		Results:               results,
		FinalWorkspaceVersion: finalVersionToCommit,
	})
}

// SanitizePathToDocID converts a file path to a Firestore-safe document ID.
func SanitizePathToDocID(path string) string {
	sanitized := strings.ReplaceAll(path, "/", "__SLASH__")
	sanitized = strings.ReplaceAll(sanitized, ".", "__DOT__")
	if len(sanitized) > 500 { 
		sanitized = sanitized[:500]
	}
	return sanitized
}

// ExecuteCode handles non-authenticated code execution requests.
func (ac *ApiController) ExecuteCode(c *gin.Context) {
	var reqBody RequestBody 
	if err := c.ShouldBindJSON(&reqBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	jobID := uuid.New().String()
	ctx := c.Request.Context()

	submittedAt := time.Now().UTC()
	expiresAt := submittedAt.Add(15 * 24 * time.Hour) 

	job := Job{
		Status:      "queued",
		Code:        reqBody.Code,
		Language:    reqBody.Language,
		Input:       reqBody.Input,
		SubmittedAt: submittedAt,
		ExpiresAt:   expiresAt,
	}

	docRef := ac.FirestoreClient.Collection(ac.FirestoreJobsCollection).Doc(jobID)
	if _, err := docRef.Set(ctx, job); err != nil {
		log.WithError(err).WithField("job_id", jobID).Error("Failed to create job in Firestore")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create job record"})
		return
	}
	log.WithFields(log.Fields{"job_id": jobID, "language": job.Language}).Info("Job queued in Firestore for public execution")

	taskPayload := CloudTaskPayload{ 
		JobID: jobID, Code: reqBody.Code, Language: reqBody.Language, Input: reqBody.Input,
	}
	payloadBytes, err := json.Marshal(taskPayload)
	if err != nil {
		log.WithError(err).WithField("job_id", jobID).Error("Failed to marshal task payload for public execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare job for execution"})
		return
	}

	taskReq := &cloudtaskspb.CreateTaskRequest{
		Parent: ac.CloudTasksQueuePath,
		Task: &cloudtaskspb.Task{
			MessageType: &cloudtaskspb.Task_HttpRequest{
				HttpRequest: &cloudtaskspb.HttpRequest{
					HttpMethod: cloudtaskspb.HttpMethod_POST,
					Url:        fmt.Sprintf("%s/execute", ac.PythonWorkerURL),
					Headers:    map[string]string{"Content-Type": "application/json"},
					Body:       payloadBytes,
					AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
						OidcToken: &cloudtaskspb.OidcToken{
							ServiceAccountEmail: ac.WorkerSAEmail,
						},
					},
				},
			},
			DispatchDeadline: durationpb.New(10 * time.Minute),
			ScheduleTime:     timestamppb.New(time.Now().UTC().Add(1 * time.Second)),
		},
	}

	createdTask, err := ac.TasksClient.CreateTask(ctx, taskReq)
	if err != nil {
		log.WithError(err).WithField("job_id", jobID).Error("Failed to create Cloud Task for public execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit job for execution"})
		return
	}

	log.WithFields(log.Fields{"job_id": jobID, "task_name": createdTask.GetName()}).Info("Job enqueued to Cloud Tasks for public execution")
	c.JSON(http.StatusOK, gin.H{"job_id": jobID})
}

// GetWorkspaceManifest handles requests to list all file metadata for a given workspace.
func (ac *ApiController) GetWorkspaceManifest(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID")

	if userID == "" {
		log.Error("UserID not found in context for GetWorkspaceManifest")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"workspace_id": workspaceID,
		"user_id":      userID,
		"handler":      "GetWorkspaceManifest",
	})

	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed for GetWorkspaceManifest.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User forbidden from listing files in workspace.")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to list files in this workspace"})
		return
	}
	logCtx.Info("User authorized for listing files in workspace.")

	ctx := c.Request.Context()

	wsDocRef := ac.FirestoreClient.Collection("workspaces").Doc(workspaceID)
	wsDocSnap, err := wsDocRef.Get(ctx)
	if err != nil {
		logCtx.WithError(err).Errorf("Failed to get workspace document %s", workspaceID)
		c.JSON(http.StatusNotFound, gin.H{"error": "Workspace not found"})
		return
	}
	var workspaceData Workspace
	if err := wsDocSnap.DataTo(&workspaceData); err != nil {
		logCtx.WithError(err).Errorf("Failed to parse workspace data for %s", workspaceID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse workspace data"})
		return
	}

	filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)
	iter := ac.FirestoreClient.Collection(filesCollectionPath).Documents(ctx)
	defer iter.Stop()

	var files []FileMetadata
	presignDuration := 15 * time.Minute

	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			logCtx.WithError(err).Error("Failed to iterate over file documents in Firestore")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve file list"})
			return
		}

		var fileMeta FileMetadata
		if err := doc.DataTo(&fileMeta); err != nil {
			logCtx.WithError(err).WithField("document_id", doc.Ref.ID).Warn("Failed to parse file metadata from Firestore document")
			continue
		}

		if fileMeta.R2ObjectKey != "" {
			presignedURLRequest, presignErr := ac.R2PresignClient.PresignGetObject(ctx, &s3.GetObjectInput{
				Bucket: aws.String(ac.R2BucketName),
				Key:    aws.String(fileMeta.R2ObjectKey),
			}, func(po *s3.PresignOptions) {
				po.Expires = presignDuration
			})
			if presignErr != nil {
				logCtx.WithError(presignErr).WithFields(log.Fields{
					"r2_object_key": fileMeta.R2ObjectKey,
				}).Warn("Failed to generate R2 pre-signed GET URL for file")
				fileMeta.ContentURL = ""
			} else {
				fileMeta.ContentURL = presignedURLRequest.URL
			}
		} else {
			fileMeta.ContentURL = ""
		}
		files = append(files, fileMeta)
	}

	if files == nil {
		files = make([]FileMetadata, 0)
	}

	logCtx.WithField("file_count", len(files)).Info("Successfully retrieved workspace manifest with content URLs")
	c.JSON(http.StatusOK, WorkspaceManifestResponse{
		Manifest:         files,
		WorkspaceVersion: workspaceData.WorkspaceVersion,
	})
}

// CreateWorkspace handles requests to create a new workspace.
func (ac *ApiController) CreateWorkspace(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		log.Error("UserID not found in context for CreateWorkspace. AuthMiddleware might not be effective.")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User authentication required"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"user_id": userID,
		"handler": "CreateWorkspace",
	})

	var req CreateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logCtx.WithError(err).Warn("Invalid request body for CreateWorkspace")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		logCtx.Warn("Workspace name cannot be empty")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Workspace name cannot be empty"})
		return
	}

	ctx := c.Request.Context()
	now := time.Now().UTC()
	newWorkspaceID := uuid.New().String()
	initialVersion := "1"

	workspace := Workspace{
		WorkspaceID:      newWorkspaceID,
		Name:             req.Name,
		CreatedBy:        userID,
		CreatedAt:        now,
		WorkspaceVersion: initialVersion,
	}
	workspaceDocRef := ac.FirestoreClient.Collection("workspaces").Doc(newWorkspaceID)

	membershipID := uuid.New().String()
	membership := WorkspaceMembership{
		MembershipID: membershipID,
		WorkspaceID:  newWorkspaceID,
		UserID:       userID,
		Role:         "owner",
		JoinedAt:     now,
	}
	membershipDocRef := ac.FirestoreClient.Collection("workspace_memberships").Doc(membershipID)

	err := ac.FirestoreClient.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		tx.Set(workspaceDocRef, workspace)
		tx.Set(membershipDocRef, membership)
		return nil
	})

	if err != nil {
		logCtx.WithError(err).Error("Failed to commit transaction for workspace creation")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create workspace"})
		return
	}

	logCtx.WithFields(log.Fields{
		"workspace_id": newWorkspaceID,
		"workspace_name": req.Name,
	}).Info("Workspace created successfully")

	c.JSON(http.StatusCreated, CreateWorkspaceResponse{
		WorkspaceID:    newWorkspaceID,
		Name:           req.Name,
		CreatedBy:      userID,
		CreatedAt:      now,
		InitialVersion: initialVersion,
	})
}

// ListWorkspaces retrieves all workspaces a user is a member of.
func (ac *ApiController) ListWorkspaces(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		log.Error("UserID not found in context for ListWorkspaces. AuthMiddleware might not be effective.")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User authentication required"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"user_id": userID,
		"handler": "ListWorkspaces",
	})

	ctx := c.Request.Context()
	var summaries []WorkspaceSummary

	membershipQuery := ac.FirestoreClient.Collection("workspace_memberships").Where("user_id", "==", userID)
	membershipIter := membershipQuery.Documents(ctx)
	defer membershipIter.Stop()

	for {
		membershipDoc, err := membershipIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			logCtx.WithError(err).Error("Failed to iterate over workspace memberships.")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve workspace memberships"})
			return
		}

		var membership WorkspaceMembership
		if err := membershipDoc.DataTo(&membership); err != nil {
			logCtx.WithError(err).WithField("membership_doc_id", membershipDoc.Ref.ID).Warn("Failed to parse workspace membership data.")
			continue
		}

		workspaceDocRef := ac.FirestoreClient.Collection("workspaces").Doc(membership.WorkspaceID)
		workspaceDoc, err := workspaceDocRef.Get(ctx)
		if err != nil {
			logCtx.WithError(err).WithFields(log.Fields{
				"workspace_id": membership.WorkspaceID,
				"membership_id": membership.MembershipID,
			}).Warn("Failed to retrieve workspace details for a membership.")
			continue
		}

		var workspace Workspace
		if err := workspaceDoc.DataTo(&workspace); err != nil {
			logCtx.WithError(err).WithField("workspace_doc_id", workspaceDoc.Ref.ID).Warn("Failed to parse workspace data.")
			continue
		}

		summaries = append(summaries, WorkspaceSummary{
			WorkspaceID: workspace.WorkspaceID,
			Name:        workspace.Name,
			CreatedBy:   workspace.CreatedBy,
			CreatedAt:   workspace.CreatedAt,
			UserRole:    membership.Role,
		})
	}

	if summaries == nil {
		summaries = make([]WorkspaceSummary, 0)
	}

	logCtx.WithField("retrieved_workspaces_count", len(summaries)).Info("Successfully retrieved user's workspaces.")
	c.JSON(http.StatusOK, summaries)
}

// ExecuteCodeAuthenticated handles requests for authenticated code execution.
func (ac *ApiController) ExecuteCodeAuthenticated(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID")

	if userID == "" {
		log.Error("UserID not found in context for ExecuteCodeAuthenticated")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"workspace_id": workspaceID,
		"user_id":      userID,
		"handler":      "ExecuteCodeAuthenticated",
	})

	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User forbidden from executing code in workspace.")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to execute code in this workspace"})
		return
	}
	logCtx.Info("User authorized for workspace code execution.")

	var req ExecuteAuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	if req.Language != "python" {
		log.WithFields(log.Fields{
			"language":     req.Language,
			"workspace_id": workspaceID,
			"user_id":      userID,
		}).Warn("Unsupported language for authenticated execution")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported language, only 'python' is supported for authenticated execution"})
		return
	}

	jobID := uuid.New().String()
	ctx := c.Request.Context()

	submittedAt := time.Now().UTC()
	expiresAt := submittedAt.Add(15 * 24 * time.Hour)

	job := Job{
		Status:         "queued",
		Language:       req.Language,
		Input:          req.Input,
		SubmittedAt:    submittedAt,
		ExpiresAt:      expiresAt,
		UserID:         userID,
		WorkspaceID:    workspaceID,
		EntrypointFile: req.EntrypointFile,
		ExecutionType:  "authenticated_r2",
	}

	docRef := ac.FirestoreClient.Collection(ac.FirestoreJobsCollection).Doc(jobID)
	if _, err := docRef.Set(ctx, job); err != nil {
		log.WithError(err).WithFields(log.Fields{
			"job_id":       jobID,
			"workspace_id": workspaceID,
		}).Error("Failed to create authenticated job in Firestore")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create job record"})
		return
	}
	log.WithFields(log.Fields{
		"job_id":       jobID,
		"language":     job.Language,
		"workspace_id": workspaceID,
		"entrypoint":   req.EntrypointFile,
	}).Info("Authenticated job queued in Firestore")

	taskAuthPayload := CloudTaskAuthPayload{
		JobID:          jobID,
		WorkspaceID:    workspaceID,
		EntrypointFile: req.EntrypointFile,
		Language:       req.Language,
		Input:          req.Input,
		R2BucketName:   ac.R2BucketName,
	}
	payloadBytes, err := json.Marshal(taskAuthPayload)
	if err != nil {
		log.WithError(err).WithFields(log.Fields{
			"job_id":       jobID,
			"workspace_id": workspaceID,
		}).Error("Failed to marshal task payload for authenticated execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare job for execution"})
		return
	}

	workerTargetURL := fmt.Sprintf("%s/execute_auth", ac.PythonWorkerURL)

	taskReq := &cloudtaskspb.CreateTaskRequest{
		Parent: ac.CloudTasksQueuePath,
		Task: &cloudtaskspb.Task{
			MessageType: &cloudtaskspb.Task_HttpRequest{
				HttpRequest: &cloudtaskspb.HttpRequest{
					HttpMethod: cloudtaskspb.HttpMethod_POST,
					Url:        workerTargetURL,
					Headers:    map[string]string{"Content-Type": "application/json"},
					Body:       payloadBytes,
					AuthorizationHeader: &cloudtaskspb.HttpRequest_OidcToken{
						OidcToken: &cloudtaskspb.OidcToken{
							ServiceAccountEmail: ac.WorkerSAEmail,
						},
					},
				},
			},
			DispatchDeadline: durationpb.New(10 * time.Minute),
			ScheduleTime:     timestamppb.New(time.Now().UTC().Add(1 * time.Second)),
		},
	}

	createdTask, err := ac.TasksClient.CreateTask(ctx, taskReq)
	if err != nil {
		log.WithError(err).WithFields(log.Fields{
			"job_id":       jobID,
			"workspace_id": workspaceID,
		}).Error("Failed to create Cloud Task for authenticated execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit job for execution"})
		return
	}

	log.WithFields(log.Fields{
		"job_id":       jobID,
		"task_name":    createdTask.GetName(),
		"workspace_id": workspaceID,
		"worker_url":   workerTargetURL,
	}).Info("Authenticated job enqueued to Cloud Tasks")
	c.JSON(http.StatusOK, gin.H{"job_id": jobID})
} 