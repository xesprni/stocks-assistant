"""Shared Longbridge service errors, independent of any feature service."""


class LongbridgeUnavailableError(RuntimeError):
    """Raised when Longbridge SDK, credentials or upstream data are unavailable."""
