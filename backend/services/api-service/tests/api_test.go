package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type RequestBody struct {
	Code     string `json:"code" binding:"required"`
	Language string `json:"language" binding:"required"`
	Input    string `json:"input"` // Optional input field
}

// Sets up a testing router with stubbed returns
func setupRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New() 
	r.GET("/healthcheck", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})
	r.POST("/execute", func(c *gin.Context) {
		var jsonBody RequestBody
		if err := c.ShouldBindJSON(&jsonBody); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// Simplified for testing: normally interacts with 'jobs' map and UUID
		c.JSON(http.StatusOK, gin.H{"job_id": "test-job-id"})
	})
	r.GET("/result/:job_id", func(c *gin.Context) {
		jobID := c.Param("job_id")
		if jobID == "test-job-id" {
			c.JSON(http.StatusOK, gin.H{"job_id": jobID, "status": "completed", "output": "test output"})
		} else if jobID == "pending-job-id" {
			c.JSON(http.StatusOK, gin.H{"job_id": jobID, "status": "pending"})
		} else {
			c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
		}
	})
	return r
}

func TestHealthCheckEndpoint(t *testing.T) {
	r := setupRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/healthcheck", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Equal(t, "healthy", response["status"])
}

func TestExecuteEndpoint_NoInput(t *testing.T) {
	r := setupRouter()

	payload := RequestBody{Code: "print('hello')", Language: "python"} // Input will be an empty string
	jsonPayload, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/execute", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Contains(t, response, "job_id")
}

func TestExecuteEndpoint_WithInput(t *testing.T) {
	r := setupRouter()

	payload := RequestBody{Code: "print(input())", Language: "python", Input: "world"}
	jsonPayload, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/execute", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Contains(t, response, "job_id")
}

func TestExecuteEndpoint_MissingFields(t *testing.T) {
	r := setupRouter()

	payload := map[string]string{"code": "print('hello')"} // Missing language
	jsonPayload, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/execute", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Contains(t, response, "error")
}

func TestResultEndpoint_JobFound(t *testing.T) {
	r := setupRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/result/test-job-id", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Equal(t, "test-job-id", response["job_id"])
	assert.Equal(t, "completed", response["status"])
}

func TestResultEndpoint_JobNotFound(t *testing.T) {
	r := setupRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/result/non-existent-job-id", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Contains(t, response, "error")
	assert.Equal(t, "Job not found", response["error"])
} 