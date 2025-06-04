package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	cloudtasks "cloud.google.com/go/cloudtasks/apiv2"
	cloudtaskspb "cloud.google.com/go/cloudtasks/apiv2/cloudtaskspb"
	"cloud.google.com/go/firestore"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
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
		Where("userId", "==", userID).
		Where("workspaceId", "==", workspaceID).
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
	R2BucketName            string
	PythonWorkerURL         string
	WorkerSAEmail           string
	CloudTasksQueuePath     string
	FirestoreJobsCollection string
}

// NewApiController creates a new ApiController.
func NewApiController(fs *firestore.Client, tasksClient *cloudtasks.Client, presignClient *s3.PresignClient, r2BucketName, pythonWorkerURL, workerSAEmail, cloudTasksQueuePath, firestoreJobsCollection string) *ApiController {
	return &ApiController{
		FirestoreClient:         fs,
		TasksClient:             tasksClient,
		R2PresignClient:         presignClient,
		R2BucketName:            r2BucketName,
		PythonWorkerURL:         pythonWorkerURL,
		WorkerSAEmail:           workerSAEmail,
		CloudTasksQueuePath:     cloudTasksQueuePath,
		FirestoreJobsCollection: firestoreJobsCollection,
	}
}

// HandleSync processes a batch of client file states, compares with Firestore, 
// and returns necessary actions (like generating pre-signed URLs for uploads/deletes).
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

	responseActions := make([]SyncResponseFileAction, 0, len(req.Files))
	presignDuration := 15 * time.Minute
	filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)

	for _, clientFile := range req.Files {
		r2ObjectKey := fmt.Sprintf("workspaces/%s/%s", workspaceID, clientFile.FilePath)
		currentAction := SyncResponseFileAction{
			FilePath:    clientFile.FilePath,
			R2ObjectKey: r2ObjectKey,
		}
		itemLogCtx := logCtx.WithField("filePath", clientFile.FilePath) // Context for item-specific logs

		switch clientFile.Action {
		case "new", "modified":
			var serverMeta FileMetadata
			foundServerMeta := false
			serverHash := ""

			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("filePath", "==", clientFile.FilePath).Limit(1)
			docs, err := query.Documents(c.Request.Context()).GetAll()

			if err != nil {
				itemLogCtx.WithError(err).Error("Firestore query failed for existing file metadata during sync preparation.")
				// Decide how to handle this: skip this file, or assume it's new? 
				// For now, let's attempt to provide an upload URL as a fallback, but mark an error.
				// This part can be made more robust based on desired behavior.
			} else if len(docs) > 0 {
				if err := docs[0].DataTo(&serverMeta); err == nil {
					foundServerMeta = true
					serverHash = serverMeta.Hash
				} else {
					itemLogCtx.WithError(err).Error("Error unmarshalling Firestore data for existing file.")
				}
			}

			if clientFile.Action == "new" || !foundServerMeta || (clientFile.Action == "modified" && clientFile.ClientHash != serverHash) {
				presignedPutURL, presignErr := ac.R2PresignClient.PresignPutObject(c.Request.Context(), &s3.PutObjectInput{
					Bucket: aws.String(ac.R2BucketName),
					Key:    aws.String(r2ObjectKey),
				}, func(po *s3.PresignOptions) {
					po.Expires = presignDuration
				})
				if (presignErr != nil) {
					itemLogCtx.WithError(presignErr).Error("Failed to generate PUT URL for sync.")
					currentAction.ActionRequired = "none"
					currentAction.Message = "Error generating upload URL"
				} else {
					currentAction.ActionRequired = "upload"
					currentAction.PresignedURL = presignedPutURL.URL
					currentAction.ClientHashForUpload = clientFile.ClientHash
				}
			} else {
				currentAction.ActionRequired = "none"
				currentAction.Message = "File up to date"
			}

		case "deleted":
			presignedDeleteURL, err := ac.R2PresignClient.PresignDeleteObject(c.Request.Context(), &s3.DeleteObjectInput{
				Bucket: aws.String(ac.R2BucketName),
				Key:    aws.String(r2ObjectKey),
			}, func(po *s3.PresignOptions) {
				po.Expires = presignDuration
			})
			if err != nil {
				itemLogCtx.WithError(err).Error("Failed to generate DELETE URL for sync.")
				currentAction.ActionRequired = "none"
				currentAction.Message = "Error generating delete URL"
			} else {
				currentAction.ActionRequired = "delete"
				currentAction.PresignedURL = presignedDeleteURL.URL
			}

		case "unchanged":
			currentAction.ActionRequired = "none"
			currentAction.Message = "File unchanged as per client"

		default:
			itemLogCtx.WithField("action", clientFile.Action).Warn("Unknown action in sync request for file.")
			currentAction.ActionRequired = "none"
			currentAction.Message = "Unknown action specified"
		}
		responseActions = append(responseActions, currentAction)
	}

	logCtx.WithField("processed_files_count", len(req.Files)).Info("HandleSync request processed.")
	c.JSON(http.StatusOK, SyncResponse{Actions: responseActions})
}

