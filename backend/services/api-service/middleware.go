package main

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// AuthMiddleware creates a gin.HandlerFunc for Firebase JWT authentication and user ID extraction.
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			log.Warn("Authorization header missing")
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			log.Warnf("Invalid Authorization header format: %s", authHeader)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization header format"})
			return
		}

		tokenString := parts[1]

		if firebaseApp == nil {
			log.Error("Firebase app not initialized")
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Internal server error (Firebase not initialized)"})
			return
		}

		client, err := firebaseApp.Auth(c.Request.Context())
		if err != nil {
			log.Errorf("Error getting Firebase Auth client: %v", err)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Internal server error (Firebase Auth setup)"})
			return
		}

		token, err := client.VerifyIDToken(c.Request.Context(), tokenString)
		if err != nil {
			log.Warnf("Firebase token verification error: %v. Token: %s", err, tokenString)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		userID := token.UID
		if userID == "" {
			log.Warn("Firebase token UID is empty")
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims: UID is empty"})
			return
		}

		c.Set("userID", userID)
		log.Infof("Firebase JWT validated. User ID: %s", userID)
		c.Next()
	}
} 