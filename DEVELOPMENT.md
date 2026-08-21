# Project Run : Finder 개발 및 아키텍처 문서 (Developer Guide)

본 문서는 **Project Run : Finder** 지식 관리 플랫폼의 아키텍처, 데이터 모델, 스토리지 정책, 보안 모델 및 추가 개발을 위한 가이드를 제공합니다.

---

## 1. 기술 스택 및 아키텍처 개요

### 1) 시스템 구성도
```
[React + Vite Frontend (Port: 5173)]
         │
         ├── REST API (JSON / Bearer JWT)
         ▼
[FastAPI Backend (Port: 8001)]
   ├── PostgreSQL + pgvector (Port: 5432) ── 벡터 임베딩 & 메타데이터
   ├── MinIO / S3 Storage (Port: 9000/9001) ── 대용량 원본 파일 & 청크
   ├── OpenWebUI / Ollama (Port: 3000) ── 768차원 임베딩 생성 (embeddinggemma)
   └── AWS SES ── 멤버 초대 메일 발송
```

### 2) 기술 스택 세부 정보
- **Backend**:
  - Python 3.10+, FastAPI, Uvicorn
  - SQLAlchemy 2.0 (Asyncpg 비동기 ORM)
  - Pydantic v2
  - Boto3 (MinIO / S3 S3-compatible SDK)
  - Pillow / MoviePy (이미지 및 비디오 자동 썸네일 생성 파이프라인)
  - Uv (초고속 Python 패키지 관리자)
- **Frontend**:
  - React 18, Vite 8
  - Lucide React (아이콘)
  - Vanilla CSS (커스텀 디자인 시스템, 다크/라이트 테마 토큰)
- **Database & Search**:
  - PostgreSQL + TimescaleDB + `pgvector` 확장 모듈
  - HNSW / 코사인 유사도 벡터 인덱싱

---

## 2. 핵심 비즈니스 로직 및 정책

### 1) 워크스페이스 소유자 중심 스토리지 용량(Quota) 정책
- **기본 할당**: 모든 사용자에게 기본 **100GB**(`107,374,182,400 바이트`)의 용량이 부여됩니다.
- **집계 방식**:
  - 파일 용량은 업로드한 멤버의 개인 용량이 아닌, **파일이 속한 워크스페이스의 소유자(Owner)** 계정에 합산됩니다.
  - 워크스페이스 멤버가 파일을 업로드한 후 워크스페이스를 탈퇴하더라도, 해당 파일은 워크스페이스에 남아 계속 소유자의 사용량으로 집계됩니다.
  - 파일/폴더 삭제 또는 휴지통 비우기 시 해당 워크스페이스 소유자의 용량이 자동으로 반환(차감)됩니다.
- **핵심 서비스 모듈**: `backend/app/services/quota_service.py`
  - `get_quota_owner(db, workspace_id, current_user)`: 워크스페이스의 실제 소유자 식별
  - `check_quota(db, workspace_id, current_user, added_bytes)`: 업로드 전 용량 초과 여부 사전 검증 (413 Payload Too Large)
  - `record_storage_added(db, workspace_id, current_user, added_bytes)`: 업로드 완료 시 사용량 증가
  - `record_storage_freed(db, workspace_id, freed_bytes, owner_id)`: 영구 삭제 시 사용량 반환
  - `sync_all_users_storage(db)`: 서버 구동 시 전체 사용자의 스토리지 집계 동기화

### 2) 멀티테넌시 & 워크스페이스 보안 격리
- **보안 검증 모듈**: `backend/app/services/access_service.py`
- 모든 파일, 폴더, 검색, 휴지통 API는 사용자가 해당 워크스페이스의 활성 멤버인지 엄격하게 검증합니다.
- 관리자(`is_admin`) 계정이라도 일반 탐색기 조회 시 다른 워크스페이스의 내용이 섞이지 않도록 격리 스코프가 적용됩니다.

