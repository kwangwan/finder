# Project Run : Finder

> **Project Run : Finder**는 마크다운 노트 작성, 대용량 파일 청크 업로드, AI 기반 시맨틱 벡터 검색(pgvector & OpenWebUI), 그리고 워크스페이스 기반 협업 및 용량 관리를 제공하는 올인원 지식 관리 플랫폼입니다.

---

## 1. 서비스 실행 방법 (Quick Start)

### 1) 백엔드 (Backend - FastAPI)
- **경로**: `/Users/ori/Projects/knowledge-base/backend`
- **포트**: `8001`

```bash
# 디렉토리 이동
cd /Users/ori/Projects/knowledge-base/backend

# 가상환경 패키지 동기화 (최초 1회 또는 패키지 추가 시)
uv sync

# 백엔드 서버 실행
uv run python run.py
```
> 백엔드 API 문서(Swagger UI): [http://localhost:8001/docs](http://localhost:8001/docs)

---

### 2) 프론트엔드 (Frontend - React & Vite)
- **경로**: `/Users/ori/Projects/knowledge-base/frontend`
- **포트**: `5173`

```bash
# 디렉토리 이동
cd /Users/ori/Projects/knowledge-base/frontend

# 패키지 설치 (최초 1회)
npm install

# [개발 모드] 로컬 개발 서버 실행
npm run dev

# [운영 모드] 프로덕션 번들 빌드
npm run build
```
> 프론트엔드 접속 URL: [http://localhost:5173](http://localhost:5173) 또는 [https://finder.proj.run](https://finder.proj.run)

---

### 3) PM2 백그라운드 상시 구동 및 자동 재시작 (운영 권장)
프로세스 비정상 종료 시 자동 복구 및 백그라운드 상시 유지를 위해 **PM2** 프로세스 매니저 설정을 제공합니다:

```bash
# PM2로 백엔드 & 프론트엔드 일괄 실행
pm2 start ecosystem.config.cjs

# 서비스 상태 확인
pm2 status

# 실시간 로그 확인
pm2 logs

# 서비스 전체 재시작 / 중지
pm2 restart all
pm2 stop all

# 현재 실행 상태 저장 (재부팅 대비)
pm2 save

# [선택] Mac/서버 부팅 시 자동 시작 등록
pm2 startup
# (출력되는 sudo env PATH=... 명령어를 터미널에 1회 복사/실행)
```

---

### 4) 코드 수정 후 운영 반영 (Deploy Workflow)
소스 코드 수정과 운영 환경이 분리되어 있으므로, 코드 변경 후 운영에 반영할 때는 아래 명령을 실행합니다:

```bash
# 프론트엔드 변경 시: 프로덕션 빌드 후 PM2 재시작
cd /Users/ori/Projects/knowledge-base/frontend && npm run build
pm2 restart finder-frontend

# 백엔드 변경 시: PM2 재시작
pm2 restart finder-backend

# 전체 변경 시 일괄 재시작
pm2 restart all
```

---

### 5) 테스트 실행 (Backend Test Suite)
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
POSTGRES_PASSWORD=secretpassword
POSTGRES_DB=postgres
DATABASE_URL=postgresql://postgres:secretpassword@192.168.0.25:5432/postgres

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
