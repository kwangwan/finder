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
    limit: int = Field(10, ge=1, le=100)
    # Offset into the merged, deduplicated, score-ranked result list — the
    # "더 보기" button walks this forward. Ranking is recomputed over a
    # candidate pool sized to cover offset+limit rather than offsetting each
    # underlying query independently: the three sources (semantic, filename,
    # keyword) are merged and deduped per file, so offsetting them separately
    # would let the same file land on two different pages.
    offset: int = Field(0, ge=0)
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
    # The true number of distinct files matching this query, counted
    # independently of how many were actually returned. It used to be
    # len(results-after-dedupe-within-the-candidate-pool), which grew purely
    # because the caller asked for a bigger limit (the same query reported 75
    # at limit=15 and 153 at limit=50) — a number the UI displayed as a total
    # even though it was really "how much we happened to look at".
    total_results: int
    results: List[SearchResultItem]
    duration_ms: float
    offset: int = 0
    has_more: bool = False
