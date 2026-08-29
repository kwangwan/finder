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
    def _append_filters(sql: str, params: dict, req: SearchRequest, user_ws_ids, current_user, prefix: str) -> str:
        """
        Append the workspace-access and user-filter WHERE clauses shared by
        every query in this service.

        `prefix` namespaces the generated workspace bind parameters so two of
        these clauses can coexist in one statement (the total-count query
        UNIONs two of them) without colliding on :ws_0, :ws_1, ...
        """
        if req.workspace_id:
            sql += " AND f.workspace_id = :workspace_id"
            params["workspace_id"] = req.workspace_id
        elif user_ws_ids is not None:
            if user_ws_ids:
                ws_params = {f"{prefix}ws_{i}": wid for i, wid in enumerate(user_ws_ids)}
                placeholders = ", ".join(f":{prefix}ws_{i}" for i in range(len(user_ws_ids)))
                sql += f" AND (f.workspace_id IN ({placeholders}) OR (f.workspace_id IS NULL AND f.created_by = :current_user_id))"
                params.update(ws_params)
                params["current_user_id"] = current_user.id
            else:
                sql += " AND (f.workspace_id IS NULL AND f.created_by = :current_user_id)"
                params["current_user_id"] = current_user.id

        if req.folder_id:
            sql += " AND f.folder_id = :folder_id"
            params["folder_id"] = req.folder_id
        if req.file_type:
            sql += " AND f.file_type = :file_type"
            params["file_type"] = req.file_type
        if req.author_id:
            sql += " AND f.created_by = :author_id"
            params["author_id"] = req.author_id
        if req.start_date:
            sql += " AND f.created_at >= :start_date"
            params["start_date"] = req.start_date
        if req.end_date:
            sql += " AND f.created_at <= :end_date"
            params["end_date"] = req.end_date
        return sql

    async def _count_total_matches(self, db: AsyncSession, req: SearchRequest, user_ws_ids, current_user, vec_str) -> int:
        """
        Count the distinct files this query matches, independently of the
        candidate pool actually fetched, so the UI can honestly say
        "N개 중 M개 표시" and know whether a "더 보기" is worth offering.

        Cheap here: the chunk table is small (only text-bearing documents are
        embedded), and the file-name scan is a single pass over kb_files.
        """
        name_sql = "SELECT f.id AS fid FROM kb_files f WHERE f.is_trashed = FALSE AND f.name ILIKE :kw"
        params = {"kw": f"%{req.query.strip()}%", "min_sim": req.min_similarity}
        name_sql = self._append_filters(name_sql, params, req, user_ws_ids, current_user, "cn_")

        chunk_conditions = ["c.content ILIKE :kw"] if req.include_keyword_match else []
        if vec_str is not None:
            chunk_conditions.append(f"(c.embedding IS NOT NULL AND 1 - (c.embedding <=> '{vec_str}'::vector) >= :min_sim)")

        parts = []
        if req.include_keyword_match:
            parts.append(name_sql)
        if chunk_conditions:
            chunk_sql = (
                "SELECT c.file_id AS fid FROM kb_document_chunks c "
                "JOIN kb_files f ON c.file_id = f.id "
                f"WHERE f.is_trashed = FALSE AND ({' OR '.join(chunk_conditions)})"
            )
            parts.append(self._append_filters(chunk_sql, params, req, user_ws_ids, current_user, "cc_"))

        if not parts:
            return 0

        count_sql = f"SELECT COUNT(*) FROM (SELECT DISTINCT fid FROM ({' UNION '.join(parts)}) u) t"
        try:
            return int((await db.execute(text(count_sql), params)).scalar_one())
        except Exception as e:
            print(f"[Search Error] Total count failed: {e}")
            return 0

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

        # Candidate pool. Sized from offset+limit, not limit alone, because
        # the merged result list is sliced by offset at the end: paging to
        # offset=60 needs at least 60+limit ranked files to slice from. The
        # x5 factor absorbs chunk→file dedupe (one document can occupy many
        # of the top chunks, so N chunks yield fewer than N distinct files).
        fetch_target = req.offset + req.limit
        candidate_limit = max(fetch_target * 5, 100)

        vec_str = None

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
            query_sql = self._append_filters(query_sql, params, req, user_ws_ids, current_user, "s_")
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

        # 4. File-name match.
        #
        # Runs against kb_files directly, with NO join to kb_document_chunks.
        # The keyword step below already had `f.name ILIKE :kw` in its WHERE
        # clause, but it selects `FROM kb_document_chunks c JOIN kb_files f`,
        # so a file with no chunks could never be returned however well its
        # name matched — which is every image and video (nothing is extracted
        # or embedded for them) plus any document whose embedding hasn't run
        # yet. Searching for a photo or a video by its filename therefore
        # always came back empty.
        #
        # It also runs unconditionally, unlike the keyword step's
        # `len(best_by_file) < req.limit` guard: a filename is the most
        # literal thing a user can search for, so it must not be dropped just
        # because semantic matching already filled the result pool.
        if req.include_keyword_match:
            name_term = f"%{req.query.strip()}%"
            query_norm = req.query.strip().lower()
            # The match score is computed HERE, in SQL, rather than in Python
            # afterwards, so this query can order by exactly the key the final
            # merged sort uses (score desc, then file id).
            #
            # It has to: the candidate pool is a LIMIT over a table with tens
            # of thousands of rows, so it is only ever a slice of the matches.
            # When the slice was taken in name order but the results were then
            # re-sorted by (score, id) — and every substring hit scores the
            # same 0.9, making id the real key — growing the pool for the next
            # page pulled in files that interleaved by id *anywhere*, including
            # ahead of the current offset. Page N+1 then overlapped page N
            # instead of continuing it: paging "2026" stalled at 63 unique
            # results while every further request returned 30 already-seen rows
            # and has_more stayed true, so the client looped forever. Selecting
            # in the same order the final ranking uses makes each pool a true
            # prefix of that ranking, so offsets line up.
            name_sql = """
                SELECT
                    f.id as file_id,
                    f.name as file_name,
                    f.workspace_id,
                    f.folder_id,
                    f.created_by,
                    u.name as author_name,
                    f.file_type,
                    f.is_markdown,
                    f.created_at,
                    f.updated_at,
                    fol.name as folder_name,
                    CASE
                        WHEN lower(f.name) = :q_exact THEN 1.0
                        WHEN lower(f.name) LIKE :q_prefix THEN 0.95
                        ELSE 0.9
                    END as name_score
                FROM kb_files f
                LEFT JOIN kb_folders fol ON f.folder_id = fol.id
                LEFT JOIN kb_users u ON f.created_by = u.id
                WHERE f.is_trashed = FALSE
                  AND f.name ILIKE :kw
            """
            name_params = {
                "kw": name_term,
                "q_exact": query_norm,
                "q_prefix": f"{query_norm}%",
                "limit": candidate_limit,
            }
            name_sql = self._append_filters(name_sql, name_params, req, user_ws_ids, current_user, "n_")
            # Must match the final sort in search() exactly — see the note on
            # name_score above for why selecting in a different order breaks
            # pagination. An exact name hit ranks above a prefix hit, both
            # above a mere substring, and all above the 0.85 the chunk-content
            # keyword match uses: if someone types a filename, that file
            # belongs at the top, not under a loosely-related document body.
            name_sql += " ORDER BY name_score DESC, f.id ASC LIMIT :limit;"

            try:
                name_res = await db.execute(text(name_sql), name_params)

                for row in name_res.fetchall():
                    fid = row.file_id
                    name_score = float(row.name_score)

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
                            chunk_index=0,
                            # No chunk backs a filename hit (an image or video
                            # has no extracted text at all), so the name is
                            # the only meaningful thing to show as the match.
                            matched_snippet=row.file_name,
                            similarity_score=name_score,
                            match_type="filename",
                            matched_chunks_count=0,
                            created_at=row.created_at,
                            updated_at=row.updated_at
                        )
                    else:
                        # Already found by content — the name matching too
                        # makes it a stronger hit, not a separate one.
                        existing = best_by_file[fid]
                        existing.match_type = "hybrid"
                        if name_score > existing.similarity_score:
                            existing.similarity_score = name_score
            except Exception as e:
                print(f"[Search Error] File name search failed: {e}")

        # 5. Keyword / Text search supplement (Hybrid search)
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
            kw_sql = self._append_filters(kw_sql, kw_params, req, user_ws_ids, current_user, "k_")
            kw_sql += " ORDER BY c.file_id, c.chunk_index LIMIT :limit;"

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

        # Convert to list and sort results by similarity score descending.
        # file_id is the tiebreaker: scores collide constantly here (every
        # plain filename match is 0.9, every content keyword match 0.85), and
        # without a deterministic secondary key the order of tied items could
        # differ between the request for one page and the request for the
        # next — putting the same file on two pages while another never
        # appears, the same defect that OFFSET pagination hit in list_files.
        results = list(best_by_file.values())
        results.sort(key=lambda x: (-x.similarity_score, str(x.file_id)))

        total_results = await self._count_total_matches(db, req, user_ws_ids, current_user, vec_str)
        page = results[req.offset:req.offset + req.limit]
        # Fall back to the pool size if the count query failed, so "has_more"
        # never claims there is nothing left purely because counting broke.
        total_results = max(total_results, req.offset + len(page))

        duration_ms = (time.time() - start_time) * 1000.0

        return SearchResponse(
            query=req.query,
            total_results=total_results,
            results=page,
            duration_ms=round(duration_ms, 2),
            offset=req.offset,
            # Only claim more exists when this page was actually full — a
            # short page means the ranked pool is exhausted, whatever the
            # count says.
            has_more=len(page) == req.limit and (req.offset + len(page)) < total_results
        )

search_service = SearchService()

