import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector

from app.core.database import Base

# SFace writes a face as 128 numbers (see services/face_service.py). Stored as
# a unit vector, so comparing two of them is a dot product and pgvector's
# cosine index is exact about what "alike" means.
FACE_EMBEDDING_DIM = 128


class FacePerson(Base):
    """
    Somebody who keeps appearing.

    A person here is not an account and not a name — it is a group of faces
    that look like each other, which is all a photo library can honestly claim
    to know. Whoever it is can be given a name later; until then the group has
    a cover photograph and a count, and that is enough to search by.
    """

    __tablename__ = "kb_face_people"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("kb_workspaces.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(80), nullable=True)
    # The middle of everything gathered so far, kept so a new face can be
    # compared with the group rather than with one arbitrary member of it.
    centroid = Column(Vector(FACE_EMBEDDING_DIM), nullable=True)
    face_count = Column(Integer, nullable=False, default=0)
    cover_face_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        Index("ix_face_people_workspace", "workspace_id"),
    )

    def to_dict(self):
        return {
            "id": str(self.id),
            "label": self.label,
            "face_count": self.face_count,
            "cover_face_id": str(self.cover_face_id) if self.cover_face_id else None,
        }


class FaceSignature(Base):
    """
    One face, in one photograph or at one moment of one film.

    The box is kept as fractions of the picture so it can be drawn over a
    thumbnail or the original without knowing which is on screen, and
    `frame_time` says how many seconds into a video this face appeared —
    empty for a still.
    """

    __tablename__ = "kb_face_signatures"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_id = Column(UUID(as_uuid=True), ForeignKey("kb_files.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("kb_workspaces.id", ondelete="CASCADE"), nullable=True)
    person_id = Column(UUID(as_uuid=True), ForeignKey("kb_face_people.id", ondelete="SET NULL"), nullable=True)

    embedding = Column(Vector(FACE_EMBEDDING_DIM), nullable=False)
    box_x = Column(Float, nullable=False)
    box_y = Column(Float, nullable=False)
    box_w = Column(Float, nullable=False)
    box_h = Column(Float, nullable=False)
    det_score = Column(Float, nullable=True)
    frame_time = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        Index("ix_face_sig_file", "file_id"),
        Index("ix_face_sig_workspace_person", "workspace_id", "person_id"),
    )

    def to_dict(self):
        return {
            "id": str(self.id),
            "file_id": str(self.file_id),
            "person_id": str(self.person_id) if self.person_id else None,
            "box": [self.box_x, self.box_y, self.box_w, self.box_h],
            "score": self.det_score,
            "frame_time": self.frame_time,
        }
