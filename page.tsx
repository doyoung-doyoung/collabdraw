'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Room, RoomUser, Stroke, Comment, ChatMessage } from '@/lib/supabase'
import { CANVAS_WIDTH, CANVAS_HEIGHT, COLORS_100, PEN_EMOJIS, CHAT_EMOJIS } from '@/lib/constants'
import styles from './room.module.css'
import TimerModal from '@/components/TimerModal'
import StatsModal from '@/components/StatsModal'
import CommentModal from '@/components/CommentModal'

type Tool = 'pen' | 'line' | 'rect' | 'circle' | 'eraser' | 'fill' | 'text'

export default function RoomPage() {
  const { id: roomId } = useParams<{ id: string }>()
  const router = useRouter()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [room, setRoom] = useState<Room | null>(null)
  const [users, setUsers] = useState<RoomUser[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [comments, setComments] = useState<Comment[]>([])

  const [myId] = useState(() => sessionStorage.getItem('collabdraw_uid') || '')
  const [myName] = useState(() => sessionStorage.getItem('collabdraw_name') || 'Guest')
  const [myColor] = useState(() => sessionStorage.getItem('collabdraw_color') || '#7c3aed')
  const [isHost, setIsHost] = useState(false)

  const [tool, setTool] = useState<Tool>('pen')
  const [size, setSize] = useState(4)
  const [color, setColor] = useState(myColor)
  const [penEmoji, setPenEmoji] = useState<string | null>(null)

  const [zoom, setZoom] = useState(0.4)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 })

  const [mobileSheet, setMobileSheet] = useState<null | 'tools' | 'people'>(null)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gesture = useRef({ active: false, dist: 0, cx: 0, cy: 0, px: 0, py: 0, zoom: 1 })

  const isDrawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const currentStroke = useRef<{ x: number; y: number }[]>([])
  const pixelArea = useRef(0)

  const [commentMode, setCommentMode] = useState(false)
  const [pendingCommentPos, setPendingCommentPos] = useState<{ x: number; y: number } | null>(null)

  const [showTimerModal, setShowTimerModal] = useState(false)
  const [showStatsModal, setShowStatsModal] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState(false)

  const [timerLeft, setTimerLeft] = useState(0)
  const [timerActive, setTimerActive] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const emojiFollowerRef = useRef<HTMLDivElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const getCtx = () => canvasRef.current?.getContext('2d') || null
  const getOctx = () => overlayRef.current?.getContext('2d') || null

  /* ── Init ── */
  useEffect(() => {
    if (!roomId || !myId) return
    loadRoom()
    loadStrokes()
    loadComments()
    loadUsers()
    loadChat()
    subscribeAll()
    return () => { supabase.removeAllChannels() }
  }, [roomId, myId])

  const loadRoom = async () => {
    const { data } = await supabase.from('rooms').select('*').eq('id', roomId).single()
    if (!data) { router.push('/'); return }
    if (data.is_ended) { alert('This room has already ended'); router.push('/'); return }
    setRoom(data)
    setIsHost(data.host_id === myId)
    if (data.host_id === myId) setShowTimerModal(true)
    if (data.timer_seconds > 0 && data.timer_started_at && !data.timer_paused) {
      const elapsed = Math.floor((Date.now() - new Date(data.timer_started_at).getTime()) / 1000)
      const left = data.timer_seconds - elapsed
      if (left > 0) { setTimerLeft(left); setTimerActive(true) }
    }
  }

  const loadStrokes = async () => {
    const { data } = await supabase.from('strokes').select('*').eq('room_id', roomId).order('id')
    if (data) data.forEach(s => drawStroke(s))
  }

  const loadComments = async () => {
    const { data } = await supabase.from('comments').select('*').eq('room_id', roomId)
    if (data) setComments(data)
  }

  const loadUsers = async () => {
    const { data } = await supabase.from('room_users').select('*').eq('room_id', roomId)
    if (data) setUsers(data)
  }

  const loadChat = async () => {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', roomId).order('id').limit(100)
    if (data) setChatMessages(data)
  }

  const subscribeAll = () => {
    supabase.channel('room_' + roomId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'strokes', filter: `room_id=eq.${roomId}` },
        payload => { if (payload.new.user_id !== myId) drawStroke(payload.new as Stroke) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_users', filter: `room_id=eq.${roomId}` },
        () => loadUsers())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        payload => { if (payload.new.user_id !== myId) setChatMessages(prev => [...prev.slice(-99), payload.new as ChatMessage]) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `room_id=eq.${roomId}` },
        payload => { if (payload.new.user_id !== myId) setComments(prev => [...prev, payload.new as Comment]) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        payload => {
          const r = payload.new as Room
          setRoom(r)
          if (r.is_ended && r.host_id !== myId) { setShowStatsModal(true) }
          if (r.timer_seconds > 0 && r.timer_started_at && !r.timer_paused && !timerActive) {
            const elapsed = Math.floor((Date.now() - new Date(r.timer_started_at).getTime()) / 1000)
            const left = r.timer_seconds - elapsed
            if (left > 0) { setTimerLeft(left); setTimerActive(true) }
          }
          if (r.timer_paused) { setTimerActive(false) }
        })
      .subscribe()
  }

  /* ── Timer ── */
  useEffect(() => {
    if (timerActive && timerLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimerLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!)
            setTimerActive(false)
            setShowStatsModal(true)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else if (!timerActive && timerRef.current) {
      clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [timerActive])

  const handleTimerSet = async (minutes: number) => {
    setShowTimerModal(false)
    if (minutes <= 0) return
    const seconds = minutes * 60
    await supabase.from('rooms').update({
      timer_seconds: seconds,
      timer_started_at: new Date().toISOString(),
      timer_paused: false,
    }).eq('id', roomId)
    setTimerLeft(seconds)
    setTimerActive(true)
  }

  const handleTimerStop = async () => {
    if (!room || room.timer_pause_used) return
    await supabase.from('rooms').update({ timer_paused: true, timer_pause_used: true }).eq('id', roomId)
    setTimerActive(false)
    setTimeout(async () => {
      const { data } = await supabase.from('rooms').select('timer_started_at,timer_seconds').eq('id', roomId).single()
      if (data) {
        const elapsed = Math.floor((Date.now() - new Date(data.timer_started_at!).getTime()) / 1000)
        const left = data.timer_seconds - elapsed
        await supabase.from('rooms').update({
          timer_paused: false,
          timer_started_at: new Date(Date.now() - (data.timer_seconds - left) * 1000).toISOString(),
        }).eq('id', roomId)
        setTimerLeft(left)
        setTimerActive(true)
      }
    }, 30000)
  }

  /* ── Canvas draw ── */
  const drawStroke = useCallback((s: Stroke) => {
    const ctx = getCtx()
    if (!ctx || !s.points || s.points.length < 2) return
    ctx.save()
    if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = s.user_color
    }
    ctx.lineWidth = s.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (s.tool === 'pen' || s.tool === 'eraser') {
      ctx.beginPath()
      ctx.moveTo(s.points[0].x, s.points[0].y)
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
      ctx.stroke()
      if (s.emoji && s.tool === 'pen') {
        ctx.font = `${s.size + 10}px serif`
        s.points.forEach((p, i) => { if (i % 8 === 0) ctx.fillText(s.emoji!, p.x, p.y) })
      }
    } else if (s.tool === 'line' && s.points.length >= 2) {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]]
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    } else if (s.tool === 'rect' && s.points.length >= 2) {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]]
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    } else if (s.tool === 'circle' && s.points.length >= 2) {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]]
      const rx = (b.x - a.x) / 2, ry = (b.y - a.y) / 2
      ctx.beginPath(); ctx.ellipse(a.x + rx, a.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); ctx.stroke()
    } else if (s.tool === 'text' && s.points.length >= 1 && s.emoji) {
      ctx.font = `${s.size * 4 + 12}px sans-serif`
      ctx.fillStyle = s.user_color
      ctx.fillText(s.emoji, s.points[0].x, s.points[0].y)
    }
    ctx.restore()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    if (overlayRef.current) { overlayRef.current.width = CANVAS_WIDTH; overlayRef.current.height = CANVAS_HEIGHT }
  }, [])

  /* ── Transform ── */
  const canvasStyle = {
    position: 'absolute' as const,
    left: `calc(50% + ${pan.x}px)`,
    top: `calc(50% + ${pan.y}px)`,
    transform: `translate(-50%, -50%) scale(${zoom})`,
    transformOrigin: 'center',
    cursor: commentMode ? 'cell' : 'crosshair',
    touchAction: 'none' as const,
    userSelect: 'none' as const,
  }

  const getCanvasPos = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    }
  }

  /* ── Pointer events (mouse + touch + pen) ── */
  const onPointerDown = (e: React.PointerEvent) => {
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch {}
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      if (isDrawing.current) { isDrawing.current = false; getOctx()?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT) }
      const pts = Array.from(pointers.current.values())
      const gdx = pts[0].x - pts[1].x, gdy = pts[0].y - pts[1].y
      gesture.current = { active: true, dist: Math.hypot(gdx, gdy) || 1, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2, px: pan.x, py: pan.y, zoom }
      return
    }
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
      return
    }
    if (e.button !== 0) return
    if (commentMode) {
      const pos = getCanvasPos(e)
      setPendingCommentPos(pos)
      setShowCommentModal(true)
      return
    }
    if (tool === 'fill') { floodFill(getCanvasPos(e)); return }
    if (tool === 'text') { addText(getCanvasPos(e)); return }
    const pos = getCanvasPos(e)
    isDrawing.current = true
    lastPos.current = pos
    currentStroke.current = [pos]
    const ctx = getCtx()!
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (gesture.current.active && pointers.current.size >= 2) {
      const pts = Array.from(pointers.current.values())
      const gdx = pts[0].x - pts[1].x, gdy = pts[0].y - pts[1].y
      const dist = Math.hypot(gdx, gdy) || 1
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2
      setZoom(Math.max(0.1, Math.min(4, gesture.current.zoom * (dist / gesture.current.dist))))
      setPan({ x: gesture.current.px + (cx - gesture.current.cx), y: gesture.current.py + (cy - gesture.current.cy) })
      return
    }
    if (isPanning.current) {
      setPan({
        x: panStart.current.px + e.clientX - panStart.current.x,
        y: panStart.current.py + e.clientY - panStart.current.y,
      })
      return
    }
    if (emojiFollowerRef.current && penEmoji) {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      emojiFollowerRef.current.style.left = (e.clientX - rect.left + 12) + 'px'
      emojiFollowerRef.current.style.top = (e.clientY - rect.top - 12) + 'px'
      emojiFollowerRef.current.style.display = 'block'
    } else if (emojiFollowerRef.current) {
      emojiFollowerRef.current.style.display = 'none'
    }
    if (!isDrawing.current) return
    const pos = getCanvasPos(e)
    const ctx = getCtx()!
    const octx = getOctx()!

    if (tool === 'pen' || tool === 'eraser') {
      if (tool === 'eraser') {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.lineWidth = size * 3; ctx.lineCap = 'round'
        ctx.lineTo(pos.x, pos.y); ctx.stroke(); ctx.restore()
      } else {
        ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.lineTo(pos.x, pos.y); ctx.stroke()
        if (penEmoji && currentStroke.current.length % 8 === 0) {
          ctx.font = `${size + 10}px serif`; ctx.fillText(penEmoji, pos.x, pos.y)
        }
      }
      const dx = pos.x - lastPos.current.x, dy = pos.y - lastPos.current.y
      pixelArea.current += Math.sqrt(dx * dx + dy * dy) * size
    } else {
      const start = currentStroke.current[0]
      octx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      octx.strokeStyle = color; octx.lineWidth = size; octx.lineCap = 'round'
      if (tool === 'line') { octx.beginPath(); octx.moveTo(start.x, start.y); octx.lineTo(pos.x, pos.y); octx.stroke() }
      else if (tool === 'rect') { octx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y) }
      else if (tool === 'circle') {
        const rx = (pos.x - start.x) / 2, ry = (pos.y - start.y) / 2
        octx.beginPath(); octx.ellipse(start.x + rx, start.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); octx.stroke()
      }
    }
    currentStroke.current.push(pos)
    lastPos.current = pos
  }

  const onPointerUp = async (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    try { (e.target as Element).releasePointerCapture(e.pointerId) } catch {}
    if (gesture.current.active) { if (pointers.current.size < 2) gesture.current.active = false; return }
    if (isPanning.current) { isPanning.current = false; return }
    if (!isDrawing.current) return
    isDrawing.current = false
    const octx = getOctx()!
    octx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    const points = currentStroke.current
    if (points.length < 1) return

    if (tool !== 'pen' && tool !== 'eraser' && points.length >= 1) {
      const endPos = getCanvasPos(e)
      points.push(endPos)
      drawStroke({ room_id: roomId, user_id: myId, user_color: color, tool, points, size, emoji: penEmoji || undefined })
    }

    if (points.length < 2) return

    const stroke: Stroke = {
      room_id: roomId, user_id: myId, user_color: color,
      tool, points, size, emoji: penEmoji || undefined,
    }
    await supabase.from('strokes').insert(stroke)
    await updatePixelArea()
    currentStroke.current = []
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    gesture.current.active = false
    isDrawing.current = false
    getOctx()?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    setZoom(z => Math.max(0.1, Math.min(4, z + delta)))
  }

  /* ── Tools ── */
  const floodFill = (pos: { x: number; y: number }) => {
    const ctx = getCtx()!
    const imgData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    const data = imgData.data
    const x = Math.round(pos.x), y = Math.round(pos.y)
    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) return
    const idx = (y * CANVAS_WIDTH + x) * 4
    const [tr, tg, tb] = [data[idx], data[idx + 1], data[idx + 2]]
    const fc = hexToRgb(color)
    if (!fc) return
    if (tr === fc.r && tg === fc.g && tb === fc.b) return
    const stack = [[x, y]]
    while (stack.length) {
      const [cx, cy] = stack.pop()!
      const ci = (cy * CANVAS_WIDTH + cx) * 4
      if (cx < 0 || cx >= CANVAS_WIDTH || cy < 0 || cy >= CANVAS_HEIGHT) continue
      if (data[ci] !== tr || data[ci + 1] !== tg || data[ci + 2] !== tb) continue
      data[ci] = fc.r; data[ci + 1] = fc.g; data[ci + 2] = fc.b; data[ci + 3] = 255
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
    }
    ctx.putImageData(imgData, 0, 0)
    pixelArea.current += 5000
    updatePixelArea()
  }

  const addText = async (pos: { x: number; y: number }) => {
    const text = prompt('Enter text:')
    if (!text) return
    const ctx = getCtx()!
    ctx.font = `${size * 4 + 12}px sans-serif`
    ctx.fillStyle = color
    ctx.fillText(text, pos.x, pos.y)
    const stroke: Stroke = { room_id: roomId, user_id: myId, user_color: color, tool: 'text', points: [pos], size, emoji: text }
    await supabase.from('strokes').insert(stroke)
    pixelArea.current += text.length * size * 10
    await updatePixelArea()
  }

  const updatePixelArea = async () => {
    await supabase.from('room_users').update({ pixel_area: Math.round(pixelArea.current) }).eq('id', myId).eq('room_id', roomId)
  }

  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
    return { r, g, b }
  }

  /* ── Comment ── */
  const submitComment = async (content: string) => {
    if (!pendingCommentPos) return
    const comment: Comment = {
      room_id: roomId, user_id: myId, user_name: myName,
      user_color: color, x: pendingCommentPos.x, y: pendingCommentPos.y, content,
    }
    await supabase.from('comments').insert(comment)
    setComments(prev => [...prev, comment])
    setPendingCommentPos(null)
    setShowCommentModal(false)
    setCommentMode(false)
  }

  /* ── Chat ── */
  const sendChatEmoji = async (emoji: string) => {
    const msg: ChatMessage = { room_id: roomId, user_id: myId, user_name: myName, user_color: color, emoji }
    setChatMessages(prev => [...prev.slice(-99), { ...msg, id: Date.now() }])
    await supabase.from('chat_messages').insert(msg)
  }

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  /* ── Kick / End ── */
  const kickUser = async (userId: string, userName: string) => {
    if (!confirm(`Remove "${userName}" from the room?`)) return
    await supabase.from('room_users').delete().eq('id', userId).eq('room_id', roomId)
  }

  const endRoom = async () => {
    if (!confirm('End this room? All users will see the final stats.')) return
    await supabase.from('rooms').update({ is_ended: true }).eq('id', roomId)
    setShowStatsModal(true)
  }

  const leaveRoom = async () => {
    await supabase.from('room_users').delete().eq('id', myId).eq('room_id', roomId)
    router.push('/')
  }

  const downloadCanvas = () => {
    const canvas = canvasRef.current!
    const link = document.createElement('a')
    link.download = `collabdraw_${room?.name || 'drawing'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  /* ── Timer display ── */
  const timerDisplay = timerLeft > 0
    ? `${Math.floor(timerLeft / 60)}:${(timerLeft % 60).toString().padStart(2, '0')}`
    : null

  const TOOL_ICONS: Record<Tool, string> = {
    pen: '✏️', line: '📏', rect: '⬜', circle: '⭕', eraser: '🧽', fill: '🪣', text: 'T'
  }
  const TOOL_LABELS: Record<Tool, string> = {
    pen: 'Pen', line: 'Line', rect: 'Rectangle', circle: 'Circle', eraser: 'Eraser', fill: 'Fill', text: 'Text'
  }

  return (
    <div className={styles.app}>
      {/* TOPBAR */}
      <div className={styles.topbar}>
        <span className={styles.roomName}>{room?.name || '...'}</span>
        <div className={styles.userChips}>
          {users.map(u => (
            <span key={u.id} className={styles.chip} style={{ background: u.color + '22', color: u.color, border: `1px solid ${u.color}44` }}>
              {u.name}{u.id === room?.host_id ? ' 👑' : ''}{u.id === myId ? ' (me)' : ''}
            </span>
          ))}
        </div>
        {timerDisplay && (
          <span className={`${styles.timer} ${timerLeft < 60 ? styles.timerRed : ''}`}>⏱ {timerDisplay}</span>
        )}
        <div className={styles.topbarActions}>
          <button className={`${styles.tbBtn} ${commentMode ? styles.tbBtnActive : ''}`} onClick={() => setCommentMode(!commentMode)}>💬 Comment</button>
          <button className={styles.tbBtn} onClick={() => setZoom(z => Math.min(4, z + 0.1))}>🔍+</button>
          <button className={styles.tbBtn} onClick={() => setZoom(z => Math.max(0.1, z - 0.1))}>🔍−</button>
          <button className={styles.tbBtn} onClick={() => { setZoom(0.4); setPan({ x: 0, y: 0 }) }}>Reset</button>
          <button className={styles.tbBtn} onClick={downloadCanvas}>💾 Save</button>
          {isHost && room && !room.timer_pause_used && timerActive && (
            <button className={styles.tbBtn} onClick={handleTimerStop}>⏸ Pause</button>
          )}
          <button className={`${styles.tbBtn} ${styles.tbBtnGreen}`} onClick={() => setShowStatsModal(true)}>📊 Finish</button>
          {isHost && <button className={`${styles.tbBtn} ${styles.tbBtnRed}`} onClick={endRoom}>🔚 End Room</button>}
          <button className={styles.tbBtn} onClick={leaveRoom}>← Leave</button>
        </div>
      </div>

      <div className={styles.main}>
        {/* LEFT SIDEBAR */}
        <div className={`${styles.sidebar} ${mobileSheet === 'tools' ? styles.sheetOpen : ''}`}>
          <div className={styles.sheetHandle} onClick={() => setMobileSheet(null)} />
          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Tools</div>
            <div className={styles.toolGrid}>
              {(Object.keys(TOOL_ICONS) as Tool[]).map(t => (
                <button
                  key={t}
                  className={`${styles.toolBtn} ${tool === t ? styles.toolBtnActive : ''}`}
                  onClick={() => setTool(t)}
                  title={TOOL_LABELS[t]}
                >
                  {TOOL_ICONS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Size — {size}px</div>
            <input type="range" min="1" max="60" step="1" value={size} onChange={e => setSize(+e.target.value)} className={styles.slider} />
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Colors (100)</div>
            <div className={styles.palette}>
              {COLORS_100.map(c => (
                <button
                  key={c}
                  className={`${styles.swatch} ${color === c ? styles.swatchActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className={styles.customColorRow}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className={styles.colorPicker} title="Custom color" />
              <div className={styles.currentColor} style={{ background: color }} />
            </div>
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Pen Emoji</div>
            <div className={styles.emojiGrid}>
              {PEN_EMOJIS.map(em => (
                <button
                  key={em}
                  className={`${styles.emojiBtn} ${penEmoji === em ? styles.emojiBtnActive : ''}`}
                  onClick={() => setPenEmoji(penEmoji === em ? null : em)}
                  title={em}
                >
                  {em}
                </button>
              ))}
            </div>
            {penEmoji && <div className={styles.emojiHint}>Selected: {penEmoji} (click again to remove)</div>}
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Zoom — {Math.round(zoom * 100)}%</div>
            <input type="range" min="10" max="400" step="5" value={Math.round(zoom * 100)} onChange={e => setZoom(+e.target.value / 100)} className={styles.slider} />
          </div>
        </div>

        {/* CANVAS */}
        <div className={styles.canvasWrap} ref={wrapRef} onWheel={onWheel}>
          <canvas
            ref={canvasRef}
            style={canvasStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={(e) => {
              pointers.current.delete(e.pointerId)
              if (!gesture.current.active) {
                isDrawing.current = false
                getOctx()?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
                if (emojiFollowerRef.current) emojiFollowerRef.current.style.display = 'none'
              }
            }}
          />
          <canvas ref={overlayRef} style={{ ...canvasStyle, pointerEvents: 'none', opacity: 0.9 }} />

          {/* Comment pins */}
          {comments.map((c, i) => (
            <div
              key={i}
              className={styles.commentPin}
              style={{
                left: `calc(50% + ${pan.x}px + ${(c.x - CANVAS_WIDTH / 2) * zoom}px)`,
                top: `calc(50% + ${pan.y}px + ${(c.y - CANVAS_HEIGHT / 2) * zoom}px)`,
              }}
            >
              <div className={styles.commentDot} style={{ background: c.user_color }}>💬</div>
              <div className={styles.commentBubble}>
                <strong style={{ color: c.user_color }}>{c.user_name}</strong>
                <br />{c.content}
              </div>
            </div>
          ))}

          {/* Emoji follower */}
          {penEmoji && (
            <div ref={emojiFollowerRef} className={styles.emojiFollower} style={{ display: 'none', fontSize: size + 14 }}>
              {penEmoji}
            </div>
          )}
          <div className={styles.zoomBadge}>{Math.round(zoom * 100)}%</div>
        </div>

        {/* RIGHT PANEL */}
        <div className={`${styles.rightPanel} ${mobileSheet === 'people' ? styles.sheetOpen : ''}`}>
          <div className={styles.sheetHandle} onClick={() => setMobileSheet(null)} />
          <div className={styles.usersSection}>
            <div className={styles.panelTitle}>👥 Participants</div>
            {users.map(u => (
              <div key={u.id} className={styles.userRow}>
                <div className={styles.userDot} style={{ background: u.color }} />
                <span className={styles.userName}>{u.name}{u.id === room?.host_id ? ' 👑' : ''}</span>
                {isHost && u.id !== myId && (
                  <button className={styles.kickBtn} onClick={() => kickUser(u.id, u.name)}>Kick</button>
                )}
              </div>
            ))}
          </div>

          <div className={styles.chatSection}>
            <div className={styles.panelTitle}>💬 Emoji Chat</div>
            <div className={styles.chatMessages}>
              {chatMessages.map((m, i) => (
                <div key={i} className={styles.chatLine}>
                  <span className={styles.chatUser} style={{ color: m.user_color }}>{m.user_name}</span>
                  <span className={styles.chatEmoji}>{m.emoji}</span>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>
            <div className={styles.chatEmojiGrid}>
              {CHAT_EMOJIS.map(em => (
                <button key={em} className={styles.chatEmojiBtn} onClick={() => sendChatEmoji(em)}>{em}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MOBILE BAR + BACKDROP (phone only) */}
      {mobileSheet && <div className={styles.sheetBackdrop} onClick={() => setMobileSheet(null)} />}
      <div className={styles.mobileBar}>
        <button
          className={`${styles.mobileBarBtn} ${mobileSheet === 'tools' ? styles.mobileBarBtnActive : ''}`}
          onClick={() => setMobileSheet(mobileSheet === 'tools' ? null : 'tools')}
        >
          🎨 Tools
        </button>
        <span className={styles.mobileColorDot} style={{ background: color }} />
        <button
          className={`${styles.mobileBarBtn} ${mobileSheet === 'people' ? styles.mobileBarBtnActive : ''}`}
          onClick={() => setMobileSheet(mobileSheet === 'people' ? null : 'people')}
        >
          👥 People
        </button>
      </div>

      {/* MODALS */}
      {showTimerModal && isHost && (
        <TimerModal onSet={handleTimerSet} onSkip={() => setShowTimerModal(false)} />
      )}
      {showStatsModal && (
        <StatsModal
          users={users}
          roomName={room?.name || ''}
          canvas={canvasRef.current}
          onClose={() => setShowStatsModal(false)}
          onLeave={() => router.push('/')}
        />
      )}
      {showCommentModal && (
        <CommentModal
          onSubmit={submitComment}
          onCancel={() => { setShowCommentModal(false); setPendingCommentPos(null) }}
        />
      )}
    </div>
  )
}
