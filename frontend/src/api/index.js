const API_BASE = '/api';

/**
 * Auth Token Helpers
 */
export function getStoredToken() {
  return localStorage.getItem('kb_auth_token');
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem('kb_auth_token', token);
  } else {
    localStorage.removeItem('kb_auth_token');
  }
}

export function authHeaders(extraHeaders = {}) {
  const token = getStoredToken();
  const headers = { ...extraHeaders };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function getAuthConfig() {
  try {
    const res = await fetch(`${API_BASE}/auth/config`);
    if (!res.ok) return { google_client_id: '' };
    return res.json();
  } catch (e) {
    return { google_client_id: '' };
  }
}

/**
 * Authentication API
 */
export async function loginWithGoogle(idToken) {
  const res = await fetch(`${API_BASE}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '구글 로그인 실패');
  }
  const data = await res.json();
  setStoredToken(data.access_token);
  return data;
}

export async function registerWithPassword(email, password, name = '', inviteToken = null) {
  const res = await fetch(`${API_BASE}/auth/register-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name, invite_token: inviteToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '회원가입 실패');
  }
  const data = await res.json();
  setStoredToken(data.access_token);
  return data;
}

export async function loginWithPassword(email, password) {
  const res = await fetch(`${API_BASE}/auth/login-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '로그인 실패');
  }
  const data = await res.json();
  setStoredToken(data.access_token);
  return data;
}

export async function devLogin(email, name = '') {
  const res = await fetch(`${API_BASE}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '로그인 실패');
  }
  const data = await res.json();
  setStoredToken(data.access_token);
  return data;
}

export async function getMe() {
  const token = getStoredToken();
  if (!token) return null;

  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    if (res.status === 401) {
      setStoredToken(null);
      return null;
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '사용자 정보 조회 실패');
  }
  return res.json();
}

export function logout() {
  setStoredToken(null);
}

/**
 * Admin User Management API
 */
export async function getAdminUsers() {
  const res = await fetch(`${API_BASE}/admin/users`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('관리자 회원 목록 조회 실패');
  return res.json();
}

export async function toggleApproveUser(userId, isApproved) {
  const res = await fetch(`${API_BASE}/admin/users/${userId}/approve`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ is_approved: isApproved }),
  });
  if (!res.ok) throw new Error('승인 상태 변경 실패');
  return res.json();
}

export async function toggleAdminUser(userId, isAdmin) {
  const res = await fetch(`${API_BASE}/admin/users/${userId}/admin`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ is_admin: isAdmin }),
  });
  if (!res.ok) throw new Error('관리자 권한 변경 실패');
  return res.json();
}

export async function deleteAdminUser(userId) {
  const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('회원 삭제 실패');
  return true;
}

export async function updateUserQuota(userId, storageQuotaBytes) {
  const res = await fetch(`${API_BASE}/admin/users/${userId}/quota`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ storage_quota_bytes: storageQuotaBytes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '용량 변경 실패');
  }
  return res.json();
}

/**
 * Workspaces API
 */
export async function listWorkspaces() {
  const res = await fetch(`${API_BASE}/workspaces`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('워크스페이스 목록 조회 실패');
  return res.json();
}

export async function createWorkspace({ name, description = '', icon = 'briefcase' }) {
  const res = await fetch(`${API_BASE}/workspaces`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, description, icon }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '워크스페이스 생성 실패');
  }
  return res.json();
}

export async function getWorkspace(workspaceId) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('워크스페이스 상세 조회 실패');
  return res.json();
}

export async function updateWorkspace(workspaceId, { name, description, icon }) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, description, icon }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '워크스페이스 수정 실패');
  }
  return res.json();
}

export async function deleteWorkspace(workspaceId) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '워크스페이스 삭제 실패');
  }
  return true;
}

export async function listWorkspaceMembers(workspaceId) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/members`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('멤버 목록 조회 실패');
  return res.json();
}

export async function inviteWorkspaceMember(workspaceId, { email, role = 'member' }) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/members`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '멤버 초대 실패');
  }
  return res.json();
}

export async function updateWorkspaceMemberRole(workspaceId, userId, role) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/members/${userId}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '멤버 역할 변경 실패');
  }
  return res.json();
}

export async function removeWorkspaceMember(workspaceId, userId) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/members/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '멤버 제거 실패');
  }
  return true;
}

/**
 * Invitations API (7-day Expiration & AWS SES support)
 */
