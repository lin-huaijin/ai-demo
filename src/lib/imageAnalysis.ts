import {
  parseImageAnalysisPack,
  type ImageAnalysisPack,
} from '../contracts/imageAnalysis.ts'

export function parseImageAnalysisApiResponse(data: unknown): ImageAnalysisPack {
  if (!data || typeof data !== 'object') {
    throw new Error('图片 IM01 响应格式无效')
  }
  const raw = data as Record<string, unknown>
  return parseImageAnalysisPack(raw.analysis)
}

export function imageAnalysisVisualDescription(
  analysis: ImageAnalysisPack,
): string {
  const headline = analysis.ocrBlocks
    .filter((block) => block.textRole === 'headline')
    .map((block) => block.text)
    .join(' / ')
  const primaryObjects = analysis.visualInventory
    .filter((item) => item.visualRole === 'hook' || item.visualRole === 'proof')
    .slice(0, 5)
    .map((item) => item.description)
    .join('；')
  const parts = [
    analysis.layoutMap.composition,
    headline ? `主文字：${headline}` : '',
    primaryObjects ? `关键视觉：${primaryObjects}` : '',
    analysis.semanticRead.literalMessage,
  ].filter(Boolean)
  return parts.join('\n')
}
