import { describe, expect, it } from 'vitest'
import { prepareMediaOptionsFromEnv } from './vitePlugin.ts'

describe('multimodal Vite media configuration', () => {
  it('passes loadEnv-only media settings to the actual preparation path', () => {
    expect(
      prepareMediaOptionsFromEnv({
        GEMINI_INLINE_VIDEO_MAX_BYTES: '10485760',
        GEMINI_TRANSCODE_TARGET_BYTES: '8388608',
        MULTIMODAL_DOWNLOAD_MAX_BYTES: '67108864',
        MULTIMODAL_ALLOW_CLASH_FAKE_IP: 'true',
        FFMPEG_BIN: ' C:\\tools\\ffmpeg.exe ',
        FFPROBE_BIN: ' C:\\tools\\ffprobe.exe ',
      }),
    ).toEqual({
      inlineMaxBytes: 10_485_760,
      transcodeTargetBytes: 8_388_608,
      downloadMaxBytes: 67_108_864,
      allowClashFakeIp: true,
      ffmpegBin: 'C:\\tools\\ffmpeg.exe',
      ffprobeBin: 'C:\\tools\\ffprobe.exe',
    })
  })

  it('omits invalid optional limits so media defaults remain authoritative', () => {
    expect(
      prepareMediaOptionsFromEnv({
        GEMINI_INLINE_VIDEO_MAX_BYTES: '0',
        GEMINI_TRANSCODE_TARGET_BYTES: 'not-a-number',
        MULTIMODAL_DOWNLOAD_MAX_BYTES: '-1',
        FFMPEG_BIN: '   ',
      }),
    ).toEqual({ allowClashFakeIp: false })
  })
})
