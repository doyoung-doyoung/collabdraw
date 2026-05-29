import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Room = {
  id: string
  name: string
  host_id: string
  host_name: string
  timer_seconds: number
  timer_started_at: string | null
  timer_paused: boolean
  timer_pause_used: boolean
  is_ended: boolean
  created_at: string
}

export type RoomUser = {
  id: string
  room_id: string
  name: string
  color: string
  pixel_area: number
  joined_at: string
}

export type Stroke = {
  id?: number
  room_id: string
  user_id: string
  user_color: string
  tool: string
  points: { x: number; y: number }[]
  size: number
  emoji?: string
}

export type Comment = {
  id?: number
  room_id: string
  user_id: string
  user_name: string
  user_color: string
  x: number
  y: number
  content: string
}

export type ChatMessage = {
  id?: number
  room_id: string
  user_id: string
  user_name: string
  user_color: string
  emoji: string
}
