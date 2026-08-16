import httpx
from typing import List, Optional
from app.core.config import settings

class EmbeddingService:
    def __init__(self):
        self.base_url = settings.OPENWEBUI_URL.rstrip('/')
        self.api_key = settings.OPENWEBUI_API_KEY
        self.model = settings.OPENWEBUI_EMBEDDING_MODEL
        self.dim = settings.EMBEDDING_DIM

    def _get_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def get_embedding(self, text: str) -> Optional[List[float]]:
        """Get 768-dim vector embedding for a single text chunk."""
        if not text or not text.strip():
            return None

        # Clean and truncate text if too long
        cleaned_text = text.strip()[:4000]

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/embeddings",
                    headers=self._get_headers(),
                    json={
                        "model": self.model,
                        "input": cleaned_text
                    }
                )

                if response.status_code == 200:
                    data = response.json()
                    embedding = data["data"][0]["embedding"]
                    # Validate dimension
                    if len(embedding) == self.dim:
                        return embedding
                    elif len(embedding) > self.dim:
                        return embedding[:self.dim]
                    else:
                        # Pad with zeros if shorter
                        return embedding + [0.0] * (self.dim - len(embedding))
                else:
                    print(f"[Embedding Error] OpenWebUI status {response.status_code}: {response.text[:200]}")
                    return None
        except Exception as e:
            print(f"[Embedding Exception] Failed to get embedding: {e}")
            return None

    async def get_embeddings_batch(self, texts: List[str]) -> List[Optional[List[float]]]:
        """Get embeddings for multiple text chunks in parallel or batch."""
        results = []
        for text in texts:
            emb = await self.get_embedding(text)
            results.append(emb)
        return results

embedding_service = EmbeddingService()
