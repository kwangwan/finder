from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
import uuid

class FolderBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    parent_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    icon: Optional[str] = "folder"
    color: Optional[str] = None

class FolderCreate(FolderBase):
    pass

class FolderUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    parent_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    icon: Optional[str] = None
    color: Optional[str] = None

class FolderResponse(FolderBase):
    id: uuid.UUID
    created_by: Optional[uuid.UUID] = None
    # Set on a personal folder in the shared workspace. The client needs it to
    # know whose folder this is — only the owner is offered the share setting.
    owner_user_id: Optional[uuid.UUID] = None
    is_trashed: bool = False
    trashed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    file_count: Optional[int] = 0
    # Whether *this* reader may put things in this folder. Sent with the folder
    # because every menu and button that offers a write needs the answer, and
    # working it out on the client meant guessing at rules the server owns —
    # which is how "새 폴더" ended up offered inside somebody else's folder.
    can_write: bool = True

    model_config = ConfigDict(from_attributes=True)

class FolderTreeNode(FolderResponse):
    children: List["FolderTreeNode"] = []
    file_count: int = 0

class PagedFolderResponse(BaseModel):
    items: List[FolderResponse]
    total_count: int
    page: int
    page_size: int
    total_pages: int

class EnsurePathRequest(BaseModel):
    workspace_id: uuid.UUID
    relative_path: str
    parent_id: Optional[uuid.UUID] = None

class EnsurePathResponse(BaseModel):
    folder_id: Optional[uuid.UUID] = None
    folder_name: str
    relative_path: str

