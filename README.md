# 🎨 CollabDraw

실시간 멀티유저 협업 드로잉 앱

## 기능
- 실시간 멀티유저 드로잉 (Supabase Realtime)
- 방 만들기 / 참가 / 퇴장
- 100가지 색상 팔레트 + 커스텀 컬러
- 7가지 도구: 펜, 직선, 사각형, 원, 지우개, 채우기, 텍스트
- 펜 이모티컨 (그리면서 이모티컨 따라다님)
- 캔버스 확대/축소 (마우스 휠 or 슬라이더)
- 댓글 핀: 원하는 위치에 댓글 남기기
- 이모티컨 전용 채팅
- 방장 기능: 제한시간 설정, 일시정지(1회), 사용자 퇴장, 방 종료
- 완성 통계: 사용자별 그린 면적 % 분석
- PNG 저장 (그림 / 통계)

---

## 배포 방법

### 1. Supabase 설정

1. [supabase.com](https://supabase.com) 접속 → 기존 프로젝트 사용 또는 새로 생성
2. SQL Editor에서 `supabase_schema.sql` 전체 복사 → 실행
3. Settings → API 에서 `URL`과 `anon key` 복사

### 2. 환경변수 설정

`.env.local.example`을 복사해서 `.env.local` 만들기:

```bash
cp .env.local.example .env.local
```

`.env.local` 수정:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### 3. 로컬 실행

```bash
npm install
npm run dev
```

→ http://localhost:3000

### 4. Vercel 배포

```bash
# Vercel CLI 설치 (처음 한 번만)
npm i -g vercel

# 배포
vercel
```

또는 GitHub에 올리고 [vercel.com](https://vercel.com)에서 import.

Vercel 환경변수 설정:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 사용법

1. 로비에서 닉네임 + 색상 선택
2. **방 만들기** (방장) 또는 기존 방 **참가**
3. 방장은 제한시간 설정 (선택사항)
4. 함께 그리기!
5. **📊 완성** 버튼으로 통계 확인 및 저장
6. 방장은 **방 종료** 로 마무리
