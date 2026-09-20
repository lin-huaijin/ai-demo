import { describe, expect, it } from 'vitest'
import { normalizeForeplayAd } from './foreplay'
import {
  AUTO_MARKET_ID,
  hotItemFromForeplayAd,
  UNKNOWN_MARKET_ID,
} from './linkIngest'

describe('Foreplay media mapping', () => {
  it('does not infer an automatic market from unverified provider copy', () => {
    const ad = normalizeForeplayAd({
      id: 'provider-ad-auto-market',
      name: '日本旅行キャンペーン',
      description: '日本のおすすめスポット',
      full_transcription: '日本語の候補字幕です',
      video: 'https://cdn.foreplay.example/japan.mp4',
    })

    const item = hotItemFromForeplayAd(ad, AUTO_MARKET_ID)

    expect(item.marketId).toBe(UNKNOWN_MARKET_ID)
    expect(item.marketSelection).toBe('auto')
  })

  it('keeps an explicitly selected campaign market authoritative', () => {
    const ad = normalizeForeplayAd({
      id: 'provider-ad-explicit-market',
      name: '日本旅行キャンペーン',
      video: 'https://cdn.foreplay.example/japan.mp4',
    })

    const item = hotItemFromForeplayAd(ad, 'id')

    expect(item.marketId).toBe('id')
    expect(item.marketSelection).toBe('explicit')
  })

  it('keeps the landing page separate from source and downloadable media', () => {
    const ad = normalizeForeplayAd({
      id: 'provider-ad-1',
      name: 'Example Brand',
      headline: 'A visual-first ad',
      foreplay_url: 'https://app.foreplay.co/share/provider-ad-1',
      link_url: 'https://brand.example/products/landing',
      video: 'https://cdn.foreplay.example/creative.mp4',
      image: 'https://cdn.foreplay.example/poster.jpg',
      thumbnail: 'https://cdn.foreplay.example/thumbnail.jpg',
      full_transcription: 'The original provider transcript.',
      video_duration: 9.5,
      running_duration: 42,
      publisher_platform: ['facebook'],
    })

    const item = hotItemFromForeplayAd(ad, 'us')

    expect(item.sourceUrl).toBe(
      'https://app.foreplay.co/share/provider-ad-1',
    )
    expect(item.landingUrl).toBe('https://brand.example/products/landing')
    expect(item.mediaUrl).toBe(
      'https://cdn.foreplay.example/creative.mp4',
    )
    expect(item.mediaUrls).toEqual([
      'https://cdn.foreplay.example/creative.mp4',
    ])
    expect(item.videoUrls).toEqual([
      'https://cdn.foreplay.example/creative.mp4',
    ])
    expect(item.imageUrls).toEqual([])
    expect(item.thumbnailUrl).toBe(
      'https://cdn.foreplay.example/thumbnail.jpg',
    )
    expect(item.mediaKind).toBe('video')
    expect(item.durationSeconds).toBe(9.5)
    expect(item.runningDuration).toBe(42)
    expect(item.views).toBe(0)
    expect(item.providerTranscript).toBe(
      'The original provider transcript.',
    )
    expect(item.transcriptSource).toBe('provider')
    expect(item.sourceMarketId).toBe('us')
    expect(item.sourceMarketEvidence).toBe('video_language')
    expect(item.marketId).toBe('us')
    expect(item.targetMarketSource).toBe('user_override')
  })

  it('retains card videos, independent stills and card transcripts', () => {
    const ad = normalizeForeplayAd({
      id: 'provider-ad-2',
      headline: 'Mixed carousel',
      carousel_cards: [
        {
          id: 'video-card',
          video: 'https://cdn.foreplay.example/card.mp4',
          image: 'https://cdn.foreplay.example/card-poster.jpg',
          full_transcription: 'Video card line.',
        },
        {
          id: 'image-card',
          image: 'https://cdn.foreplay.example/card.jpg',
          full_transcription: 'Image card text.',
        },
      ],
    })

    const item = hotItemFromForeplayAd(ad, 'us')

    expect(item.videoUrls).toEqual([
      'https://cdn.foreplay.example/card.mp4',
    ])
    expect(item.imageUrls).toEqual([
      'https://cdn.foreplay.example/card.jpg',
    ])
    expect(item.mediaUrls).toEqual([
      'https://cdn.foreplay.example/card.mp4',
      'https://cdn.foreplay.example/card.jpg',
    ])
    expect(item.mediaKind).toBe('mixed')
    expect(item.transcript).toBe('Video card line. Image card text.')
    expect(item.providerTranscript).toBe(item.transcript)
  })

  it('defers automatic video-language routing until MM01 verifies the transcript', () => {
    const ad = normalizeForeplayAd({
      id: 'provider-ad-market',
      headline: 'Aku dan kamu membaca caption ini',
      video: 'https://cdn.foreplay.example/japanese.mp4',
      full_transcription: 'こんにちは、今日は何を食べたいですか',
    })

    const item = hotItemFromForeplayAd(ad, 'auto')

    expect(item.sourceMarketId).toBe('unknown')
    expect(item.sourceMarketEvidence).toBe('unknown')
    expect(item.marketId).toBe('unknown')
    expect(item.targetMarketSource).toBe('source_default')
  })
})
