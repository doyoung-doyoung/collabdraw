-- CollabDraw v2 Migration
-- Supabase SQL Editor에서 이 파일 전체를 복사해서 실행하세요.
-- (기존 데이터는 그대로 유지됩니다)

-- 1. 텍스트 채팅 지원
alter table chat_messages alter column emoji drop not null;
alter table chat_messages add column if not exists message text;

-- 2. 방장 기능: 그리기 금지(뮤트)
alter table room_users add column if not exists is_muted boolean default false;

-- 3. 주제 룰렛
alter table rooms add column if not exists topic text default '';
