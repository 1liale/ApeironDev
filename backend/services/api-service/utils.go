package main

import (
	"time"
)

// NowISO8601 returns the current time in UTC formatted as ISO 8601 string
// with millisecond precision, matching JavaScript's toISOString() format.
// Format: YYYY-MM-DDTHH:mm:ss.sssZ (e.g., "2024-12-20T19:30:45.123Z")
func NowISO8601() string {
	// 1. Get current time in UTC
	now := time.Now().UTC()
	
	// 2. Truncate to millisecond precision to match JavaScript's toISOString()
	nowMillis := now.Truncate(time.Millisecond)
	
	// 3. Format using Go's reference time layout for exact ISO 8601 with milliseconds and 'Z'
	return nowMillis.Format("2006-01-02T15:04:05.000Z")
}

// TimeToISO8601 converts a time.Time to ISO 8601 string with millisecond precision
// matching JavaScript's toISOString() format.
func TimeToISO8601(t time.Time) string {
	// Ensure UTC and truncate to millisecond precision
	utcTime := t.UTC().Truncate(time.Millisecond)
	return utcTime.Format("2006-01-02T15:04:05.000Z")
} 