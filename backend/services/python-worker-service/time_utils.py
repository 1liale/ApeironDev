"""
Time utility functions for consistent ISO 8601 formatting across services.
Ensures exact compatibility with JavaScript's toISOString() format.
"""

from datetime import datetime, timezone


def now_iso8601() -> str:
    """
    Returns the current time in UTC formatted as ISO 8601 string
    with millisecond precision, matching JavaScript's toISOString() format.
    
    Format: YYYY-MM-DDTHH:mm:ss.sssZ (e.g., "2024-12-20T19:30:45.123Z")
    
    Returns:
        str: Current time in ISO 8601 format with millisecond precision
    """
    # 1. Get current time in UTC
    dt_utc = datetime.now(timezone.utc)
    
    # 2. Format to ISO 8601 string with milliseconds and 'Z'
    # %f gives microseconds (6 digits), so we slice to get milliseconds (3 digits)
    # We manually append 'Z' since strftime doesn't have direct UTC indicator
    return dt_utc.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def datetime_to_iso8601(dt: datetime) -> str:
    """
    Converts a datetime object to ISO 8601 string with millisecond precision
    matching JavaScript's toISOString() format.
    
    Args:
        dt: datetime object to convert (will be converted to UTC if not already)
    
    Returns:
        str: Datetime in ISO 8601 format with millisecond precision
    """
    # Ensure UTC timezone
    if dt.tzinfo is None:
        # Assume naive datetime is already UTC
        dt_utc = dt.replace(tzinfo=timezone.utc)
    else:
        # Convert to UTC
        dt_utc = dt.astimezone(timezone.utc)
    
    # Format with millisecond precision and 'Z' suffix
    return dt_utc.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z' 