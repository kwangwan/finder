from pydantic import BaseModel, Field
from typing import Optional, List
import uuid
from datetime import datetime

class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    workspace_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    file_type: Optional[str] = None
    author_id: Optional[uuid.UUID] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    limit: int = Field(10, ge=1, le=50)
    min_similarity: float = Field(0.2, ge=0.0, le=1.0)
    include_keyword_match: bool = True

class SearchResultItem(BaseModel):
    file_id: uuid.UUID
    file_name: str
    workspace_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    folder_name: Optional[str] = None
    author_id: Optional[uuid.UUID] = None
    author_name: Optional[str] = None
    file_type: str
    is_markdown: bool
    chunk_index: int
    matched_snippet: str
    similarity_score: float # 0.0 to 1.0 (cosine similarity)
    match_type: str # "semantic" or "keyword" or "hybrid"
    matched_chunks_count: Optional[int] = 1
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class SearchResponse(BaseModel):
    query: str
    total_results: int
    results: List[SearchResultItem]
    duration_ms: float