// ConfirmSync handles batch confirmation of file uploads and deletions.
func (ac *ApiController) ConfirmSync(c *gin.Context) {
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
		"handler":      "ConfirmSync",
	})

	// Authorization check
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
	logCtx.Info("User authorized for workspace access.") // Log successful authorization

	var req ConfirmSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logCtx.WithError(err).Warn("Invalid request body")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	if len(req.Files) == 0 {
		// Not necessarily an error, could be an empty confirmation list.
		logCtx.Info("Request received with no files to confirm.")
		c.JSON(http.StatusOK, ConfirmSyncResponse{Results: []ConfirmSyncResponseItem{}})
		return
	}

	results := make([]ConfirmSyncResponseItem, 0, len(req.Files))
	filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)
	now := time.Now().UTC()

	for _, fileConfirm := range req.Files {
		itemLogCtx := logCtx.WithField("filePath", fileConfirm.FilePath) // Reduced verbosity for R2ObjectKey here
		responseItem := ConfirmSyncResponseItem{FilePath: fileConfirm.FilePath}

		if fileConfirm.Status != "success" {
			itemLogCtx.WithFields(log.Fields{
				"client_status": fileConfirm.Status, 
				"client_error": fileConfirm.Error,
			}).Info("Client reported operation failed, skipping server-side confirmation.")
			responseItem.Status = "confirmation_skipped_client_failure"
			responseItem.Message = fmt.Sprintf("Client reported operation failed: %s", fileConfirm.Error)
			results = append(results, responseItem)
			continue
		}

		switch fileConfirm.ActionConfirmed {
		case "uploaded":
			if fileConfirm.ClientHash == "" || fileConfirm.ContentType == "" {
				itemLogCtx.Warn("Missing clientHash or contentType for uploaded file confirmation.")
				responseItem.Status = "confirmation_failed"
				responseItem.Message = "Missing clientHash or contentType for uploaded file."
				results = append(results, responseItem)
				continue
			}

			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("filePath", "==", fileConfirm.FilePath).Limit(1)
			docs, err := query.Documents(c.Request.Context()).GetAll()

			if err != nil {
				itemLogCtx.WithError(err).Error("Firestore query failed for existing file metadata during upload confirmation.")
				responseItem.Status = "confirmation_failed"
				responseItem.Message = "Server error checking existing metadata."
				results = append(results, responseItem)
				continue
			}

			if len(docs) > 0 { // Metadata exists, update it
				docRef := docs[0].Ref
				_, err := docRef.Update(c.Request.Context(), []firestore.Update{
					{Path: "r2ObjectKey", Value: fileConfirm.R2ObjectKey},
					{Path: "size", Value: fileConfirm.Size},
					{Path: "contentType", Value: fileConfirm.ContentType},
					{Path: "hash", Value: fileConfirm.ClientHash},
					{Path: "updatedAt", Value: now},
				})
				if err != nil {
					itemLogCtx.WithError(err).WithField("docId", docRef.ID).Error("Failed to update file metadata in Firestore.")
					responseItem.Status = "confirmation_failed"
					responseItem.Message = "Failed to update file metadata."
				} else {
					// itemLogCtx.Info("File metadata updated successfully") // Reduced verbosity
					responseItem.Status = "metadata_updated"
					responseItem.FileID = docRef.ID
				}
			} else { // Metadata does not exist, create it
				fileID := uuid.New().String()
				fileName := fileConfirm.FilePath 
				if parts := strings.Split(fileConfirm.FilePath, "/"); len(parts) > 0 {
					fileName = parts[len(parts)-1]
				}

				fileMetadata := FileMetadata{
					FileID:      fileID,
					FileName:    fileName,
					FilePath:    fileConfirm.FilePath,
					R2ObjectKey: fileConfirm.R2ObjectKey,
					Size:        fileConfirm.Size,
					ContentType: fileConfirm.ContentType,
					UserID:      userID,
					WorkspaceID: workspaceID,
					Hash:        fileConfirm.ClientHash,
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				docRef := ac.FirestoreClient.Collection(filesCollectionPath).Doc(fileID)
				_, err := docRef.Set(c.Request.Context(), fileMetadata)
				if err != nil {
					itemLogCtx.WithError(err).Error("Failed to create file metadata in Firestore.")
					responseItem.Status = "confirmation_failed"
					responseItem.Message = "Failed to create file metadata."
				} else {
					// itemLogCtx.Info("File metadata created successfully") // Reduced verbosity
					responseItem.Status = "metadata_created"
					responseItem.FileID = fileID
				}
			}

		case "deleted":
			query := ac.FirestoreClient.Collection(filesCollectionPath).Where("filePath", "==", fileConfirm.FilePath).Limit(1)
			docs, err := query.Documents(c.Request.Context()).GetAll()

			if err != nil {
				itemLogCtx.WithError(err).Error("Firestore query failed for file metadata during delete confirmation.")
				responseItem.Status = "confirmation_failed"
				responseItem.Message = "Server error finding metadata to delete."
			} else if len(docs) == 0 {
				itemLogCtx.Info("File metadata not found for deletion, perhaps already deleted.")
				responseItem.Status = "metadata_not_found"
				responseItem.Message = "File metadata not found, assumed already deleted."
			} else {
				docRef := docs[0].Ref
				_, err := docRef.Delete(c.Request.Context())
				if err != nil {
					itemLogCtx.WithError(err).WithField("docId", docRef.ID).Error("Failed to delete file metadata from Firestore.")
					responseItem.Status = "confirmation_failed"
					responseItem.Message = "Failed to delete file metadata."
				} else {
					// itemLogCtx.Info("File metadata deleted successfully") // Reduced verbosity
					responseItem.Status = "metadata_deleted"
					responseItem.FileID = docRef.ID
				}
			}

		default:
			itemLogCtx.WithField("action_confirmed", fileConfirm.ActionConfirmed).Warn("Invalid action confirmed by client.")
			responseItem.Status = "invalid_action"
			responseItem.Message = "Invalid action confirmed: " + fileConfirm.ActionConfirmed
		}
		results = append(results, responseItem)
	}

	logCtx.WithField("processed_confirmations_count", len(req.Files)).Info("ConfirmSync request processed.")
	c.JSON(http.StatusOK, ConfirmSyncResponse{Results: results})
}

