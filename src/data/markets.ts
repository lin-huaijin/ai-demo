import type { Market } from '../types'
export { FEATURE_LABELS } from './features'

export const MARKETS: Market[] = [
  { id: 'id', name: '印尼', nameEn: 'Indonesia', priority: 1, regionCode: 'ID', languages: ['id-ID', 'en'] },
  { id: 'jp', name: '日本', nameEn: 'Japan', priority: 2, regionCode: 'JP', languages: ['ja-JP'] },
  { id: 'kr', name: '韩国', nameEn: 'Korea', priority: 3, regionCode: 'KR', languages: ['ko-KR'] },
  { id: 'my', name: '马来西亚', nameEn: 'Malaysia', priority: 4, regionCode: 'MY', languages: ['ms-MY', 'en'] },
  { id: 'ph', name: '菲律宾', nameEn: 'Philippines', priority: 5, regionCode: 'PH', languages: ['en', 'fil'] },
  { id: 'in', name: '印度', nameEn: 'India', priority: 6, regionCode: 'IN', languages: ['en', 'hi-IN'] },
  { id: 'vn', name: '越南', nameEn: 'Vietnam', priority: 7, regionCode: 'VN', languages: ['vi-VN'] },
  { id: 'th', name: '泰国', nameEn: 'Thailand', priority: 8, regionCode: 'TH', languages: ['th-TH'] },
  { id: 'us', name: '美国及其他英语国家', nameEn: 'USA & other English-speaking markets', priority: 9, regionCode: 'US', languages: ['en'] },
  { id: 'gcc', name: 'GCC / 阿语市场', nameEn: 'GCC / Arabic', priority: 10, regionCode: 'AE', languages: ['ar'] },
  { id: 'br', name: '巴西', nameEn: 'Brazil', priority: 11, regionCode: 'BR', languages: ['pt-BR'] },
]

export const TOPIC_LABELS: Record<string, string> = {
  travel: '旅行',
  cross_culture: '跨文化交流',
  language_learning: '学外语',
}

export const PERIODIC_LABELS: Record<string, string> = {
  game: '游戏',
  anime: '动漫',
  idol: '偶像',
  variety: '综艺',
}

export const SOURCE_LABELS: Record<string, string> = {
  likes_top: '点赞 Top',
  views_top: '浏览 Top',
  topic_tag: '特定标签',
  periodic: '周期话题',
}

export const WORKFLOW_STEPS = [
  { id: 'ingest', title: '粘贴链接', desc: '飞书热帖 URL', path: '/inspire' },
  { id: 'breakdown', title: '识别与拆解', desc: '核心梗·卖点分流', path: '/inspire' },
  { id: 'screen', title: '人工筛选', desc: '选出可进制作', path: '/screen' },
  { id: 'produce', title: '制作', desc: '复制脚本·跳转工具', path: '/produce' },
  { id: 'push', title: '机审投放', desc: '自动推送', path: '/push' },
] as const
