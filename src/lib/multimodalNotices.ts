import type { MultimodalAnalysisBundle } from '../contracts/multimodalAnalysis'
import type { MultimodalServiceStatus } from './multimodalAnalysis'

/**
 * Explain the server-side preprocessing state without implying that zero local
 * frames means the upstream model received no video. Browsers never run these
 * binaries; "local" means the machine or container running the Node service.
 */
export function multimodalPreprocessingNotice(
  status: MultimodalServiceStatus | null,
): string | null {
  if (
    !status ||
    !status.enabled ||
    !status.authorized ||
    !status.configured ||
    status.capabilities.sceneKeyframes
  ) {
    return null
  }
  if (!status.capabilities.videoInline) {
    return '运行多模态服务的电脑或服务器未检测到可用的 FFmpeg 视频预处理能力。当前模型既不能安全接收完整视频，也没有本地关键帧，因此视频会在调用模型前安全跳过；图片分析不受影响。'
  }
  return '运行多模态服务的电脑或服务器未同时检测到 FFmpeg 与 ffprobe。符合请求上限的完整视频仍会直接交给所选模型，由模型自己的视频管线采样画面。缺少任一工具都不会生成本地时间标注关键帧；缺少 FFmpeg 还会停用压缩转码和超限兜底，缺少 ffprobe 则无法可靠核验时长与音轨，MM01 即使完成，P02 仍会因时长不可验证而被完整性门禁阻断。建议在运行 Node 服务的机器上安装二者并重启服务。'
}

export function localKeyframeResultNotice(
  diagnostics: MultimodalAnalysisBundle['diagnostics'],
): string | null {
  const wholeVideo =
    diagnostics.mediaMode === 'video_inline' ||
    diagnostics.mediaMode === 'video_inline_keyframes'
  if (!wholeVideo || diagnostics.keyframeCount !== 0) return null
  return '本次没有生成本地时间标注关键帧；完整视频仍已 inline 送达模型，画面由模型自己的视频管线采样。这不代表模型只看到了字幕。'
}
