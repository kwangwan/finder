import time
from typing import List, Optional, Dict
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.models import User
from app.schemas.search import SearchRequest, SearchResponse, SearchResultItem
from app.services.embedding_service import embedding_service
from app.services.access_service import access_service

class SearchService:
    @staticmethod
    def _create_snippet(content: str, query: str, max_length: int = 250) -> str:
        """Extract a highlighted snippet around query match or the first part of chunk."""
        if not content:
            return ""

        query_lower = query.lower()
        content_lower = content.lower()
        
        pos = content_lower.find(query_lower)
        if pos != -1:
            start = max(0, pos - 60)
            end = min(len(content), pos + len(query) + 120)
            snippet = content[start:end].strip()
            if start > 0:
                snippet = "..." + snippet
            if end < len(content):
                snippet = snippet + "..."
            return snippet
        else:
            return content[:max_length].strip() + ("..." if len(content) > max_length else "")

    async def search(self, db: AsyncSession, req: SearchRequest, current_user: Optional[User] = None) -> SearchResponse:
        start_time = time.time()
        best_by_file: Dict[uuid.UUID, SearchResultItem] = {}

        # Workspace security check
        if req.workspace_id:
            if current_user and not await access_service.is_workspace_member(db, current_user, req.workspace_id):
                return SearchResponse(
                    query=req.query,
                    total_results=0,
                    results=[],
                    duration_ms=round((time.time() - start_time) * 1000.0, 2)
                )

        # 1. Compute accessible workspace IDs for non-admin without specific workspace
        user_ws_ids = None
        if current_user and not current_user.is_admin and not req.workspace_id:
            user_ws_ids = await access_service.get_user_workspace_ids(db, current_user.id)

        # 2. Generate query embedding
        query_vector = await embedding_service.get_embedding(req.query)

        # Candidate pool limit to gather diverse document chunks
        candidate_limit = max(req.limit * 5, 50)

        # 3. Semantic vector search if embedding is available
        if query_vector is not None:
            vec_str = "[" + ",".join(str(x) for x in query_vector) + "]"
            
            query_sql = f"""
                SELECT 
                    c.id as chunk_id,
                    c.file_id,
                    c.chunk_index,
                    c.content as chunk_content,
                    1 - (c.embedding <=> '{vec_str}'::vector) as similarity,
                    f.name as file_name,
                    f.workspace_id,
                    f.folder_id,
                    f.created_by,
                    u.name as author_name,
                    f.file_type,
                    f.is_markdown,
                    f.created_at,
                    f.updated_at,
                    fol.name as folder_name
                FROM kb_document_chunks c
                JOIN kb_files f ON c.file_id = f.id
                LEFT JOIN kb_folders fol ON f.folder_id = fol.id
                LEFT JOIN kb_users u ON f.created_by = u.id
                WHERE c.embedding IS NOT NULL
                  AND f.is_trashed = FALSE
                  AND 1 - (c.embedding <=> '{vec_str}'::vector) >= :min_sim
            """
            
            params = {"min_sim": req.min_similarity, "limit": candidate_limit}
            
            if req.workspace_id:
                query_sql += " AND f.workspace_id = :workspace_id"
                params["workspace_id"] = req.workspace_id
            elif user_ws_ids is not None:
                if user_ws_ids:
                    ws_params = {f"ws_{i}": wid for i, wid in enumerate(user_ws_ids)}
                    ws_placeholders = ", ".join(f":ws_{i}" for i in range(len(user_ws_ids)))
                    query_sql += f" AND (f.workspace_id IN ({ws_placeholders}) OR (f.workspace_id IS NULL AND f.created_by = :current_user_id))"
                    params.update(ws_params)
                    params["current_user_id"] = current_user.id
                else:
                    query_sql += " AND (f.workspace_id IS NULL AND f.created_by = :current_user_id)"
                    params["current_user_id"] = current_user.id

            if req.folder_id:
                query_sql += " AND f.folder_id = :folder_id"
                params["folder_id"] = req.folder_id
            if req.file_type:
                query_sql += " AND f.file_type = :file_type"
                params["file_type"] = req.file_type
            if req.author_id:
                query_sql += " AND f.created_by = :author_id"
                params["author_id"] = req.author_id
            if req.start_date:
                query_sql += " AND f.created_at >= :start_date"
                params["start_date"] = req.start_date
            if req.end_date:
                query_sql += " AND f.created_at <= :end_date"
                params["end_date"] = req.end_date

            query_sql += " ORDER BY similarity DESC LIMIT :limit;"

            try:
                res = await db.execute(text(query_sql), params)
                rows = res.fetchall()

                for row in rows:
                    fid = row.file_id
                    sim_score = round(max(0.0, min(1.0, float(row.similarity))), 4)
                    snippet = self._create_snippet(row.chunk_content, req.query)

                    if fid not in best_by_file:
                        best_by_file[fid] = SearchResultItem(
                            file_id=row.file_id,
                            file_name=row.file_name,
                            workspace_id=row.workspace_id,
                            folder_id=row.folder_id,
                            folder_name=row.folder_name,
                            author_id=row.created_by,
                            author_name=row.author_name,
                            file_type=row.file_type,
                            is_markdown=row.is_markdown,
                            chunk_index=row.chunk_index,
                            matched_snippet=snippet,
                            similarity_score=sim_score,
                            match_type="semantic",
                            matched_chunks_count=1,
                            created_at=row.created_at,
                            updated_at=row.updated_at
                        )
                    else:
                        best_by_file[fid].matched_chunks_count = (best_by_file[fid].matched_chunks_count or 1) + 1
                        # Keep the highest similarity score chunk
                        if sim_score > best_by_file[fid].similarity_score:
                            best_by_file[fid].similarity_score = sim_score
                            best_by_file[fid].chunk_index = row.chunk_index
                            best_by_file[fid].matched_snippet = snippet

            except Exception as e:
                print(f"[Search Error] Semantic search failed: {e}")

        # 4. Keyword / Text search supplement (Hybrid search)
        if req.include_keyword_match and len(best_by_file) < req.limit:
            keyword_term = f"%{req.query.strip()}%"
            kw_sql = """
                SELECT 
                    c.id as chunk_id,
                    c.file_id,
                    c.chunk_index,
                    c.content as chunk_content,
                    f.name as file_name,
                    f.workspace_id,
                    f.folder_id,
                    f.created_by,
                    u.name as author_name,
                    f.file_type,
                    f.is_markdown,
                    f.created_at,
                    f.updated_at,
                    fol.name as folder_name
                FROM kb_document_chunks c
                JOIN kb_files f ON c.file_id = f.id
                LEFT JOIN kb_folders fol ON f.folder_id = fol.id
                LEFT JOIN kb_users u ON f.created_by = u.id
                WHERE f.is_trashed = FALSE
                  AND (c.content ILIKE :kw OR f.name ILIKE :kw)
            """
            kw_params = {"kw": keyword_term, "limit": candidate_limit}
            
            if req.workspace_id:
                kw_sql += " AND f.workspace_id = :workspace_id"
                kw_params["workspace_id"] = req.workspace_id
            elif user_ws_ids is not None:
                if user_ws_ids:
                    ws_params = {f"k_ws_{i}": wid for i, wid in enumerate(user_ws_ids)}
                    ws_placeholders = ", ".join(f":k_ws_{i}" for i in range(len(user_ws_ids)))
                    kw_sql += f" AND (f.workspace_id IN ({ws_placeholders}) OR (f.workspace_id IS NULL AND f.created_by = :current_user_id))"
                    kw_params.update(ws_params)
                    kw_params["current_user_id"] = current_user.id
                else:
                    kw_sql += " AND (f.workspace_id IS NULL AND f.created_by = :current_user_id)"
                    kw_params["current_user_id"] = current_user.id

            if req.folder_id:
                kw_sql += " AND f.folder_id = :folder_id"
                kw_params["folder_id"] = req.folder_id
            if req.file_type:
                kw_sql += " AND f.file_type = :file_type"
                kw_params["file_type"] = req.file_type
            if req.author_id:
                kw_sql += " AND f.created_by = :author_id"
                kw_params["author_id"] = req.author_id
            if req.start_date:
                kw_sql += " AND f.created_at >= :start_date"
                kw_params["start_date"] = req.start_date
            if req.end_date:
                kw_sql += " AND f.created_at <= :end_date"
                kw_params["end_date"] = req.end_date
                
            kw_sql += " LIMIT :limit;"

            try:
                kw_res = await db.execute(text(kw_sql), kw_params)
                kw_rows = kw_res.fetchall()

                for row in kw_rows:
                    fid = row.file_id
                    snippet = self._create_snippet(row.chunk_content, req.query)
                    
                    if fid not in best_by_file:
                        best_by_file[fid] = SearchResultItem(
                            file_id=row.file_id,
                            file_name=row.file_name,
                            workspace_id=row.workspace_id,
                            folder_id=row.folder_id,
                            folder_name=row.folder_name,
                            author_id=row.created_by,
                            author_name=row.author_name,
                            file_type=row.file_type,
                            is_markdown=row.is_markdown,
                            chunk_index=row.chunk_index,
                            matched_snippet=snippet,
                            similarity_score=0.85,
                            match_type="keyword",
                            matched_chunks_count=1,
                            created_at=row.created_at,
                            updated_at=row.updated_at
                        )
                    else:
                        best_by_file[fid].match_type = "hybrid"
                        best_by_file[fid].matched_chunks_count = (best_by_file[fid].matched_chunks_count or 1) + 1
            except Exception as e:
                print(f"[Search Error] Keyword search failed: {e}")

        # Convert to list and sort results by similarity score descending
        results = list(best_by_file.values())
        results.sort(key=lambda x: x.similarity_score, reverse=True)
        duration_ms = (time.time() - start_time) * 1000.0

        return SearchResponse(
            query=req.query,
            total_results=len(results),
            results=results[:req.limit],
            duration_ms=round(duration_ms, 2)
        )

search_service = SearchService()

