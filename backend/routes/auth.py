from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
def login(data: LoginRequest):
    if (
        data.email in [
            "admin.citygeneral@queue.local",
            "admin.lifeline@queue.local",
        ]
        and data.password == "ChangeMe123!"
    ):
        return {
            "success": True,
            "token": "demo-admin-token",
            "user": {
                "email": data.email,
                "role": "admin"
            }
        }

    raise HTTPException(
        status_code=401,
        detail="Invalid email or password"
    )