export async function listInvitations(workspaceId = null) {
  const params = new URLSearchParams();
  if (workspaceId) params.append('workspace_id', workspaceId);

  const res = await fetch(`${API_BASE}/invitations?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('초대 목록 조회 실패');
  return res.json();
}

export async function createInvitation({ email, workspace_id = null, role = 'member' }) {
  const res = await fetch(`${API_BASE}/invitations`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, workspace_id, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '초대장 발송 실패');
  }
  return res.json();
}

export async function cancelInvitation(invitationId) {
  const res = await fetch(`${API_BASE}/invitations/${invitationId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '초대 취소 실패');
  }
  return true;
}

export async function verifyInvitationToken(token) {
  const res = await fetch(`${API_BASE}/invitations/verify/${token}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '초대 링크 검증 실패');
  }
  return res.json();
}

export async function acceptInvitation({ token, name = '', password = '' }) {
  const res = await fetch(`${API_BASE}/invitations/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '초대 수락 실패');
  }
  const data = await res.json();
  setStoredToken(data.access_token);
  return data;
}

/**
 * Storage & Configuration API
 */
export async function getStorageConfig() {
  const res = await fetch(`${API_BASE}/storage/config`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load storage config');
  return res.json();
}

export async function getSystemStats(workspaceId = null) {
  const params = new URLSearchParams();
  if (workspaceId) params.append('workspace_id', workspaceId);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/system/stats${qs ? '?' + qs : ''}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load system stats');
  return res.json();
}

/**
 * Folders API
 */
export async function getFolderTree(workspaceId = null) {
  const params = new URLSearchParams();
  if (workspaceId) params.append('workspace_id', workspaceId);

  const res = await fetch(`${API_BASE}/folders/tree?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load folder tree');
  return res.json();
}

export async function createFolder({ name, parent_id = null, workspace_id = null, icon = 'folder', color = null }) {
  const res = await fetch(`${API_BASE}/folders`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, parent_id, workspace_id, icon, color }),
  });
  if (!res.ok) throw new Error('Failed to create folder');
  return res.json();
}

export async function updateFolder(folderId, { name, parent_id, workspace_id, icon, color }) {
  const res = await fetch(`${API_BASE}/folders/${folderId}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, parent_id, workspace_id, icon, color }),
  });
  if (!res.ok) throw new Error('Failed to update folder');
  return res.json();
}

