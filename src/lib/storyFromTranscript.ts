/** 字幕清洗与 50–200 字故事拆解 */

const THEME_RULES: { re: RegExp; theme: string }[] = [
  { re: /airport|travel|trip|hotel|点餐|问路|机场|旅行|行李/, theme: '旅行场景·现场沟通' },
  { re: /recipe|cook|bake|air fryer|食谱|做饭|烘焙|甜品|蛋糕/, theme: '美食教程·制作过程' },
  { re: /language|subtitle|翻译|外语|英语|口音|学外语|kill a language/, theme: '语言学习·表达障碍' },
  { re: /pun|谐音|joke|meme|misunderstand|误会|社死|假朋友/, theme: '跨语误会·谐音梗' },
  { re: /dance|challenge|choreo|卡点|挑战/, theme: '纯表演·挑战玩法' },
  { re: /cheat|affair|出轨|分手|heartbreak|背叛/, theme: '情感冲突·关系戏剧' },
  { re: /game|开黑|世界杯|球迷|idol|粉丝|综艺/, theme: '兴趣圈层·社交场景' },
  { re: /friend|家人|亲情|治愈|温暖/, theme: '人际温度·日常切片' },
]

/** WEBVTT / SRT / 纯文本 → 连续口播正文 */
export function transcriptToPlain(raw: string): string {
  if (!raw.trim()) return ''
  const lines = raw.replace(/\r/g, '').split('\n')
  const chunks: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (/^WEBVTT/i.test(t)) continue
    if (/^\d+$/.test(t)) continue
    if (/^\d{1,2}:\d{2}/.test(t)) continue
    if (/-->/.test(t)) continue
    if (/^NOTE\b/i.test(t)) continue
    chunks.push(t)
  }
  return chunks
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function inferMaterialTheme(
  title: string,
  caption: string,
  transcript: string,
): string {
  const hay = `${title}\n${caption}\n${transcript}`
  for (const rule of THEME_RULES) {
    if (rule.re.test(hay)) return rule.theme
  }
  const seed = (transcript || caption || title).replace(/\s+/g, ' ').trim()
  if (!seed) return '未识别主题·待人工补全'
  const short = seed.slice(0, 24)
  return `口播叙事·${short}${seed.length > 24 ? '…' : ''}`
}

function trimToWindow(text: string, min: number, max: number): string {
  let t = text.replace(/\s+/g, ' ').trim()
  if (!t) return t
  if (t.length > max) {
    const cut = t.slice(0, max - 1)
    const lastPause = Math.max(
      cut.lastIndexOf('。'),
      cut.lastIndexOf('！'),
      cut.lastIndexOf('？'),
      cut.lastIndexOf('. '),
      cut.lastIndexOf('；'),
      cut.lastIndexOf('，'),
    )
    t =
      lastPause > min
        ? cut.slice(0, lastPause + 1)
        : `${cut}…`
  }
  if (t.length < min) {
    const pad =
      ' 综合标题与字幕信息，可据此改写成 Demo App 本地化广告故事线，突出跨语沟通冲突与解围。'
    t = (t + pad).slice(0, max)
  }
  // 仍不足 50（极端空输入）时再兜底
  if (t.length < min) {
    t = '素材故事暂不完整，请结合字幕与标题手工补全冲突、转折与结尾，形成可投放的短故事。'.slice(
      0,
      max,
    )
  }
  return t
}

/**
 * 根据标题、帖文、字幕拆成 50–200 字故事内容（供后续拆解/制作使用）。
 */
export function buildStorySummary(input: {
  title: string
  caption: string
  transcript: string
  theme: string
}): string {
  const title = input.title.replace(/\s+/g, ' ').trim()
  const caption = input.caption.replace(/\s+/g, ' ').trim()
  const transcript = input.transcript.replace(/\s+/g, ' ').trim()
  const theme = input.theme

  const parts: string[] = []
  parts.push(`主题「${theme}」。`)

  if (title) {
    const t = title.length > 40 ? `${title.slice(0, 40)}…` : title
    parts.push(`标题侧：${t}`)
  }

  if (transcript) {
    parts.push(`字幕故事：${transcript}`)
  } else if (caption) {
    parts.push(`帖文故事：${caption}`)
  } else {
    parts.push('暂无可用字幕，仅能依据标题做粗粒度故事推断。')
  }

  // 标题与字幕高度重复时，避免堆叠
  let merged = parts.join('')
  if (caption && transcript && caption.length > 20) {
    const capHead = caption.slice(0, 24)
    if (!transcript.includes(capHead) && !merged.includes(capHead)) {
      merged += `帖文补充：${caption.slice(0, 60)}${caption.length > 60 ? '…' : ''}`
    }
  }

  return trimToWindow(merged, 50, 200)
}
