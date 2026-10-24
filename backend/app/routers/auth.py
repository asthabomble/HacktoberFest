from typing import Any

from fastapi import APIRouter, HTTPException
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
from pydantic import BaseModel, Field

from app.config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class GoogleCredential(BaseModel):
    credential: str = Field(min_length=1)


@router.get("/config")
def auth_config() -> dict[str, str]:
    """Public settings the sign-in page needs. The OAuth client ID is public; the secret never leaves the server."""
    return {"google_client_id": get_settings().google_oauth_client_id.strip()}


@router.post("/google")
def google_sign_in(payload: GoogleCredential) -> dict[str, Any]:
    """Verify a Google Identity Services ID token and return its basic profile."""
    client_id = get_settings().google_oauth_client_id.strip()
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on the backend.")

    try:
        claims = id_token.verify_oauth2_token(payload.credential, GoogleRequest(), audience=client_id)
    except (ValueError, GoogleAuthError):
        raise HTTPException(status_code=401, detail="Google could not verify this sign-in. Please try again.") from None
    except Exception:
        raise HTTPException(status_code=503, detail="Google sign-in could not reach Google's verification service.") from None

    email = claims.get("email")
    subject = claims.get("sub")
    if not subject or not email or claims.get("email_verified") is not True:
        raise HTTPException(status_code=401, detail="This Google account does not have a verified email address.")

    return {
        "subject": subject,
        "email": email,
        "name": claims.get("name") or email,
        "picture": claims.get("picture"),
    }