export async function renameFolder(folderId, name) {
  const res = await fetch(`${API_BASE}/folders/${folderId}/rename`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to rename folder');
  return res.json();
}

export async function moveToTrashFolder(folderId) {
  const res = await fetch(`${API_BASE}/folders/${folderId}/trash`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to move folder to trash');
  return res.json();
}

export async function restoreFolder(folderId) {
  const res = await fetch(`${API_BASE}/folders/${folderId}/restore`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to restore folder');
  return res.json();
}

export async function deleteFolder(folderId) {
  const res = await fetch(`${API_BASE}/folders/${folderId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete folder');
  return true;
}

export async function listFolders({
  workspace_id = null,
  parent_id = null,
  sort_by = 'name',
  sort_order = 'asc',
  page = null,
  page_size = null,
  paged = false
} = {}) {
  const params = new URLSearchParams();
  if (workspace_id) params.append('workspace_id', workspace_id);
  if (parent_id) params.append('parent_id', parent_id);
  if (sort_by) params.append('sort_by', sort_by);
  if (sort_order) params.append('sort_order', sort_order);
  if (page !== null && page !== undefined) params.append('page', page);
  if (page_size !== null && page_size !== undefined) params.append('page_size', page_size);
  if (paged) params.append('paged', 'true');

  const res = await fetch(`${API_BASE}/folders?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to list folders');
  return res.json();
}

/**
 * Files & Markdown Notes API
 */
export async function listFiles({
  workspace_id = null,
  folder_id = null,
  file_type = null,
  is_favorite = null,
  search = '',
  sort_by = 'updated_at',
  sort_order = 'desc',
  page = null,
  page_size = null,
  paged = false
} = {}) {
  const params = new URLSearchParams();
  if (workspace_id) params.append('workspace_id', workspace_id);
  if (folder_id) params.append('folder_id', folder_id);
  if (file_type) params.append('file_type', file_type);
  if (is_favorite !== null && is_favorite !== undefined) params.append('is_favorite', is_favorite);
  if (search) params.append('search', search);
  if (sort_by) params.append('sort_by', sort_by);
  if (sort_order) params.append('sort_order', sort_order);
  if (page !== null && page !== undefined) params.append('page', page);
  if (page_size !== null && page_size !== undefined) params.append('page_size', page_size);
  if (paged) params.append('paged', 'true');

  const res = await fetch(`${API_BASE}/files?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to list files');
  return res.json();
}


export async function getFileDetail(fileId) {
  const res = await fetch(`${API_BASE}/files/${fileId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to get file detail');
  return res.json();
}

export async function createMarkdownNote({ name, folder_id = null, workspace_id = null, content = '', tags = [] }) {
  const res = await fetch(`${API_BASE}/files/notes`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, folder_id, workspace_id, content, tags }),
  });
  if (!res.ok) throw new Error('Failed to create note');
  return res.json();
}

export async function updateMarkdownNote(fileId, { name, folder_id, workspace_id, content, tags, is_favorite }) {
  const res = await fetch(`${API_BASE}/files/notes/${fileId}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, folder_id, workspace_id, content, tags, is_favorite }),
  });
  if (!res.ok) throw new Error('Failed to update note');
  return res.json();
}

export async function moveFile(fileId, folder_id) {
  const res = await fetch(`${API_BASE}/files/${fileId}/move`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ folder_id }),
  });
  if (!res.ok) throw new Error('Failed to move file');
  return res.json();
}

export async function renameFile(fileId, name) {
  const res = await fetch(`${API_BASE}/files/${fileId}/rename`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to rename file');
  return res.json();
}

export async function moveToTrashFile(fileId) {
  const res = await fetch(`${API_BASE}/files/${fileId}/trash`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to move file to trash');
  return res.json();
}

export async function restoreFile(fileId) {
  const res = await fetch(`${API_BASE}/files/${fileId}/restore`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to restore file');
  return res.json();
}

export async function deleteFile(fileId) {
  const res = await fetch(`${API_BASE}/files/${fileId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete file');
  return true;
}

/**
 * Trash / Recycle Bin API (30-day auto purge)
 */
export async function listTrash(workspaceId = null) {
  const params = new URLSearchParams();
  if (workspaceId) params.append('workspace_id', workspaceId);

  const res = await fetch(`${API_BASE}/trash?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('휴지통 목록을 불러오지 못했습니다');
  return res.json();
}

export async function deletePermanentFile(fileId) {
  const res = await fetch(`${API_BASE}/trash/files/${fileId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('파일 영구 삭제 실패');
  return true;
}

export async function deletePermanentFolder(folderId) {
  const res = await fetch(`${API_BASE}/trash/folders/${folderId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('폴더 영구 삭제 실패');
  return true;
}

export async function emptyTrash(workspaceId = null) {
  const params = new URLSearchParams();
  if (workspaceId) params.append('workspace_id', workspaceId);

  const res = await fetch(`${API_BASE}/trash/empty?${params.toString()}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('휴지통 비우기 실패');
  return res.json();
}

export function getMediaPreviewUrl(fileId) {
  const token = getStoredToken();
  return `${API_BASE}/storage/preview/${fileId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getFileDownloadUrl(fileId) {
  const token = getStoredToken();
  return `${API_BASE}/storage/download/${fileId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getThumbnailUrl(fileId) {
  const token = getStoredToken();
  return `${API_BASE}/storage/thumbnail/${fileId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export async function getPresignedDownloadUrl(fileId) {
  const res = await fetch(`${API_BASE}/storage/presigned-download/${fileId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to get presigned download url');
  return res.json();
}

/**
 * Cloudflare Zero Trust Aware Chunked Range Download & Direct Download
 */
export async function downloadFileChunked(fileId, filename, sizeBytes, onProgress = () => {}) {
  const chunkSize = 50 * 1024 * 1024;

  if (!sizeBytes || sizeBytes <= chunkSize) {
    try {
      const res = await fetch(`${API_BASE}/storage/download/${fileId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Direct download failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      return;
    } catch (e) {
      console.warn('Direct download failed, trying chunk download:', e);
    }
  }

  const totalParts = Math.ceil(sizeBytes / chunkSize) || 1;
  const chunkBlobs = [];

  for (let part = 0; part < totalParts; part++) {
    const start = part * chunkSize;
    const end = Math.min(start + chunkSize - 1, sizeBytes - 1);

    const percent = Math.round((part / totalParts) * 100);
    onProgress({
      percent,
      status: `청크 ${part + 1}/${totalParts} 다운로드 중 (${Math.round((end - start + 1) / (1024 * 1024))}MB)...`,
    });

    const res = await fetch(`${API_BASE}/storage/chunk-download/${fileId}`, {
      headers: authHeaders({
        Range: `bytes=${start}-${end}`,
      }),
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(`청크 ${part + 1} 다운로드 실패: ${res.statusText}`);
    }

    const blob = await res.blob();
    chunkBlobs.push(blob);
  }

  onProgress({ percent: 100, status: '파일 조립 완료! 저장 중...' });

  const finalBlob = new Blob(chunkBlobs);
  const blobUrl = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

/**
 * Semantic & Hybrid Search API (with Advanced Filtering)
 */
export async function searchDocuments({
  query,
  workspace_id = null,
  folder_id = null,
  file_type = null,
  author_id = null,
  start_date = null,
  end_date = null,
  limit = 10,
  min_similarity = 0.2
}) {
  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      query,
      workspace_id,
      folder_id,
      file_type,
      author_id,
      start_date,
      end_date,
      limit,
      min_similarity
    }),
  });
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}


/**
 * Cloudflare Zero Trust Aware Multipart / Presigned Chunked File Uploader
 */
export async function uploadFileChunked(file, folderId = null, workspaceId = null, onProgress = () => {}) {
  const chunkSize = 50 * 1024 * 1024;
  const fileSize = file.size;

  // Single chunk upload (< 50MB) - Direct upload through backend (Fast & 100% reliable)
  if (fileSize <= chunkSize) {
    return directUploadFallback(file, folderId, workspaceId, onProgress);
  }

  // Large Multipart Chunked Upload (> 50MB)
  onProgress({ percent: 5, status: '대용량 Multipart 업로드 세션 초기화...' });

  const initRes = await fetch(`${API_BASE}/storage/multipart/initiate`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      filename: file.name,
      folder_id: folderId,
      workspace_id: workspaceId,
      content_type: file.type || 'application/octet-stream',
      size_bytes: fileSize,
    }),
  });

  if (!initRes.ok) {
    console.warn('Multipart init failed, trying direct upload:', await initRes.text());
    return directUploadFallback(file, folderId, workspaceId, onProgress);
  }

  const { upload_id, s3_key, total_parts } = await initRes.json();
  const completedParts = [];

  try {
    for (let partNumber = 1; partNumber <= total_parts; partNumber++) {
      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(start + chunkSize, fileSize);
      const chunkBlob = file.slice(start, end);

      const currentPercent = Math.round(((partNumber - 1) / total_parts) * 80) + 5;
      onProgress({
        percent: currentPercent,
        status: `청크 ${partNumber}/${total_parts} 업로드 중 (${config.max_chunk_size_mb}MB 단위)...`,
      });

      const partUrlRes = await fetch(`${API_BASE}/storage/multipart/part-urls`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          s3_key,
          upload_id,
          part_numbers: [partNumber],
        }),
      });

      if (!partUrlRes.ok) throw new Error(`청크 ${partNumber} Presigned URL 발급 실패`);
      const { parts } = await partUrlRes.json();
      const partUrl = parts[0].upload_url;

      const partUploadRes = await fetch(partUrl, {
        method: 'PUT',
        body: chunkBlob,
      });

      if (!partUploadRes.ok) throw new Error(`청크 ${partNumber} 업로드 실패`);

      let etag = partUploadRes.headers.get('ETag') || `"${partNumber}"`;
      completedParts.push({
        PartNumber: partNumber,
        ETag: etag,
      });
    }

    onProgress({ percent: 90, status: '청크 결합 및 업로드 완료 처리 중...' });

    let fileType = 'other';
    const nameLower = file.name.toLowerCase();
    if (nameLower.endsWith('.md')) fileType = 'markdown';
    else if (nameLower.endsWith('.pdf')) fileType = 'pdf';
    else if (nameLower.endsWith('.docx') || nameLower.endsWith('.doc')) fileType = 'docx';
    else if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) fileType = 'xlsx';

    const completeRes = await fetch(`${API_BASE}/storage/multipart/complete`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        s3_key,
        upload_id,
        parts: completedParts,
        filename: file.name,
        folder_id: folderId,
        workspace_id: workspaceId,
        file_type: fileType,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: fileSize,
      }),
    });

    if (!completeRes.ok) throw new Error('Multipart 업로드 완료 처리 실패');
    const resultFile = await completeRes.json();
    onProgress({ percent: 100, status: '완료!' });
    return resultFile;
  } catch (e) {
    fetch(`${API_BASE}/storage/multipart/abort`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ s3_key, upload_id }),
    }).catch(() => {});
    throw e;
  }
}

async function directUploadFallback(file, folderId, workspaceId, onProgress) {
  onProgress({ percent: 40, status: '서버를 통해 업로드 중...' });
  const formData = new FormData();
  formData.append('file', file);
  if (folderId) formData.append('folder_id', folderId);
  if (workspaceId) formData.append('workspace_id', workspaceId);

  const res = await fetch(`${API_BASE}/storage/direct-upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) throw new Error('Direct upload failed');
  onProgress({ percent: 100, status: '완료!' });
  return res.json();
}
