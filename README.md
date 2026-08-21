# Project Run : Finder

> **Project Run : Finder**는 마크다운 노트 작성, 대용량 파일 청크 업로드, AI 기반 시맨틱 벡터 검색(pgvector & OpenWebUI), 그리고 워크스페이스 기반 협업 및 용량 관리를 제공하는 올인원 지식 관리 플랫폼입니다.

---

## 1. 서비스 실행 방법 (Quick Start)

### 1) 로컬 개발 (Docker 없이, 핫리로드)
운영은 Docker로 하지만, 개발 중에는 각자 네이티브로 띄우는 게 훨씬 빠릅니다(코드 변경 즉시 반영, `.venv` 기반 디버깅/IDE 자동완성).

**백엔드** — `/Users/ori/Projects/knowledge-base/backend`, 포트 `8001`
```bash
cd /Users/ori/Projects/knowledge-base/backend
uv sync                # 최초 1회 또는 의존성 추가 시
uv run python run.py
```
> Swagger UI: [http://localhost:8001/docs](http://localhost:8001/docs)

**프론트엔드** — `/Users/ori/Projects/knowledge-base/frontend`, 포트 `5173`
```bash
cd /Users/ori/Projects/knowledge-base/frontend
npm install             # 최초 1회
npm run dev              # vite dev 서버 (HMR)
```
> 접속: [http://localhost:5173](http://localhost:5173)

둘 다 리포 루트의 공용 `.env`를 읽습니다 (`frontend/vite.config.js`의 `envDir: '..'`). `frontend/.env`를 따로 만들지 마세요.

---

### 2) 운영 배포 (Docker Compose)
운영은 `docker-compose.yml`로 백엔드/프론트엔드 둘 다 컨테이너로 띄웁니다. **PM2/launchd 같은 네이티브 백그라운드 프로세스는 쓰지 않습니다** — macOS가 GUI 세션에 붙어있지 않은 백그라운드 프로세스의 LAN(사설 IP) 접속을 조용히 차단하기 때문입니다(`192.168.0.25` Postgres 접속 불가 → `[Errno 65] No route to host`). Docker Desktop 앱 자체는 로컬 네트워크 권한을 정상적으로 갖고 있어서, 컨테이너 트래픽은 이 문제에 걸리지 않습니다. 자세한 배경은 `DEVELOPMENT.md` 5장 참고.

```bash
# 이미지 빌드 (버전 태그, 아래 "버전 관리" 참고)
TAG=v1 docker compose build

# 백그라운드로 기동 (재부팅 시에도 Docker Desktop 자동 실행 + restart: unless-stopped 로 자동 복구)
TAG=v1 docker compose up -d

# 상태 확인 / 로그
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend

# 중지
docker compose down
```

> ⚠️ Docker Desktop 설정 → General → **"Start Docker Desktop when you sign in"** 이 켜져 있어야 재부팅 후 자동으로 서비스가 살아납니다.

---

### 3) 버전 관리 & 배포 (Deploy Workflow)
이미지에 버전 태그를 붙여서 관리합니다 (`docker commit`은 재현 불가능해서 쓰지 않습니다 — 항상 `Dockerfile`에서 다시 빌드).

```bash
# 1. 코드 수정 후 커밋
git add -A && git commit -m "..."

# 2. 현재 커밋의 짧은 SHA를 태그로 새 이미지 빌드
TAG=$(git rev-parse --short HEAD) docker compose build

# 3. 배포 (이전 태그 이미지는 그대로 로컬에 남아있음)
TAG=$(git rev-parse --short HEAD) docker compose up -d

# 롤백: 문제가 생기면 예전 커밋의 SHA 태그로 다시 up (이미지가 로컬에 남아있는 동안은 재빌드 불필요)
TAG=<이전 SHA> docker compose up -d
```
- `TAG`를 지정하지 않으면 `latest`로 빌드/실행됩니다 — 로컬에서 빠르게 확인만 할 때 사용하고, 실제 배포에는 항상 SHA 태그를 쓰세요.
- 롤백 가능하려면 오래된 이미지를 함부로 지우지 마세요 (`docker image prune`은 태그 없는 이미지만 지우므로 SHA 태그가 붙은 이미지는 안전합니다).
- 소스는 `git`이 버전 관리하고, 이미지 태그는 "그 커밋을 빌드한 결과물"이라는 1:1 대응만 유지하면 됩니다.

---

### 4) 테스트 실행 (Backend Test Suite)
```bash
cd /Users/ori/Projects/knowledge-base/backend
uv run pytest
```

---

## 2. 주요 기능 및 아키텍처

| 구분 | 주요 기능 및 기술 스택 |
| :--- | :--- |
| **인증 & 보안** | Google OAuth 2.0 소셜 로그인, JWT 토큰 인증, 초대 기반 회원가입, 관리자 승인 체계 |
| **워크스페이스** | 슬랙 스타일 다중 워크스페이스, 역할 기반 권한(Owner, Admin, Member, Viewer), 워크스페이스별 완벽한 데이터 격리 |
| **스토리지 관리** | 사용자당 기본 100GB 용량 제공, **워크스페이스 소유자 중심 용량 집계 정책**, S3/MinIO 대용량 멀티파트 청크 업로드 |
| **파일 & 탐색기** | 재귀적 무한 계층 폴더 트리, 마크다운 실시간 에디터, 미디어(이미지/비디오) 썸네일 자동 생성 및 미리보기, 이름/종류/날짜/크기별 다중 정렬 및 대용량 페이징 |
| **AI 시맨틱 검색** | PostgreSQL `pgvector` 연동, 문서 자동 청킹 및 임베딩 벡터 생성, 하이브리드(시맨틱 + 키워드) 유사도 검색 |
| **휴지통 & 복구** | 파일 및 폴더 소프트 삭제(`is_trashed`), 기간별 필터링, 영구 삭제 시 스토리지 자동 반환 |

---

## 3. 환경 변수 설정 (`.env`)

프로젝트 루트의 `.env` 파일에서 주요 인프라 설정을 관리합니다:

```env
# MinIO / S3 Storage
MINIO_PUBLIC_URL=https://public-storage.proj.run
MINIO_PUBLIC_ROOT_USER=project-run
MINIO_PUBLIC_ROOT_PASSWORD=your_strong_password
MINIO_MAX_CHUNK_SIZE_MB=50
MINIO_BUCKET_NAME=knowledge-base

# PostgreSQL with pgvector
POSTGRES_HOST=192.168.0.25
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_postgres_password
POSTGRES_DB=postgres
DATABASE_URL=postgresql://postgres:your_postgres_password@192.168.0.25:5432/postgres

# OpenWebUI / LLM & Vector Embeddings
OPENWEBUI_URL=http://localhost:3000/
OPENWEBUI_API_KEY=your_openwebui_api_key
OPENWEBUI_MODEL=gemma4:latest
OPENWEBUI_EMBEDDING_MODEL=embeddinggemma:latest
MAX_EMBED_TOKENS=8000
EMBEDDING_DIM=768

# Authentication & Google OAuth
JWT_SECRET=your_super_secret_jwt_key
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# AWS SES (초대 메일 발송용)
AWS_SES_ACCESS_KEY_ID=your_ses_key
AWS_SES_SECRET_ACCESS_KEY=your_ses_secret
AWS_SES_REGION=ap-northeast-2
SES_FROM_EMAIL_NOTIFY=notify@proj.run
```

---

## 4. 상세 개발 문서
더 자세한 시스템 아키텍처, 데이터 모델, 스토리지 계산 방식, API 엔드포인트 및 확장 가이드는 **[DEVELOPMENT.md](DEVELOPMENT.md)**를 참고하세요.
# finder
