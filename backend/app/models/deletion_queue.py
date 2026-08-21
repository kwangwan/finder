import uuid
from datetime import datetime
from sqlalchemy import Column, String, BigInteger, DateTime, Integer, Text, Index
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base

class DeletionQueueItem(Base):
    """
    Queue item for asynchronous permanent file deletion.
    Stores S3 object keys and metadata to be deleted asynchronously by the background worker.
    """
    __tablename__ = "deletion_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    s3_key = Column(String(1024), nullable=True)
    thumbnail_s3_key = Column(String(1024), nullable=True)
    file_size_bytes = Column(BigInteger, default=0, nullable=False)
    workspace_id = Column(UUID(as_uuid=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    
    # Status: 'pending', 'processing', 'failed', 'completed'
    status = Column(String(32), default="pending", nullable=False, index=True)
    retry_count = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_deletion_queue_status_created", "status", "created_at"),
    )
