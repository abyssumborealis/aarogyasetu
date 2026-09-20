from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/auth/staff", tags=["auth"])

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
def login(data: LoginRequest):
    allowed = {
        "admin.citygeneral@queue.local",
        "admin.lifeline@queue.local",
    }

    if data.email in allowed and data.password == "ChangeMe123!":
        return {
            "access_token": "demo-token",
            "token_type": "bearer",
            "staff": {
                "email": data.email,
                "role": "admin",
                "name": "Hospital Admin"
            }
        }

    raise HTTPException(
        status_code=401,
        detail="Invalid credentials"
    )