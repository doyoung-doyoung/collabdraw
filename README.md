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
- 완성 통계: 사용자별 그린 면蠁 % 분석
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

---

## 🆕 v2 업데이트

- 💬 **텍스트 채팅** (나쁜말 자동 🌸 필터)
- 🧹 **내 그림만 지우기** + Undo가 모두의 화면에 반영
- 🚫 **강퇴 즉시 반영**: 내보내진 유저는 바로 로비로 이동
- 👑 **방장 넘기기** + 방장이 나가면 자동으로 다음 친구에게 위임
- 🔇 **그리기 금지(뮤트)**: 방장이 특정 유저를 잠시 못 그리게
- 🎲 **주제 룰렛**: 방장이 오늘의 그림 주제 뽑기
- ⭐ **스탬프 도구**: 탭 한 번으로 귀여운 이모지 찍기
- 🤏 **핀치 줌** 및 터치 버튼 확대 (태블릿 최적화)
- ⚡ 스트로크 캐시로 다시 그리기 속도 개선
- 🇰🇷 아이들 눈높이에 맞춘 전체 한글 UI

### v2 적용 방법 (기존 DB 사용 시 필수!)
Supabase SQL Editor에서 `migration_v2.sql` 전체를 복사해 실행하세요.
