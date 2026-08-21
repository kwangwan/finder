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
    ensureMediaToken();
  } else {
    localStorage.removeItem('kb_auth_token');
    clearMediaToken();
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

/**
 * Media Token Helpers
 *
 * <img>/<video>/<a> tags hit preview/thumbnail/download URLs directly and can't
 * attach an Authorization header, so those URLs carry a token as a query param
 * instead. Using the full session token there would mean a URL that leaks via
 * browser history, a server access log, or a Referer header hands out full API
 * access for the token's entire (multi-day) lifetime. Instead we keep a
 * short-lived, media-scoped token (see POST /api/auth/media-token) cached here
 * and refreshed periodically, so a leaked media URL is only useful for a few
 * minutes and only for fetching media.
 */
let mediaTokenCache = { token: null, expiresAt: 0 };
let mediaTokenRefreshPromise = null;

async function fetchMediaToken() {
  const res = await fetch(`${API_BASE}/auth/media-token`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to obtain media token');
  const data = await res.json();
  mediaTokenCache = {
    token: data.media_token,
    // Refresh a bit before actual expiry so in-flight page views don't race it
    expiresAt: Date.now() + Math.max(0, data.expires_in * 1000 - 30000)
  };
  return mediaTokenCache.token;
}

export async function ensureMediaToken() {
  if (!getStoredToken()) return null;
  if (mediaTokenCache.token && Date.now() < mediaTokenCache.expiresAt) {
    return mediaTokenCache.token;
  }
  if (!mediaTokenRefreshPromise) {
    mediaTokenRefreshPromise = fetchMediaToken()
      .catch((err) => { console.warn('[Media Token] refresh failed:', err); return null; })
      .finally(() => { mediaTokenRefreshPromise = null; });
  }
  return mediaTokenRefreshPromise;
}

function getCachedMediaToken() {
  return (mediaTokenCache.token && Date.now() < mediaTokenCache.expiresAt) ? mediaTokenCache.token : null;
}

export function clearMediaToken() {
  mediaTokenCache = { token: null, expiresAt: 0 };
}

// Warm the cache on page load for a returning (already-logged-in) session, and
// keep it fresh for the lifetime of the tab.
if (getStoredToken()) {
  ensureMediaToken();
}
setInterval(() => { if (getStoredToken()) ensureMediaToken(); }, 5 * 60 * 1000);

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
export async function loginWithGoogle(idToken, inviteToken = null) {
  const res = await fetch(`${API_BASE}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken, invite_token: inviteToken }),
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
  root_only = false,
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
  if (root_only) params.append('root_only', 'true');
  else if (folder_id) params.append('folder_id', folder_id);
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
  const token = getCachedMediaToken();
  return `${API_BASE}/storage/preview/${fileId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getFileDownloadUrl(fileId) {
  const token = getCachedMediaToken();
  return `${API_BASE}/storage/download/${fileId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getThumbnailUrl(fileId) {
  const token = getCachedMediaToken();
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
 * Resilient Fetch with Exponential Backoff Retry (for flaky networks/glitches)
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3, baseDelay = 1000) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok && (res.status >= 500 || res.status === 429)) {
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
        console.warn(`[Network Retry] Attempt ${attempt + 1} failed for ${url}. Retrying in ${Math.round(delay)}ms...`, err);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Ensure folder path exists (recursively creates missing folders)
 */
export async function ensureFolderPath(workspaceId, parentFolderId, relativePath) {
  const res = await fetchWithRetry(`${API_BASE}/folders/ensure-path`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      workspace_id: workspaceId,
      parent_id: parentFolderId || null,
      relative_path: relativePath,
    }),
  });
  if (!res.ok) throw new Error('폴더 경로 생성 실패');
  return res.json();
}

/**
 * Cloudflare Zero Trust Aware Resilient Chunked Range Download
 */
export async function downloadFileChunked(fileId, filename, sizeBytes, onProgress = () => {}, signal = null) {
  const chunkSize = 50 * 1024 * 1024; // 50MB chunks

  // Small file direct download
  if (!sizeBytes || sizeBytes <= chunkSize) {
    try {
      const res = await fetchWithRetry(`${API_BASE}/storage/download/${fileId}`, {
        headers: authHeaders(),
        signal,
      }, 3);
      if (!res.ok) throw new Error('Direct download failed');

      const contentLength = Number(res.headers.get('Content-Length')) || sizeBytes || 0;
      let loaded = 0;

      const reader = res.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (contentLength > 0) {
          onProgress({
            percent: Math.min(99, Math.round((loaded / contentLength) * 100)),
            loaded,
            total: contentLength,
            status: `다운로드 중 (${(loaded / (1024 * 1024)).toFixed(1)}MB / ${(contentLength / (1024 * 1024)).toFixed(1)}MB)...`,
          });
        }
      }

      onProgress({ percent: 100, status: '파일 저장 중...' });
      const blob = new Blob(chunks);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      return;
    } catch (e) {
      if (signal && signal.aborted) throw e;
      console.warn('Direct download failed, falling back to multi-part chunk download:', e);
    }
  }

  // Large file / multi-part range download
  const totalParts = Math.ceil(sizeBytes / chunkSize) || 1;
  const chunkBlobs = [];

  for (let part = 0; part < totalParts; part++) {
    if (signal && signal.aborted) {
      throw new Error('Download aborted by user');
    }

    const start = part * chunkSize;
    const end = Math.min(start + chunkSize - 1, sizeBytes - 1);
    const partSizeMB = ((end - start + 1) / (1024 * 1024)).toFixed(1);

    onProgress({
      percent: Math.round((part / totalParts) * 100),
      status: `청크 ${part + 1}/${totalParts} 다운로드 중 (${partSizeMB}MB)...`,
    });

    const res = await fetchWithRetry(`${API_BASE}/storage/chunk-download/${fileId}`, {
      headers: authHeaders({
        Range: `bytes=${start}-${end}`,
      }),
      signal,
    }, 4, 1500);

    if (!res.ok && res.status !== 206) {
      throw new Error(`청크 ${part + 1}/${totalParts} 다운로드 실패: ${res.statusText}`);
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
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * Download entire folder as ZIP archive (recursive)
 */
export async function downloadFolderAsZip(folderId, folderName, onProgress = () => {}, signal = null) {
  onProgress({ percent: 10, status: '서버에서 폴더 압축 준비 중...' });

  const res = await fetchWithRetry(`${API_BASE}/folders/${folderId}/download`, {
    headers: authHeaders(),
    signal,
  }, 3);

  if (!res.ok) throw new Error('폴더 ZIP 다운로드 실패');

  const contentLength = Number(res.headers.get('Content-Length')) || 0;
  let loaded = 0;

  const reader = res.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (contentLength > 0) {
      onProgress({
        percent: Math.min(99, Math.round((loaded / contentLength) * 100)),
        loaded,
        total: contentLength,
        status: `압축 파일 수신 중 (${(loaded / (1024 * 1024)).toFixed(1)}MB / ${(contentLength / (1024 * 1024)).toFixed(1)}MB)...`,
      });
    } else {
      onProgress({
        percent: 50,
        status: `압축 파일 수신 중 (${(loaded / (1024 * 1024)).toFixed(1)}MB)...`,
      });
    }
  }

  onProgress({ percent: 100, status: '압축 파일 저장 중...' });

  const finalBlob = new Blob(chunks, { type: 'application/zip' });
  const blobUrl = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `${folderName || 'folder'}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * Download multiple files and folders as a single ZIP archive
 */
export async function batchDownloadFiles({
  workspaceId,
  fileIds = [],
  folderIds = [],
  archiveName = 'download_archive.zip',
  onProgress = () => {},
  signal = null,
}) {
  onProgress({ percent: 10, status: '선택 항목 압축 준비 중...' });

  const res = await fetchWithRetry(`${API_BASE}/files/batch-download`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      workspace_id: workspaceId,
      file_ids: fileIds,
      folder_ids: folderIds,
      archive_name: archiveName,
    }),
    signal,
  }, 3);

  if (!res.ok) throw new Error('일괄 ZIP 다운로드 실패');

  const contentLength = Number(res.headers.get('Content-Length')) || 0;
  let loaded = 0;

  const reader = res.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (contentLength > 0) {
      onProgress({
        percent: Math.min(99, Math.round((loaded / contentLength) * 100)),
        loaded,
        total: contentLength,
        status: `압축 파일 수신 중 (${(loaded / (1024 * 1024)).toFixed(1)}MB / ${(contentLength / (1024 * 1024)).toFixed(1)}MB)...`,
      });
    } else {
      onProgress({
        percent: 50,
        status: `압축 파일 수신 중 (${(loaded / (1024 * 1024)).toFixed(1)}MB)...`,
      });
    }
  }

  onProgress({ percent: 100, status: '압축 파일 저장 중...' });

  const finalBlob = new Blob(chunks, { type: 'application/zip' });
  const blobUrl = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = archiveName.endsWith('.zip') ? archiveName : `${archiveName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * Move multiple files at once to target folder (or root if targetFolderId is null)
 */
export async function batchMoveFiles(workspaceId, fileIds, targetFolderId = null) {
  const res = await fetchWithRetry(`${API_BASE}/files/batch-move`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      workspace_id: workspaceId,
      file_ids: fileIds,
      folder_id: targetFolderId || null,
    }),
  });
  if (!res.ok) throw new Error('파일 일괄 이동 실패');
  return res.json();
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


const RETRYABLE_HTTP_STATUS = new Set([408, 502, 503, 504, 522, 523, 524]);

/**
 * fetch() wrapped with a per-attempt timeout and automatic retry for transient
 * network/gateway failures (e.g. an idle Cloudflare Tunnel connection stalling
 * mid-transfer). Without this, a single stalled chunk request hangs forever and
 * the upload appears frozen with no way to recover.
 *
 * Only used for idempotent requests (session init, individual chunk parts) where
 * retrying a request that actually succeeded server-side has no side effect.
 */
async function fetchWithTimeout(url, options = {}, { signal, timeoutMs = 30000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException('업로드가 취소되었습니다.', 'AbortError');

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    const onUserAbort = () => timeoutController.abort();
    if (signal) signal.addEventListener('abort', onUserAbort);

    try {
      const res = await fetch(url, { ...options, signal: timeoutController.signal });
      if (!res.ok && RETRYABLE_HTTP_STATUS.has(res.status) && attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (signal?.aborted) throw err; // user-initiated cancel: propagate immediately, no retry
      lastErr = err;
      if (attempt === retries) {
        if (err.name === 'AbortError') {
          throw new Error('서버 응답이 지연되어 요청 시간이 초과되었습니다. 네트워크 상태를 확인 후 다시 시도해주세요.');
        }
        throw err;
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onUserAbort);
    }
  }
  throw lastErr;
}

/**
 * Robust 5MB Chunked Proxy File Uploader (100% Cloudflare Tunnel & Proxy Safe)
 */
export async function uploadFileChunked(file, folderId = null, workspaceId = null, onProgress = () => {}, signal = null) {
  const chunkSize = 5 * 1024 * 1024; // 5MB chunks (Cloudflare Tunnel safe)
  const fileSize = file.size;

  // Single small file upload (< 5MB)
  if (fileSize <= chunkSize) {
    return directUploadFallback(file, folderId, workspaceId, onProgress, signal);
  }

  // Large Chunked Proxy Upload (> 5MB)
  onProgress({ percent: 2, status: '대용량 업로드 세션 초기화...' });

  const initRes = await fetchWithTimeout(`${API_BASE}/storage/chunk/init`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      filename: file.name,
      folder_id: folderId,
      workspace_id: workspaceId,
      content_type: file.type || 'application/octet-stream',
      size_bytes: fileSize,
    }),
  }, { signal, timeoutMs: 20000, retries: 2 });

  if (!initRes.ok) {
    const errData = await initRes.json().catch(() => ({}));
    throw new Error(errData.detail || `대용량 업로드 세션 초기화에 실패했습니다. (HTTP ${initRes.status})`);
  }

  const initData = await initRes.json();
  const upload_id = initData.upload_id;
  const effectiveChunkSize = initData.chunk_size_bytes || chunkSize;
  const total_parts = initData.total_parts || Math.ceil(fileSize / effectiveChunkSize);

  try {
    for (let partNumber = 1; partNumber <= total_parts; partNumber++) {
      if (signal?.aborted) {
        throw new Error('Upload aborted by user');
      }

      const start = (partNumber - 1) * effectiveChunkSize;
      const end = Math.min(start + effectiveChunkSize, fileSize);
      const chunkBlob = file.slice(start, end);

      const currentPercent = Math.min(92, Math.round(((partNumber - 1) / total_parts) * 90) + 3);
      const sentMb = (start / (1024 * 1024)).toFixed(1);
      const totalMb = (fileSize / (1024 * 1024)).toFixed(1);

      onProgress({
        percent: currentPercent,
        status: `청크 전송 중 (${partNumber}/${total_parts} · ${sentMb}MB/${totalMb}MB)`,
      });

      const formData = new FormData();
      formData.append('upload_id', upload_id);
      formData.append('part_number', partNumber);
      formData.append('chunk', chunkBlob, `part_${partNumber}.bin`);

      const partUploadRes = await fetchWithTimeout(`${API_BASE}/storage/chunk/part`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      }, { signal, timeoutMs: 60000, retries: 2 });

      if (!partUploadRes.ok) {
        throw new Error(`청크 ${partNumber}/${total_parts} 전송 실패 (HTTP ${partUploadRes.status})`);
      }
    }

    onProgress({ percent: 94, status: '파일 병합 및 썸네일 생성 중...' });

    // Not retried: a lost response here is ambiguous (the merge may have already
    // succeeded server-side), and retrying could create a duplicate file record.
    // A generous timeout avoids false failures while thumbnail generation runs.
    const completeRes = await fetchWithTimeout(`${API_BASE}/storage/chunk/complete`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        upload_id,
        filename: file.name,
        folder_id: folderId,
        workspace_id: workspaceId,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: fileSize,
        total_parts
      }),
    }, { signal, timeoutMs: 180000, retries: 0 });

    if (!completeRes.ok) {
      const errData = await completeRes.json().catch(() => ({}));
      throw new Error(errData.detail || `파일 병합 및 저장에 실패했습니다. (HTTP ${completeRes.status})`);
    }

    const resultFile = await completeRes.json();
    onProgress({ percent: 100, status: '완료됨' });
    return resultFile;
  } catch (e) {
    fetch(`${API_BASE}/storage/chunk/abort`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ upload_id }),
    }).catch(() => {});
    throw e;
  }
}

async function directUploadFallback(file, folderId, workspaceId, onProgress, signal = null) {
  onProgress({ percent: 15, status: '파일 전송 중...' });
  const formData = new FormData();
  formData.append('file', file);
  if (folderId) formData.append('folder_id', folderId);
  if (workspaceId) formData.append('workspace_id', workspaceId);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/storage/direct-upload`);

    const token = getStoredToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new Error('Upload aborted by user'));
      });
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.min(90, Math.round((event.loaded / event.total) * 90));
        onProgress({ percent, status: `파일 전송 중 (${percent}%)...` });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          onProgress({ percent: 100, status: '완료됨' });
          resolve(res);
        } catch (err) {
          reject(new Error('Invalid JSON response'));
        }
      } else {
        try {
          const errRes = JSON.parse(xhr.responseText);
          reject(new Error(errRes.detail || `Direct upload failed with status ${xhr.status}`));
        } catch (e) {
          reject(new Error(`Direct upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('네트워크 오류로 업로드에 실패했습니다.'));
    xhr.send(formData);
  });
}

export async function uploadNoteImage(file, workspaceId = null, folderId = null) {
  const item = await directUploadFallback(file, folderId, workspaceId, () => {});
  const previewUrl = getMediaPreviewUrl(item.id);
  return {
    ...item,
    previewUrl
  };
}


