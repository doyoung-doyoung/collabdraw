'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Room } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'
import styles from './lobby.module.css'

export default function LobbyPage() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [roomName, setRoomName] = useState('')
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(false)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [userColor, setUserColor] = useState('#7c3aed')

  const PRESET_COLORS = [
    '#7c3aed','#2563eb','#0f766e','#ea580c','#dc2626',
    '#db2777','#ca8a04','#16a34a','#0284c7','#9333ea',
  ]

  const fetchRooms = useCallback(async () => {
    const { data } = await supabase
      .from('rooms')
      .select('*')
      .eq('is_ended', false)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setRooms(data)
  }, [])

  useEffect(() => {
    fetchRooms()
    const channel = supabase
      .channel('rooms_lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchRooms)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchRooms])

  const getUserId = () => {
    let id = sessionStorage.getItem('collabdraw_uid')
    if (!id) { id = uuidv4(); sessionStorage.setItem('collabdraw_uid', id) }
    return id
  }

  const saveUser = (color: string, name: string) => {
    sessionStorage.setItem('collabdraw_color', color)
    sessionStorage.setItem('collabdraw_name', name)
  }

  const createRoom = async () => {
    if (!userName.trim()) { alert('Please enter a nickname'); return }
    if (!roomName.trim()) { alert('Please enter a room name'); return }
    setLoading(true)
    const userId = getUserId()
    const roomId = uuidv4()
    saveUser(userColor, userName)

    const { error } = await supabase.from('rooms').insert({
      id: roomId,
      name: roomName.trim(),
      host_id: userId,
      host_name: userName.trim(),
      timer_seconds: 0,
      is_ended: false,
    })
    if (error) { alert('Failed to create room: ' + error.message); setLoading(false); return }

    await supabase.from('room_users').insert({
      id: userId, room_id: roomId,
      name: userName.trim(), color: userColor, pixel_area: 0,
    })

    sessionStorage.setItem('collabdraw_host', roomId)
    router.push(`/room/${roomId}`)
  }

  const joinRoom = async (room: Room) => {
    if (!userName.trim()) { alert('Please enter a nickname'); return }
    setJoiningId(room.id)
    const userId = getUserId()
    saveUser(userColor, userName)

    const { data: existing } = await supabase
      .from('room_users').select('id').eq('id', userId).eq('room_id', room.id).single()

    if (!existing) {
      await supabase.from('room_users').insert({
        id: userId, room_id: room.id,
        name: userName.trim(), color: userColor, pixel_area: 0,
      })
    } else {
      await supabase.from('room_users').update({ name: userName.trim(), color: userColor }).eq('id', userId).eq('room_id', room.id)
    }

    sessionStorage.removeItem('collabdraw_host')
    router.push(`/room/${room.id}`)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.left}>
        <div className={styles.logo}>
          <span className={styles.logoText}>Collab</span>
          <span className={styles.logoDraw}>Draw</span>
        </div>
        <p className={styles.logoSub}>Real-time collaborative canvas</p>

        <div className={styles.section}>
          <label className={styles.label}>Nickname</label>
          <input
            className={styles.input}
            placeholder="Enter your name..."
            value={userName}
            onChange={e => setUserName(e.target.value)}
            maxLength={14}
          />
        </div>

        <div className={styles.section}>
          <label className={styles.label}>My Color</label>
          <div className={styles.colorRow}>
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                className={`${styles.colorBtn} ${userColor === c ? styles.colorBtnActive : ''}`}
                style={{ background: c }}
                onClick={() => setUserColor(c)}
              />
            ))}
            <input
              type="color"
              value={userColor}
              onChange={e => setUserColor(e.target.value)}
              className={styles.colorPicker}
              title="Custom color"
            />
          </div>
        </div>

        <div className={styles.divider} />

        <div className={styles.section}>
          <label className={styles.label}>Create New Room</label>
          <input
            className={styles.input}
            placeholder="Room name..."
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            maxLength={24}
            onKeyDown={e => e.key === 'Enter' && createRoom()}
          />
          <button className={styles.btnCreate} onClick={createRoom} disabled={loading}>
            {loading ? 'Creating...' : '+ Create Room'}
          </button>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.rightHeader}>
          <span className={styles.rightTitle}>🏠 Open Rooms</span>
          <button className={styles.refreshBtn} onClick={fetchRooms}>↻</button>
        </div>

        {rooms.length === 0 ? (
          <div className={styles.noRooms}>
            <span>No open rooms yet</span>
            <span className={styles.noRoomsSub}>Be the first to create one!</span>
          </div>
        ) : (
          <div className={styles.roomList}>
            {rooms.map(room => (
              <div key={room.id} className={styles.roomCard}>
                <div className={styles.roomInfo}>
                  <div className={styles.roomName}>{room.name}</div>
                  <div className={styles.roomMeta}>Host: {room.host_name} 👑</div>
                </div>
                <button
                  className={styles.joinBtn}
                  onClick={() => joinRoom(room)}
                  disabled={joiningId === room.id}
                >
                  {joiningId === room.id ? '...' : 'Join'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