### 3) 대용량 파일 멀티파트 청크 업로드 파이프라인
1. 프론트엔드에서 50MB 단위로 파일을 분할하여 `POST /api/storage/multipart/initiate` 호출 (MinIO S3 `UploadId` 발급).
2. `POST /api/storage/multipart/part-urls`로 각 파트의 Presigned PUT URL을 발급받아 브라우저가 MinIO로 직접 병렬 전송.
3. 모든 파트 전송 후 `POST /api/storage/multipart/complete`로 병합 완료.
4. 백엔드에서 비동기로 썸네일 추출 및 텍스트/문서 청킹 후 `pgvector` 임베딩 생성.

### 4) 파일/폴더 정렬 및 페이징
- **정렬 옵션**:
  - 파일: `updated_at`, `created_at`, `name`, `file_type`, `size_bytes`
  - 폴더: `name`, `updated_at`, `created_at`, `file_count`
  - 정렬 순서: `asc` (오름차순), `desc` (내림차순)
- **페이징 규격**: `page`, `page_size`, `paged=True` 전달 시 `PagedFileResponse` / `PagedFolderResponse` 반환.

---

## 3. 디렉토리 구조

```
knowledge-base/
├── README.md                      # 서비스 실행 가이드 및 요약
├── DEVELOPMENT.md                 # 본 개발 및 아키텍처 문서
├── .env                           # 전체 환경 설정 파일 (git에는 커밋하지 않음)
├── docker-compose.yml             # 운영 배포용 (backend + frontend 컨테이너)
│
├── backend/                       # 백엔드 (FastAPI)
│   ├── Dockerfile                 # 운영 이미지 빌드 (python:3.10-slim + uv)
│   ├── app/
│   │   ├── core/                  # 설정, DB 비동기 엔진, 보안(JWT/비밀번호)
│   │   ├── models/                # SQLAlchemy 모델 (User, Workspace, Folder, FileItem 등)
│   │   ├── schemas/               # Pydantic 입출력 DTO 스키마
│   │   ├── routers/               # API 엔드포인트 (auth, workspaces, folders, files, storage, search, trash, admin)
│   │   ├── services/              # 비즈니스 로직 (quota_service, access_service, embedding_service, storage_service)
│   │   └── utils/                 # 이메일 발송(SES), 썸네일 생성기 등 유틸리티
│   ├── tests/                     # Pytest 테스트 스위트 (22개 테스트 케이스)
│   ├── pyproject.toml             # Python 종속성 정의
│   ├── .venv/                     # 로컬 개발용 venv (uv sync, Docker 이미지와는 별개)
│   └── run.py                     # 백엔드 실행 엔트리포인트 (Uvicorn)
│
└── frontend/                      # 프론트엔드 (React + Vite)
    ├── Dockerfile                 # 운영 이미지 빌드 (node build → nginx serve)
    ├── nginx.conf                 # /api/ 를 backend 컨테이너로 프록시
    ├── src/
    │   ├── api/                   # 백엔드 통신 API 클라이언트 모듈
    │   ├── components/
    │   │   ├── admin/             # 관리자 회원 승인 및 용량 관리
    │   │   ├── auth/              # Google OAuth 및 인증 모달
    │   │   ├── editor/            # 마크다운 노트 실시간 에디터
    │   │   ├── explorer/          # 폴더 탐색기, 정렬 툴바, 페이징 바
    │   │   ├── layout/            # 사이드바, 탑바
    │   │   ├── search/            # 시맨틱 벡터 검색 모달 (Cmd+K)
    │   │   ├── trash/             # 휴지통 및 복구 인터페이스
    │   │   ├── upload/            # 대용량 청크 업로드 드래그앤드롭 모달
    │   │   └── workspace/         # 슬랙 스타일 워크스페이스 전환 및 설정
    │   ├── context/               # 전역 다이얼로그(Alert/Confirm) 컨텍스트
    │   ├── App.jsx                # 메인 애플리케이션 진입점 및 상태 관리
    │   └── index.css              # 프리미엄 바닐라 CSS 디자인 시스템
    ├── package.json
    └── vite.config.js
```

---

## 4. 추가 기능 개발 시 가이드라인