// ExecuteCode handles requests for code execution.
func (ac *ApiController) ExecuteCode(c *gin.Context) {
	var reqBody RequestBody // RequestBody is from models.go, assumed to be { Code, Language, Input string }
	if err := c.ShouldBindJSON(&reqBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	jobID := uuid.New().String()
	ctx := c.Request.Context()

	job := Job{
		Status: "queued", Code: reqBody.Code, Language: reqBody.Language,
		Input: reqBody.Input, SubmittedAt: time.Now().UTC(),
	}

	docRef := ac.FirestoreClient.Collection(ac.FirestoreJobsCollection).Doc(jobID)
	if _, err := docRef.Set(ctx, job); err != nil {
		log.WithError(err).WithField("job_id", jobID).Error("Failed to create job in Firestore")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create job record"})
		return
	}
	log.WithFields(log.Fields{"job_id": jobID, "language": job.Language}).Info("Job queued in Firestore for public execution")

	taskPayload := CloudTaskPayload{ // This is the existing payload with direct code
		JobID: jobID, Code: reqBody.Code, Language: reqBody.Language, Input: reqBody.Input,
	}
	payloadBytes, err := json.Marshal(taskPayload)
	if err != nil {
		log.WithError(err).WithField("job_id", jobID).Error("Failed to marshal task payload for public execution")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare job for execution"})
		return
	}

	// Assuming ac.PythonWorkerURL and ac.CloudTasksQueuePath are configured for the python worker
	// that handles direct code execution.
	taskReq := &cloudtaskspb.CreateTaskRequest{
		Parent: ac.CloudTasksQueuePath, // Uses the existing queue path
		Task: &cloudtaskspb.Task{
			MessageType: &cloudtaskspb.Task_HttpRequest{
				HttpRequest: &cloudtaskspb.HttpRequest{
					HttpMethod: cloudtaskspb.HttpMethod_POST,
					Url:        fmt.Sprintf("%s/execute", ac.PythonWorkerURL), // Worker endpoint for direct code
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

// ExecuteCodeAuthenticated handles requests for authenticated code execution.
// The worker will fetch code from R2 based on workspace and entrypoint.
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

	// Authorization check
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

	// For now, authenticated execution also only supports "python".
	// This can be expanded later by making worker selection dynamic.
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

	// Job record in Firestore will not store the code directly for authenticated execution
	job := Job{
		Status:        "queued",
		Language:      req.Language,
		Input:         req.Input,
		SubmittedAt:   time.Now().UTC(),
		WorkspaceID:   workspaceID,    // Store workspace ID for reference
		EntrypointFile: req.EntrypointFile, // Store entrypoint for reference
		ExecutionType: "authenticated_r2", // Differentiate execution type
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

	// Prepare payload for the worker. Worker needs to know where to fetch from.
	taskAuthPayload := CloudTaskAuthPayload{
		JobID:          jobID,
		WorkspaceID:    workspaceID,
		EntrypointFile: req.EntrypointFile,
		Language:       req.Language,
		Input:          req.Input,
		R2BucketName:   ac.R2BucketName, // Worker needs the R2 bucket name
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
		Parent: ac.CloudTasksQueuePath, // Can use the same queue or a dedicated one
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
			DispatchDeadline: durationpb.New(10 * time.Minute), // Consider if this needs to be different
			ScheduleTime:     timestamppb.New(time.Now().UTC().Add(1 * time.Second)),
		},
	}

	createdTask, err := ac.TasksClient.CreateTask(ctx, taskReq)
	if err != nil {
		log.WithError(err).WithFields(log.Fields{
			"job_id":       jobID,
			"workspace_id": workspaceID,
		}).Error("Failed to create Cloud Task for authenticated execution")
		// Potentially update Firestore job status to "failed_submission"
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

// ListFiles handles requests to list all file metadata for a given workspace.
func (ac *ApiController) ListFiles(c *gin.Context) {
	workspaceID := c.Param("workspaceId")
	userID := c.GetString("userID") // Get userID from context set by AuthMiddleware

	if userID == "" {
		log.Error("UserID not found in context for ListFiles")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	logCtx := log.WithFields(log.Fields{
		"workspace_id": workspaceID,
		"user_id":      userID,
		"handler":      "ListFiles",
	})

	// Authorization check
	isMember, err := checkWorkspaceMembership(c.Request.Context(), ac.FirestoreClient, userID, workspaceID)
	if err != nil {
		logCtx.WithError(err).Error("Workspace membership check failed for ListFiles.")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify workspace membership"})
		return
	}
	if !isMember {
		logCtx.Warn("User forbidden from listing files in workspace.")
		c.JSON(http.StatusForbidden, gin.H{"error": "User does not have access to list files in this workspace"})
		return
	}
	logCtx.Info("User authorized for listing files in workspace.")

	filesCollectionPath := fmt.Sprintf("workspaces/%s/files", workspaceID)
	iter := ac.FirestoreClient.Collection(filesCollectionPath).Documents(c.Request.Context())
	defer iter.Stop()

	var files []FileMetadata
	presignDuration := 15 * time.Minute // Expiration for download URLs

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
			continue // Skip problematic documents
		}

		// Generate pre-signed URL for downloading the file content
		if fileMeta.R2ObjectKey != "" { // Only generate if R2ObjectKey exists
			presignedURLRequest, err := ac.R2PresignClient.PresignGetObject(c.Request.Context(), &s3.GetObjectInput{
				Bucket: aws.String(ac.R2BucketName),
				Key:    aws.String(fileMeta.R2ObjectKey),
			}, func(po *s3.PresignOptions) {
				po.Expires = presignDuration
			})
			if err != nil {
				logCtx.WithError(err).WithFields(log.Fields{
					"r2_object_key": fileMeta.R2ObjectKey,
				}).Warn("Failed to generate R2 pre-signed GET URL for file")
				// Don't fail the whole request, just this file won't have a download URL
			} else {
				fileMeta.DownloadURL = presignedURLRequest.URL
			}
		}
		files = append(files, fileMeta)
	}

	if files == nil {
		files = make([]FileMetadata, 0) // Return empty array [] instead of null
	}

	logCtx.WithField("file_count", len(files)).Info("Successfully retrieved file list with download URLs")
	c.JSON(http.StatusOK, files)
} 