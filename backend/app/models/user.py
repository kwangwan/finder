import uuid
from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base

# Default storage quota for new regular users is 0 Bytes (Admin assigns quota)
DEFAULT_STORAGE_QUOTA = 0

class User(Base):
    __tablename__ = "kb_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=True)
    # Whatever the identity provider gave us — the Google profile photo for an
    # account that signed in that way. Used until the person uploads their own.
    picture = Column(String(1024), nullable=True)
    # Set once someone uploads a photo of their own, which then wins: a later
    # Google sign-in must not silently put the old one back.
    avatar_s3_key = Column(String(1024), nullable=True)
    google_id = Column(String(255), nullable=True, index=True)
    hashed_password = Column(String(255), nullable=True)
    # The account's public identity: lowercase ASCII, unique, and the name
    # everything in a shared space is attributed to. Separate from `name`
    # because a display name has to be able to be Korean, and an identity has
    # to be impossible to imitate — see username_service.
    username = Column(String(20), unique=True, index=True, nullable=True)
    # The language this person reads in, taken from their browser when they
    # sign up and changeable afterwards. Stored as a BCP-47 primary subtag
    # ("ko", "en", "ja"), which is what a translation layer will ask for.
    # English when the browser asks for something this app has no translation
    # for; the accounts that predate the column were set to Korean once,
    # because that is what those people actually read.
    language = Column(String(10), nullable=False, default="en")
    is_superadmin = Column(Boolean, default=False, nullable=False)
    # Not a person. Holds the shared workspace's storage quota so that pool is
    # separate from any real user's, and is hidden from the user list and from
    # every account action.
    is_system = Column(Boolean, default=False, nullable=False, index=True)
    # Write access to the shared workspace. Revoking this leaves the user able
    # to open and read everything there but not to change it — the shared space
    # is the only one some users have, so removing them from it entirely would
    # take away their whole account.
    can_write_shared = Column(Boolean, default=True, nullable=False)
    is_approved = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    storage_quota_bytes = Column(BigInteger, default=DEFAULT_STORAGE_QUOTA, nullable=False)
    storage_used_bytes = Column(BigInteger, default=0, nullable=False)
    # Bytes claimed by uploads that are in progress but not yet complete (see
    # quota_service.reserve_quota). Without this, two uploads starting around
    # the same time can each pass a plain "used + this file <= quota" check
    # and together exceed the quota, since neither is reflected in
    # storage_used_bytes until it finishes.
    storage_reserved_bytes = Column(BigInteger, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    last_login_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    @property
    def storage_remaining_bytes(self) -> int:
        return max(0, self.storage_quota_bytes - self.storage_used_bytes - self.storage_reserved_bytes)

    @property
    def storage_usage_percent(self) -> float:
        committed = self.storage_used_bytes + self.storage_reserved_bytes
        if self.storage_quota_bytes == 0:
            return 0.0 if committed == 0 else 100.0
        return round((committed / self.storage_quota_bytes) * 100, 1)

    @property
    def avatar_url(self) -> Optional[str]:
        """
        The picture to show for this person.

        An uploaded one wins over the identity provider's: it was chosen here
        deliberately, and a later sign-in elsewhere must not undo that.
        """
        if self.avatar_s3_key:
            return f"/api/auth/avatar/{self.id}"
        return self.picture

    def to_dict(self):
        return {
            "id": str(self.id),
            "email": self.email,
            "name": self.name or self.email.split("@")[0],
            "picture": self.avatar_url,
            "google_id": self.google_id,
            "has_password": bool(self.hashed_password),
            "username": self.username,
            "language": self.language,
            "is_superadmin": self.is_superadmin,
            "is_system": self.is_system,
            "can_write_shared": self.can_write_shared,
            "is_approved": self.is_approved,
            "is_active": self.is_active,
            "storage_quota_bytes": self.storage_quota_bytes,
            "storage_used_bytes": self.storage_used_bytes,
            "storage_remaining_bytes": self.storage_remaining_bytes,
            "storage_usage_percent": self.storage_usage_percent,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
        }