### 1) 신규 모델 및 마이그레이션
- `backend/app/models/`에 모델 클래스를 정의한 후 `backend/app/models/__init__.py`에 등록합니다.
- 서버 시작 시 `init_pgvector_and_schema_sync()`(`backend/app/core/database.py`)에서 자동으로 테이블 및 pgvector 확장을 생성/동기화합니다.

### 2) 신규 API 추가 시
- `backend/app/routers/`에 라우터를 작성하고 `backend/app/main.py`의 `app.include_router`에 등록합니다.
- 워크스페이스 데이터에 접근하는 경우 반드시 `access_service.is_workspace_member`로 권한을 검증하세요.
- 파일 추가/삭제 로직이 포함되는 경우 `quota_service`를 호출하여 소유자 용량 집계를 갱신하세요.

### 3) 단위 및 통합 테스트 작성
- `backend/tests/` 디렉토리에 `test_*.py` 형식으로 테스트를 추가합니다.
- `conftest.py`에 정의된 비동기 `db_session` fixture를 주입받아 격리된 트랜잭션 단위로 테스트합니다.
- 실행 명령어: `cd backend && uv run pytest`

---

## 5. 운영 모드 전환 및 배포 점검사항

1. **디버그 모드 비활성화**:
   - `backend/app/core/config.py`의 `DEBUG` 기본값이 `False`로 설정되어 프로덕션 모드로 동작합니다.
   - 테스트 전용 엔드포인트(`/api/auth/dev-login`)는 프로덕션에서 자동 차단(404)됩니다.
2. **컨테이너 빌드/배포**: 백엔드(`backend/Dockerfile`)와 프론트엔드(`frontend/Dockerfile`, 멀티스테이지: `npm run build` → nginx가 정적 자산 서빙 + `/api/`를 백엔드 컨테이너로 프록시)를 `docker-compose.yml`로 함께 관리합니다. 실행/버전관리 명령은 `README.md`의 "운영 배포"·"버전 관리 & 배포" 절 참고.
3. **왜 PM2/launchd가 아니라 Docker인가 (macOS 전용 함정)**:
   - 이 서버는 macOS(Mac mini)에서 돌고, Postgres(`192.168.0.25`)는 같은 LAN의 다른 호스트에 있습니다.
   - macOS는 **GUI 로그인 세션에 붙어있지 않은 백그라운드 프로세스의 사설 IP(LAN) 접속을 "로컬 네트워크" 권한 체계로 조용히 차단**합니다. 이 권한은 사람이 직접 보고 있는 포그라운드 터미널에서 실행한 프로세스에만 부여될 수 있고, `pm2`/`launchd`처럼 데몬화되어 세션에서 분리된 프로세스는 **어떤 방법으로도 이 권한을 받을 수 없습니다** (재시작, launchd 세션 도메인 변경, 코드사이닝 등 모두 시도했지만 전부 실패 — `[Errno 65] No route to host`).
   - 반면 `curl`/`nc`/`ssh` 같은 애플 서명 시스템 바이너리와 **Docker Desktop이 만드는 컨테이너 네트워크**는 이 검사에서 예외입니다 (Docker Desktop 앱 자체가 이미 로컬 네트워크 권한을 갖고 있고, 컨테이너 트래픽은 그 권한 하에 나갑니다). 그래서 백엔드를 Docker 컨테이너로 옮기는 것이 근본적인 해결책이었습니다.
   - **결론**: 이 프로젝트에서 LAN(사설 IP) 리소스(Postgres 등)에 접속해야 하는 백그라운드 서비스는 항상 Docker 컨테이너로 실행하세요. 네이티브 `pm2`/`launchd` 데몬으로 되돌리지 마세요 — 재현 가능하게 막힙니다.
4. **버전 관리**: `docker commit` 대신 `Dockerfile`에서 매번 다시 빌드하고, git 커밋의 짧은 SHA를 이미지 태그로 사용합니다 (`TAG=$(git rev-parse --short HEAD)`). 롤백은 예전 SHA 태그로 `docker compose up -d`. 자세한 명령은 `README.md` 참고.

