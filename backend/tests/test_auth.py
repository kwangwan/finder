import pytest
import uuid
from datetime import datetime, timedelta
from app.models.user import User
from app.models.invitation import Invitation
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password

@pytest.mark.asyncio
async def test_jwt_token_generation_and_decoding():
    payload = {"sub": "1234-5678", "email": "test@example.com", "is_admin": False, "is_approved": False}
    token = create_access_token(payload)
    assert token is not None

    decoded = decode_access_token(token)
    assert decoded["sub"] == "1234-5678"
    assert decoded["email"] == "test@example.com"
    assert decoded["is_admin"] is False
    assert decoded["is_approved"] is False

@pytest.mark.asyncio
async def test_password_hashing_and_verification():
    raw_pw = "SuperSecurePass2026!"
    hashed = hash_password(raw_pw)
    assert hashed != raw_pw
    assert verify_password(raw_pw, hashed) is True
    assert verify_password("WrongPassword", hashed) is False

@pytest.mark.asyncio
async def test_user_creation_and_admin_status(db_session):
    uid = str(uuid.uuid4())[:8]
    user = User(
        email=f"test_user_{uid}@project.run",
        name="테스트 유저",
        hashed_password=hash_password("pw1234"),
        is_admin=False,
        is_approved=False,
        is_active=True
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    assert user.is_admin is False
    assert user.is_approved is False
    assert verify_password("pw1234", user.hashed_password) is True

    # 2. Simulate user approval via SQL query
    user.is_approved = True
    await db_session.commit()
    await db_session.refresh(user)
    assert user.is_approved is True

    # 3. Simulate granting admin
    user.is_admin = True
    await db_session.commit()
    await db_session.refresh(user)
    assert user.is_admin is True

    # Clean up
    await db_session.delete(user)
    await db_session.commit()

@pytest.mark.asyncio
async def test_invitation_creation_and_7day_expiration(db_session):
    uid = str(uuid.uuid4())[:8]
    admin = User(email=f"admin_{uid}@project.run", name="최고관리자", is_admin=True, is_approved=True)
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)

    # 1. Create valid 7-day invitation
    valid_inv = Invitation(
        email=f"newbie_{uid}@project.run",
        token=f"token_{uid}_valid",
        invited_by=admin.id,
        is_admin_invite=True,
        expires_at=datetime.utcnow() + timedelta(days=7),
        status="pending"
    )
    # 2. Create expired invitation
    expired_inv = Invitation(
        email=f"expired_{uid}@project.run",
        token=f"token_{uid}_expired",
        invited_by=admin.id,
        is_admin_invite=True,
        expires_at=datetime.utcnow() - timedelta(minutes=5),
        status="pending"
    )
    db_session.add_all([valid_inv, expired_inv])
    await db_session.commit()

    assert valid_inv.is_expired is False
    assert expired_inv.is_expired is True

    # Clean up
    await db_session.delete(valid_inv)
    await db_session.delete(expired_inv)
    await db_session.delete(admin)
    await db_session.commit()
