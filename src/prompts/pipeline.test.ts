import { describe, expect, it } from 'vitest'
import type { HotItem, InspirationBreakdown } from '../types.ts'
import {
  auditP09CoreRetention,
  buildPromptChain,
  finalizeP09Generation,
  GENERATED_VIDEO_MAX_DURATION_SEC,
  inferMediaKind,
  type PromptRuntimeResults,
} from './pipeline.ts'
import { MM01_SYSTEM_PROMPT } from './mm01SystemPrompt.ts'

function item(overrides: Partial<HotItem> = {}): HotItem {
  return {
    id: 'item-1',
    marketId: 'id',
    platform: 'tiktok',
    title: '素材',
    likes: 0,
    views: 0,
    source: 'topic_tag',
    topicTags: ['cross_culture'],
    formatFit: ['video'],
    oneLiner: '素材说明',
    suggestedFeature: 'chat',
    collectedAt: '2026-07-21T00:00:00.000Z',
    dedupeKey: 'item-1',
    ...overrides,
  }
}

function breakdown(
  overrides: Partial<InspirationBreakdown['fit']> = {},
): InspirationBreakdown {
  return {
    hotItemId: 'item-1',
    brokenDownAt: '2026-07-21T00:00:00.000Z',
    meme: {
      core: '原梗核心',
      audienceReason: '原观众继续看的原因',
      narrativeEngine: '原叙事运转机制',
      payoffLogic: '原结尾兑现逻辑',
      replaceableSurface: ['旧地点'],
      forbiddenSurface: ['旧品牌'],
      axis: 'plot',
      plotDevice: 'twist',
      axisReason: '存在明确反转',
      hookStrength: 'strong',
      hookReason: '首屏冲突清晰',
    },
    fit: {
      kind: 'direct',
      feature: 'chat',
      hardPlacementFeature: 'chat',
      reason: '存在跨语沟通冲突',
      placementOptions: ['soft', 'hard'],
      recommendedPlacement: 'soft',
      keepInHotPool: true,
      returnToHotPool: false,
      enterScreening: true,
      ...overrides,
    },
  }
}

function completeRuntimeResults(): PromptRuntimeResults {
  return {
    p05: {
      core: 'RUNTIME_CORE',
      audienceReason: 'RUNTIME_AUDIENCE_REASON',
      narrativeEngine: 'RUNTIME_NARRATIVE_ENGINE',
      payoffLogic: 'RUNTIME_PAYOFF',
      hotSceneCore: 'RUNTIME_SCENE',
      hookCore: 'RUNTIME_HOOK',
      transferableCore: 'RUNTIME_TRANSFERABLE',
      sourceSemanticCore: 'RUNTIME_SEMANTIC_CORE',
      creativeContract: {
        hook: 'RUNTIME_CONTRACT_HOOK',
        mechanism: 'RUNTIME_CONTRACT_MECHANISM',
        payoff: 'RUNTIME_CONTRACT_PAYOFF',
        mustKeep: ['RUNTIME_CONTRACT_HOOK', 'RUNTIME_CONTRACT_MECHANISM'],
        canChange: ['RUNTIME_CONTRACT_CAN_CHANGE'],
        mustAvoid: ['RUNTIME_CONTRACT_MUST_AVOID'],
        sourceTask: 'RUNTIME_SOURCE_TASK',
      },
      replaceableSurface: ['REPLACEABLE_SURFACE'],
      forbiddenSurface: ['FORBIDDEN_SURFACE'],
      riskDetails: ['RISK_DETAIL'],
      sceneAsset: {
        physicalSetting: 'RUNTIME_PHYSICAL_SETTING',
        socialConfiguration: 'RUNTIME_SOCIAL_CONFIGURATION',
        audienceIdentity: 'RUNTIME_AUDIENCE_IDENTITY',
        emotionalAtmosphere: 'RUNTIME_EMOTIONAL_ATMOSPHERE',
        visualStyle: 'RUNTIME_VISUAL_STYLE',
      },
      assetInheritanceDecision: [
        {
          asset: 'physicalSetting',
          decision: 'keep_or_adapt',
          productRelevance: 'indirect',
          reason: 'RUNTIME_PHYSICAL_REASON',
          downstreamRequirement: 'RUNTIME_PHYSICAL_REQUIREMENT',
        },
        {
          asset: 'socialConfiguration',
          decision: 'keep',
          productRelevance: 'direct',
          reason: 'RUNTIME_SOCIAL_REASON',
          downstreamRequirement: 'RUNTIME_SOCIAL_REQUIREMENT',
        },
        {
          asset: 'audienceIdentity',
          decision: 'transform',
          productRelevance: 'none',
          reason: 'RUNTIME_IDENTITY_REASON',
          downstreamRequirement: 'RUNTIME_IDENTITY_REQUIREMENT',
          risk: 'RUNTIME_IDENTITY_RISK',
        },
        {
          asset: 'emotionalAtmosphere',
          decision: 'keep_or_adapt',
          productRelevance: 'indirect',
          reason: 'RUNTIME_EMOTION_REASON',
          downstreamRequirement: 'RUNTIME_EMOTION_REQUIREMENT',
        },
        {
          asset: 'visualStyle',
          decision: 'keep_or_adapt',
          productRelevance: 'indirect',
          reason: 'RUNTIME_STYLE_REASON',
          downstreamRequirement: 'RUNTIME_STYLE_REQUIREMENT',
        },
      ],
      sourceAdLoop: {
        hasPainHook: true,
        hasProductProof: true,
        hasResultAction: true,
        hasCta: true,
        hasCompleteLoop: true,
        loopType: 'product_ad',
        proofRole: 'core_solution',
        inheritanceMode: 'product_swap',
        painHook: 'RUNTIME_PAIN_HOOK',
        productProof: 'RUNTIME_PRODUCT_PROOF',
        resultAction: {
          taskGoal: 'RUNTIME_TASK_GOAL',
          userPain: 'RUNTIME_USER_PAIN',
          emotionalShift: 'RUNTIME_EMOTIONAL_SHIFT',
          type: 'avoidance',
          action: 'RUNTIME_RESULT_ACTION',
          allowedResultActions: ['RUNTIME_RESULT_ACTION'],
          forbiddenResultActions: ['FORBIDDEN_RESULT_ACTION'],
          reason: 'RUNTIME_RESULT_REASON',
        },
        cta: 'RUNTIME_CTA',
        doNotReinventResolution: true,
        reason: 'RUNTIME_AD_LOOP_REASON',
      },
      coreElements: [
        {
          id: 'C1',
          content: 'RUNTIME_CORE_ELEMENT',
          semanticRole: 'premise',
          necessity: 'must_keep',
          riskType: 'sensitive_topic',
          handling: 'qualify',
          preservationStrength: 'exact_qualified',
          requiredSurfaceTokens: ['SURFACE_TOKEN'],
          requiredQualifierTokens: ['QUALIFIER_TOKEN'],
          retentionRequirement: 'RETAIN_REQUIREMENT',
          transformationBoundary: 'TRANSFORMATION_BOUNDARY',
          evidenceRefs: ['E1'],
        },
      ],
      coreDependencies: [],
      coreSignature: ['C1'],
      axis: 'plot',
      emotionTone: null,
      plotDevice: 'twist',
      axisReason: 'RUNTIME_AXIS_REASON',
      hookStrength: 'strong',
      hookReason: 'RUNTIME_HOOK_REASON',
    },
    p06: {
      kind: 'direct',
      feature: 'translator',
      hardPlacementFeature: 'translator',
      placementOptions: ['soft', 'hard'],
      recommendedPlacement: 'hard',
      enterScreening: true,
      reason: 'RUNTIME_P06_REASON',
      primaryPromise: 'RUNTIME_PRIMARY_PROMISE',
      proofMode: 'functional_proof',
      featureRole: 'core_solution',
      relationshipOutcome: 'RUNTIME_RELATIONSHIP_OUTCOME',
      selectedCapability: 'RUNTIME_SELECTED_CAPABILITY',
      socialPayoff: 'RUNTIME_SOCIAL_PAYOFF',
      proofTask: 'RUNTIME_PROOF_TASK',
      socialOutcome: 'RUNTIME_SOCIAL_OUTCOME',
      rewritePlan: {
        preserve: 'RUNTIME_REWRITE_PRESERVE',
        insertAt: 'RUNTIME_REWRITE_INSERT_AT',
        proofBeat: 'RUNTIME_REWRITE_PROOF_BEAT',
        resultBeat: 'RUNTIME_REWRITE_RESULT_BEAT',
      },
      coreHandlingPlan: [
        {
          coreId: 'C1',
          decision: 'qualify',
          reason: 'RUNTIME_HANDLING_REASON',
          downstreamRequirement: 'RETAIN_REQUIREMENT',
        },
      ],
      riskTransformationContract: {
        retainedSensitiveCore: [
          {
            coreId: 'C1',
            retentionRequirement: 'RETAIN_REQUIREMENT',
            allowedTreatment: 'QUALIFY_ONLY',
          },
        ],
        restrictedExpressions: [],
        requiredTransformations: [],
        factRequirements: [],
      },
      productCapabilityGate: {
        feature: 'translator',
        status: 'verified',
        verifiedCapabilities: ['VERIFIED_CAPABILITY'],
        unverifiedCapabilities: [],
        coreResolutionRole: 'allowed',
        primaryPromise: 'RUNTIME_PRIMARY_PROMISE',
        proofMode: 'functional_proof',
        featureRole: 'core_solution',
        relationshipOutcomes: ['RUNTIME_RELATIONSHIP_OUTCOME'],
        selectedCapability: 'RUNTIME_SELECTED_CAPABILITY',
        socialPayoff: 'RUNTIME_SOCIAL_PAYOFF',
        hardBoundaries: ['RUNTIME_HARD_BOUNDARY'],
        forbiddenClaims: ['RUNTIME_FORBIDDEN_CLAIM'],
        reason: 'RUNTIME_CAPABILITY_REASON',
      },
      adLoopExecution: {
        inheritanceMode: 'product_swap',
        preserveProofSlot: true,
        preserveResultAction: true,
        resultActionContract: {
          taskGoal: 'RUNTIME_TASK_GOAL',
          userPain: 'RUNTIME_USER_PAIN',
          emotionalShift: 'RUNTIME_EMOTIONAL_SHIFT',
          type: 'avoidance',
          action: 'RUNTIME_RESULT_ACTION',
          allowedResultActions: ['RUNTIME_RESULT_ACTION'],
          forbiddenResultActions: ['FORBIDDEN_RESULT_ACTION'],
          reason: 'RUNTIME_RESULT_REASON',
        },
        doNotReinventResolution: true,
        reason: 'RUNTIME_EXECUTION_REASON',
        downstreamRequirement: 'RUNTIME_AD_LOOP_REQUIREMENT',
      },
    },
    p07: {
      feature: 'translator',
      socialPayoffPlan: 'RUNTIME_SOCIAL_PAYOFF_PLAN',
      softPlan: {
        canUse: true,
        rewrittenScene: 'RUNTIME_REWRITTEN_SCENE',
        preservedHook: 'RUNTIME_HOOK',
        preservedScene: 'RUNTIME_SCENE',
        sellInsertPoint: 'RUNTIME_SELL_POINT',
        fallbackTo: 'hard',
        fallbackReason: '',
      },
      hardPlan: {
        hookClimax: 'RUNTIME_CLIMAX',
        hardCutPoint: 'RUNTIME_CUT_POINT',
        placementContinuity: 'RUNTIME_CONTINUITY',
        transitionLine: 'RUNTIME_TRANSITION',
        directSellBeat: 'RUNTIME_SELL_BEAT',
        proofBeat: 'RUNTIME_PROOF',
        ctaBeat: 'RUNTIME_CTA',
      },
      coreCoverage: [
        {
          coreId: 'C1',
          necessity: 'must_keep',
          status: 'qualified',
          realization: 'SURFACE_TOKEN QUALIFIER_TOKEN',
          realizationChannels: ['visible', 'audible'],
          equivalence: 'RUNTIME_EQUIVALENCE',
          omissionReason: '',
        },
      ],
      approvedCoreRealization: {
        premise: 'RUNTIME_PREMISE',
        conflict: 'RUNTIME_CONFLICT',
        narrativeEngine: 'RUNTIME_ENGINE_REALIZATION',
        payoff: 'RUNTIME_PAYOFF_REALIZATION',
        safeSurface: 'RUNTIME_SAFE_SURFACE',
      },
    },
  }
}

describe('P01 media routing', () => {
  it('keeps explicit video and mixed media on the MM01 branch even without transcript', () => {
    expect(
      inferMediaKind(item({ mediaKind: 'video', transcriptStatus: 'skipped' })),
    ).toBe('video')
    expect(
      inferMediaKind(item({ mediaKind: 'mixed', transcriptStatus: 'skipped' })),
    ).toBe('video')
  })

  it('routes explicit still and text media without using stale transcript state', () => {
    expect(
      inferMediaKind(item({ mediaKind: 'image', transcriptStatus: 'ok' })),
    ).toBe('image_text')
    expect(
      inferMediaKind(item({ mediaKind: 'carousel', transcriptStatus: 'ok' })),
    ).toBe('image_text')
    expect(
      inferMediaKind(item({ mediaKind: 'text', transcriptStatus: 'ok' })),
    ).toBe('text_joke')
  })
})

describe('video prompt chain', () => {
  it('uses the canonical MM01 policy and keeps caption separate from oneLiner', () => {
    const mm01 = buildPromptChain(
      item({
        mediaKind: 'video',
        caption: '真实帖子 caption',
        oneLiner: 'P02 故事字段，不得冒充 caption',
      }),
      breakdown(),
    ).find((step) => step.id === 'MM01')?.prompt ?? ''

    expect(mm01).toContain(MM01_SYSTEM_PROMPT)
    for (const requirement of [
      '能力与覆盖声明',
      '【明确证据】',
      '【高概率暗线/隐喻】',
      '【待核验/纯猜测】',
      're-hook',
      '文化信号、隐喻、隐藏笑点和潜规则',
      '核心暗线：',
      '可复用的三个机制：',
      '仍待核验：',
      '音频音效复核',
      '不得把普通 BGM 中的鼓点',
      'audio.sfx 必须为空数组',
      '不得生成不存在的具体事件音效',
      '形式动作歧义复核',
      '手势舞/动作挑战/卡点表演/氛围型表演',
      '节奏化动作/表演性手势/氛围动作',
    ]) {
      expect(mm01).toContain(requirement)
    }
    expect(mm01).not.toContain('打虫')
    expect(mm01).not.toContain('虫子')
    expect(mm01).toContain('caption：真实帖子 caption')
    expect(mm01).not.toContain('P02 故事字段，不得冒充 caption')
    expect(mm01).toContain('不代表模型已经看到画面、完成 OCR/ASR 或听到音轨')
  })

  it('places mandatory C01 between MM01 and deterministic P02F', () => {
    const steps = buildPromptChain(
      item({ mediaKind: 'video', transcriptStatus: 'missing' }),
      breakdown(),
    )
    const activeIds = steps.filter((step) => step.active).map((step) => step.id)

    expect(activeIds.slice(0, 5)).toEqual([
      'P01',
      'MM01',
      'C01',
      'P02F',
      'P02',
    ])
    expect(steps.find((step) => step.id === 'MM01')?.prompt).toContain(
      '"targetNextPrompt": "C01"',
    )
    expect(steps.find((step) => step.id === 'C01')?.prompt).toContain(
      'C01_CONTEXT_RESEARCH_PACK',
    )
    const p02 = steps.find((step) => step.id === 'P02')?.prompt ?? ''
    expect(p02).toContain('keyMoments')
    expect(p02).toContain('sourceVsContextBoundary')
    expect(p02).toContain('narrativeMechanics')
  })

  it('routes still-image ads through the concise image chain before P11', () => {
    const imageAnalysis: NonNullable<HotItem['imageAnalysis']> = {
      module: 'IM01_IMAGE_ANALYSIS_PACK',
      sourceMeta: {
        platform: 'meta',
        sourceUrl: 'https://example.test/ad',
        imageUrl: 'https://cdn.example.test/ad.jpg',
        marketId: 'us',
        marketLanguages: ['en-US'],
        title: 'Social ad',
        caption: '',
      },
      imageGeometry: {
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        safeArea: '中央弹窗安全区。',
      },
      visualInventory: [
        {
          id: 'v1',
          type: 'app_ui',
          description: '中央仿系统弹窗。',
          absolutePosition: { xPct: 12, yPct: 35, wPct: 76, hPct: 35 },
          relativePosition: '画面中央。',
          visualRole: 'hook',
          confidence: 'high',
        },
      ],
      ocrBlocks: [
        {
          id: 't1',
          text: 'Delete Grindr?',
          language: 'en',
          absolutePosition: { xPct: 34, yPct: 39, wPct: 32, hPct: 4 },
          relativePosition: '弹窗顶部。',
          fontScale: 'large',
          textRole: 'headline',
          verbatimSensitivity: 'brand',
          confidence: 'high',
        },
      ],
      layoutMap: {
        composition: '自拍背景 + 中央系统弹窗。',
        readingOrder: ['t1', 'v1'],
        primaryFocus: '系统弹窗',
        secondaryFocus: '自拍背景',
        ctaLocation: '弹窗底部',
        phoneUiLocation: '中央',
        textImageRelationship: '弹窗文字提出社交痛点。',
      },
      styleProfile: {
        visualStyle: 'UGC 自拍 + native UI 模拟',
        colorPalette: ['white', 'blue', 'black'],
        typographyStyle: '系统字体',
        mood: '直接、社交',
        platformFeel: 'Meta feed',
      },
      semanticRead: {
        literalMessage: '推荐替代社交 App。',
        impliedMessage: '旧 App 体验不好，新 App 更适合社交。',
        userPain: '缺少健康社交连接。',
        promisedOutcome: '找到朋友和活动。',
        emotionalDrivers: ['归属感'],
        targetAudienceSignals: ['社交 App 用户'],
        adLoop: {
          painHook: '删除旧 App',
          proofMoment: '新 App 替代',
          resultPromise: '找到连接',
          cta: '尝试新 App',
        },
      },
      riskAndCleanup: {
        sourceBrandSignals: ['Grindr', 'Collective'],
        sourceProductSignals: ['gay app'],
        sourceCtaSignals: ['Try Collective'],
        sensitiveSignals: ['gay app'],
        copyrightSignals: ['iOS alert UI'],
        unverifiedClaims: ['140K members'],
        mustNotCarryToPrompt: ['Grindr', 'Collective', '140K members'],
        safeAbstractions: ['系统弹窗式钩子', '社交替代方案痛点'],
      },
      notes: '',
      confidence: 'high',
    }
    const source = item({
      platform: 'meta',
      mediaKind: 'image',
      transcriptStatus: 'skipped',
      mediaUrl: 'https://cdn.example.test/ad.jpg',
      mediaUrls: ['https://cdn.example.test/ad.jpg'],
      imageUrls: ['https://cdn.example.test/ad.jpg'],
      imageAnalysis,
      oneLiner: '社交 App 图片广告。',
    })

    const draftSteps = buildPromptChain(source, breakdown())
    expect(draftSteps.find((step) => step.id === 'IM01')?.active).toBe(true)
    expect(draftSteps.find((step) => step.id === 'IP02')?.active).toBe(true)
    expect(draftSteps.find((step) => step.id === 'IP04')?.active).toBe(true)
    const ip04Draft = draftSteps.find((step) => step.id === 'IP04')?.prompt ?? ''
    expect(ip04Draft).toContain('Demo App capability gate')
    expect(ip04Draft).toContain('附近的人/nearby people')
    expect(ip04Draft).toContain('unsupportedCapabilitySignals')
    for (const id of ['P03', 'P04', 'P05', 'P06'] as const) {
      expect(draftSteps.find((step) => step.id === id)?.active).toBe(false)
    }
    expect(draftSteps.find((step) => step.id === 'P11')?.active).toBe(false)

    const readySteps = buildPromptChain(source, breakdown(), undefined, {
      ip02: {
        textLayoutSlots: [
          {
            slot: 'headline',
            sourceRole: 'top hero headline',
            sourceTextSummary: '原图顶部大标题',
            position: 'top',
            fontScale: 'hero',
            inherit: 'replace_text',
            reason: '保留大标题槽位',
          },
          {
            slot: 'brand',
            sourceRole: 'bottom logo text',
            sourceTextSummary: '原品牌 logo 位',
            position: 'bottom',
            fontScale: 'large',
            inherit: 'merge_to_cta',
            reason: '原品牌不能继承，可合并到 Demo App CTA',
          },
        ],
        mustRemove: ['Try Collective'],
        safeAbstractions: ['系统弹窗式钩子'],
      },
      ip04: {
        feature: 'chat',
        fitKind: 'rewrite',
        sellpointMatch: '用 Demo App Chat 替换原社交 App proofSlot。',
        keep: ['系统弹窗式钩子'],
        replace: ['原 App UI 换成 Demo App Chat 翻译气泡'],
        forbidden: ['Grindr'],
        unsupportedCapabilitySignals: ['nearby online', 'auto-add friends'],
        overlayPlan: [
          {
            sourceSlot: 'headline',
            finalRole: 'hook',
            textIntent: '社交聊天痛点钩子',
            keepPosition: true,
            note: '沿用顶部大标题槽位',
          },
          {
            sourceSlot: 'brand',
            finalRole: 'cta',
            textIntent: 'Demo App 下载 CTA',
            keepPosition: true,
            note: '原品牌位合并到底部 CTA',
          },
        ],
        p11Brief: '保留系统弹窗式社交痛点，用 Demo App Chat 翻译气泡证明跨语聊天更顺。',
        confidence: 'high',
      },
    })
    const activeIds = readySteps.filter((step) => step.active).map((step) => step.id)
    expect(activeIds).toEqual(['P01', 'IM01', 'IP02', 'IP04', 'P08', 'P11'])
    const p11 = readySteps.find((step) => step.id === 'P11')?.prompt ?? ''
    expect(p11).toContain('保留系统弹窗式社交痛点')
    expect(p11).toContain('Grindr')
    expect(p11).toContain('nearby online')
    expect(p11).toContain('auto-add friends')
    expect(p11).toContain('画面内实际可见文字不强制中文')
    expect(p11).toContain('imageForbiddenSignals')
    expect(p11).toContain('overlayPlan')
    expect(p11).toContain('overlayTexts.length 必须等于 overlayPlan.length')
    expect(p11).toContain('不得自行新增 subhead、sellBeat 或第 N 段文字')
    expect(p11).toContain('【画面提示词】')
    expect(p11).toContain('【文字排版任务】')
    expect(p11).toContain('【硬性约束】')
    expect(p11).toContain('【输出规格】')
    expect(p11).toContain('N 不固定')
    expect(p11).toContain('不得强行补成 4 段')
    expect(p11).toContain('每段必须完全等于 overlayTexts.text')
    expect(p11).toContain('文字不能缺失、不能乱码、不能替换、不能拼错')
    expect(p11).toContain('画面内文字只允许 overlayTexts')
    expect(p11).toContain('动作词必须跟随 marketLanguages 首选语言本地化')
    expect(p11).toContain('{本地化动作词} [Demo App logo + Demo App]')
    expect(p11).toContain('不得写死 Download 到非英语市场')
    expect(p11).toContain('不得把动作词放在 Demo App logo 与 Demo App 之间')
  })

  it('keeps profile/status image slots as uiStatus instead of forcing a subhead', () => {
    const source = item({
      platform: 'meta',
      mediaKind: 'image',
      transcriptStatus: 'skipped',
      mediaUrl: 'https://cdn.example.test/profile-ad.jpg',
      mediaUrls: ['https://cdn.example.test/profile-ad.jpg'],
      imageUrls: ['https://cdn.example.test/profile-ad.jpg'],
      imageAnalysis: {
        module: 'IM01_IMAGE_ANALYSIS_PACK',
        sourceMeta: {
          platform: 'meta',
          sourceUrl: 'https://example.test/profile',
          imageUrl: 'https://cdn.example.test/profile-ad.jpg',
          marketId: 'us',
          marketLanguages: ['en-US'],
          title: 'Profile ad',
          caption: '',
        },
        imageGeometry: {
          aspectRatio: '4:5',
          width: 1080,
          height: 1350,
          safeArea: '左下文字区。',
        },
        visualInventory: [],
        ocrBlocks: [
          {
            id: 'name',
            text: 'Greg',
            language: 'en',
            absolutePosition: { xPct: 5, yPct: 7, wPct: 15, hPct: 5 },
            relativePosition: 'top left',
            fontScale: 'medium',
            textRole: 'app_ui_text',
            verbatimSensitivity: 'personal',
            confidence: 'high',
          },
        ],
        layoutMap: {
          composition: 'profile card',
          readingOrder: ['name'],
          primaryFocus: 'profile card',
          secondaryFocus: 'headline',
          ctaLocation: 'bottom left',
          phoneUiLocation: 'top left',
          textImageRelationship: 'profile/status UI + headline + CTA',
        },
        styleProfile: {
          visualStyle: 'profile card',
          colorPalette: ['gray', 'purple'],
          typographyStyle: 'bold sans',
          mood: 'confident',
          platformFeel: 'Meta feed',
        },
        semanticRead: {
          literalMessage: 'profile card ad',
          impliedMessage: 'nearby social connection',
          userPain: 'hard to start local chats',
          promisedOutcome: 'start a chat nearby',
          emotionalDrivers: ['curiosity'],
          targetAudienceSignals: ['local social users'],
          adLoop: {
            painHook: 'nearby chat',
            proofMoment: 'profile card',
            resultPromise: 'start conversation',
            cta: 'download',
          },
        },
        riskAndCleanup: {
          sourceBrandSignals: [],
          sourceProductSignals: ['dating profile simulation'],
          sourceCtaSignals: ['INSTALL NOW'],
          sensitiveSignals: ['orientation label'],
          copyrightSignals: [],
          unverifiedClaims: ['specific person online nearby'],
          mustNotCarryToPrompt: ['Greg', 'INSTALL NOW'],
          safeAbstractions: ['profile card layout', 'city map background'],
        },
        notes: '',
        confidence: 'high',
      },
    })

    const steps = buildPromptChain(source, breakdown(), undefined, {
      ip02: {
        textLayoutSlots: [
          {
            slot: 'uiStatus',
            sourceRole: 'profile name/status',
            sourceTextSummary: '姓名和在线状态',
            position: 'top left',
            fontScale: 'medium',
            inherit: 'replace_text',
            reason: '作为通用 profile/status UI 槽位',
          },
          {
            slot: 'headline',
            sourceRole: 'bottom hero headline',
            sourceTextSummary: '附近社交主标题',
            position: 'bottom left',
            fontScale: 'hero',
            inherit: 'replace_text',
            reason: '保留主标题槽位',
          },
          {
            slot: 'cta',
            sourceRole: 'bottom button',
            sourceTextSummary: '下载按钮',
            position: 'bottom left',
            fontScale: 'medium',
            inherit: 'replace_text',
            reason: '替换为 Demo App CTA',
          },
        ],
      },
      ip04: {
        feature: 'chat',
        fitKind: 'rewrite',
        overlayPlan: [
          {
            sourceSlot: 'uiStatus',
            finalRole: 'uiStatus',
            textIntent: '通用在线状态，不使用真实姓名',
            keepPosition: true,
            note: '不是 subhead',
          },
          {
            sourceSlot: 'headline',
            finalRole: 'hook',
            textIntent: '附近聊天不该因为语言变远',
            keepPosition: true,
            note: '沿用主标题槽位',
          },
          {
            sourceSlot: 'cta',
            finalRole: 'cta',
            textIntent: 'Demo App 下载 CTA',
            keepPosition: true,
            note: '沿用按钮槽位',
          },
        ],
        p11Brief: '保留 profile/status + 主标题 + CTA 三槽位，uiStatus 不得改成副标题。',
      },
    })
    const p11 = steps.find((step) => step.id === 'P11')?.prompt ?? ''
    expect(p11).toContain('"finalRole": "uiStatus"')
    expect(p11).toContain('profile/status')
    expect(p11).toContain('不能误当普通 subhead')
  })

  it('quarantines conflicting speech without dropping visual, OCR or audio evidence', () => {
    const multimodalAnalysis = {
      mm01: {
        cleanedInputsForP02: {
          transcriptStatus: 'ok',
          rawTranscript: 'SECRET_SPEECH',
          visualDescription: 'VISUAL_KEEP',
          ocrText: 'OCR_KEEP',
          audioDescription: 'AUDIO_KEEP',
          sceneSegmentsText: 'SECRET_SPEECH',
        },
        sceneSegments: [
          {
            segmentId: 's1',
            asr: {
              speech: 'SECRET_SPEECH',
              language: 'en',
              speakerGuess: '主角',
            },
            audio: {
              musicMood: 'AUDIO_KEEP',
              sfx: [],
              voiceTone: '',
            },
            evidence: [
              {
                type: 'speech',
                source: 'asr',
                fact: 'SECRET_SPEECH',
              },
              { type: 'visual', source: 'frame', fact: 'VISUAL_KEEP' },
              { type: 'text', source: 'ocr', fact: 'OCR_KEEP' },
              { type: 'audio', source: 'audio', fact: 'AUDIO_KEEP' },
            ],
          },
        ],
        eventTimeline: [
          {
            literalEvent: 'VISUAL_KEEP',
            speechEvidenceRefs: ['s1:e1'],
            visibleEvidenceRefs: ['s1:e2'],
          },
        ],
        globalUnderstanding: {
          localStyleSignals: { risk: [] },
        },
        crossModalChecks: { asrVsOcr: 'conflict', notes: '' },
      },
      contextResearch: {
        module: 'C01_CONTEXT_RESEARCH_PACK',
        contextPack: [],
        interpretiveBridge: {
          videoFacts: ['VISUAL_KEEP'],
          externalContext: [],
          contextSupportedInference: '',
          uncertainty: '',
        },
        sources: [],
      },
      p02Handoff: { p02FormattedPrompt: 'SECRET_SPEECH' },
      p02: {
        sourceFactSummary: 'VISUAL_KEEP',
        evidenceBeats: [
          { type: 'speech', fact: 'SECRET_SPEECH', evidence: 'ASR' },
          { type: 'visual', fact: 'VISUAL_KEEP', evidence: '画面' },
          { type: 'text', fact: 'OCR_KEEP', evidence: 'OCR' },
          { type: 'audio', fact: 'AUDIO_KEEP', evidence: '音轨' },
        ],
        narrativeMechanics: {
          audienceReason: 'SECRET_SPEECH',
          narrativeEngine: 'SECRET_SPEECH',
          payoffLogic: 'SECRET_SPEECH',
        },
      },
    } as unknown as NonNullable<HotItem['multimodalAnalysis']>
    const steps = buildPromptChain(
      item({
        mediaKind: 'video',
        transcriptStatus: 'conflict',
        transcriptVerification: 'conflict',
        transcript: 'SECRET_SPEECH',
        oneLiner: 'SECRET_SPEECH',
        caption: '中性 caption',
        multimodalAnalysis,
      }),
      breakdown(),
    )
    const relevant = steps
      .filter((step) => ['C01', 'P02F', 'P02', 'P05'].includes(step.id))
      .map((step) => step.prompt)
      .join('\n')

    expect(relevant).not.toContain('SECRET_SPEECH')
    expect(relevant).toContain('VISUAL_KEEP')
    expect(relevant).toContain('OCR_KEEP')
    expect(relevant).toContain('AUDIO_KEEP')
    expect(relevant).toContain('speech/ASR')
  })

  it('feeds explicit P05/P06/P07 results into later prompts', () => {
    const results = completeRuntimeResults()
    const steps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
      'hard',
      results,
    )

    expect(steps.find((step) => step.id === 'P06')?.prompt).toContain(
      'RUNTIME_NARRATIVE_ENGINE',
    )
    expect(steps.find((step) => step.id === 'P07')?.prompt).toContain(
      'RUNTIME_SCENE',
    )
    expect(steps.find((step) => step.id === 'P06')?.prompt).toContain(
      'RUNTIME_AUDIENCE_IDENTITY',
    )
    expect(steps.find((step) => step.id === 'P06')?.prompt).toContain(
      'RUNTIME_PRODUCT_PROOF',
    )
    expect(steps.find((step) => step.id === 'P06')?.prompt).toContain(
      'RUNTIME_SOURCE_TASK',
    )
    expect(steps.find((step) => step.id === 'P07')?.prompt).toContain(
      'RUNTIME_STYLE_REQUIREMENT',
    )
    expect(steps.find((step) => step.id === 'P07')?.prompt).toContain(
      'RUNTIME_AD_LOOP_REQUIREMENT',
    )
    expect(steps.find((step) => step.id === 'P07')?.prompt).toContain(
      'RUNTIME_SOCIAL_PAYOFF',
    )
    const p09 = steps.find((step) => step.id === 'P09')
    expect(p09?.active).toBe(true)
    expect(p09?.prompt).toContain('RUNTIME_PAYOFF')
    expect(p09?.prompt).toContain('RUNTIME_CLIMAX')
    expect(p09?.prompt).toContain('RUNTIME_CUT_POINT')
    expect(p09?.prompt).toContain('RUNTIME_TRANSITION')
    expect(p09?.prompt).toContain('SURFACE_TOKEN')
    expect(p09?.prompt).toContain('QUALIFIER_TOKEN')
    expect(p09?.prompt).toContain('assetPreservation')
    expect(p09?.prompt).toContain('adLoopPreservation')
    expect(p09?.prompt).toContain('RUNTIME_VISUAL_STYLE')
    expect(p09?.prompt).toContain('RUNTIME_RELATIONSHIP_OUTCOME')
    expect(p09?.prompt).toContain('RUNTIME_PROOF_TASK')
    expect(p09?.prompt).toContain('RUNTIME_SOCIAL_OUTCOME')
    expect(p09?.prompt).toContain('RUNTIME_REWRITE_PROOF_BEAT')
    expect(p09?.prompt).toContain('RUNTIME_SOCIAL_PAYOFF_PLAN')
    expect(p09?.prompt).toContain('translator')
  })

  it('keeps the reduced core-risk boundary centralized in P05', () => {
    const runtimeSteps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
      'hard',
      completeRuntimeResults(),
    )
    const draftSteps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
    )

    const p02 = draftSteps.find((step) => step.id === 'P02')?.prompt ?? ''
    const p04 = draftSteps.find((step) => step.id === 'P04')?.prompt ?? ''
    const p05 = draftSteps.find((step) => step.id === 'P05')?.prompt ?? ''
    const p06 = runtimeSteps.find((step) => step.id === 'P06')?.prompt ?? ''
    const p07 = runtimeSteps.find((step) => step.id === 'P07')?.prompt ?? ''
    const p09 = runtimeSteps.find((step) => step.id === 'P09')?.prompt ?? ''

    expect(p02).toContain('不得泛化成“某个词/敏感表达/风险表层”')
    expect(p02).toContain('recommendedHandling 只作用当前原子项')
    expect(p02).toContain('hookCarrier')
    expect(p02).toContain('motionHook')
    expect(p04).toContain('contentFormat')
    expect(p04).toContain('gesture_dance')
    expect(p04).toContain('不要输出 suggestedFeature')
    expect(p04).not.toContain('"suggestedFeature"')
    expect(p05).toContain('creativeContract')
    expect(p05).toContain('sourceTask')
    expect(p05).toContain('P05 是唯一决定“哪些元素必须保留”的步骤')
    expect(p05).toContain('assetMode')
    expect(p05).toContain('formatHookCore')
    expect(p05).toContain('motion_signature')
    expect(p05).toContain('sceneAsset / assetInheritanceDecision')
    expect(p05).toContain('sourceAdLoop')
    expect(p05).toContain('audienceIdentity')
    expect(p05).toContain('删除或泛化后若 audienceReason')
    expect(p05).toContain(
      '如果风险表层承担 hook 功能，只能替换风险表面，不能删除 hook 功能',
    )
    expect(p06).toContain('P06 不重新解释 P05 已锁定的 coreElements')
    expect(p06).toContain('rewriteMode')
    expect(p06).toContain('format_rewrite')
    expect(p06).toContain('assetInheritanceDecision')
    expect(p06).toContain('audienceIdentity 的特殊门禁')
    expect(p06).toContain('product_swap')
    expect(p06).toContain('风险合同只能引用 P05/P02 已拆出的非核心风险原子项')
    expect(p06).toContain('AI Buddy')
    expect(p06).toContain('image text translation')
    expect(p06).toContain('Direct Tag')
    expect(p06).toContain('socialPayoff')
    expect(p06).toContain('relationshipOutcome')
    expect(p06).toContain('creativeContract.sourceTask')
    expect(p06).toContain('proofTask')
    expect(p06).toContain('rewritePlan')
    expect(p07).toContain('P07 不重新判断核心风险')
    expect(p07).toContain('bridgeMode')
    expect(p07).toContain('formatPlan')
    expect(p07).toContain(
      '如果风险表层承担 hook 功能，只能替换风险表面，不能删除 hook 功能',
    )
    expect(p07).toContain('visualStyle keep/keep_or_adapt')
    expect(p07).toContain('风险转换只执行 riskTransformationContract，不新增风险判断')
    expect(p07).toContain('socialPayoffPlan')
    expect(p07).toContain('proofMode=functional_proof')
    expect(p09).toContain('P09 不重新解释核心风险')
    expect(p09).toContain('formatHookCoverage')
    expect(p09).toContain('format_rewrite 执行')
    expect(p09).toContain('场景资产只能按 assetInheritanceDecision 执行')
    expect(p09).toContain('resultAction 必须对应 taskGoal')
    expect(p09).toContain('最终提示词表层清洁')
    expect(p09).toContain('不得用“不得出现 X / 不得写 X / 不要出现 X”的否定句')
    expect(p09).toContain('具体原素材禁项只允许出现在 semanticPreservation.forbiddenSurfaceAvoided')
    expect(p09).toContain('是否逐字落实由本地 finalizeP09Generation() 审计决定')
    expect(p09).toContain('最终广告终点必须是 socialPayoff')
    expect(p09).toContain('socialPayoffBeat')
    expect(p09).toContain('productionPrompt')
    expect(p09).toContain('用户原始输入')
    expect(p09).toContain('原语言口令')
    expect(p09).toContain('creativeContract / rewritePlan 是权威主路径')
  })

  it('keeps understanding depth ahead of internal risk sanitization', () => {
    const runtimeSteps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
      'hard',
      completeRuntimeResults(),
    )
    const draftSteps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
    )

    const p02 = draftSteps.find((step) => step.id === 'P02')?.prompt ?? ''
    const p05 = draftSteps.find((step) => step.id === 'P05')?.prompt ?? ''
    const p09 = runtimeSteps.find((step) => step.id === 'P09')?.prompt ?? ''

    expect(p02).toContain('P02 是内部理解稿')
    expect(p02).toContain('真实创意含义讲透')
    expect(p02).toContain('不得提前消毒、弱化、泛化或广告化')
    expect(p02).toContain('疑似 / 暗示 / 支持 / 不能证明')
    expect(p02).toContain('riskAnnotations 是理解层 annotation')
    expect(p05).toContain('P05 仍属于内部理解层')
    expect(p05).toContain('不得为了“安全”把核心解释降级')
    expect(p05).toContain('不得反向污染 P05 对原素材核心机制的理解')
    expect(p09).toContain('P09 是最终对外安全化发生的位置')
    expect(p09).toContain('上游 P02/P05 的内部理解不得在这里被重写')
  })

  it('caps generated videos at 15 seconds without imposing a default duration', () => {
    const steps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
    )
    const p07 = steps.find((step) => step.id === 'P07')?.prompt ?? ''
    const p09 = steps.find((step) => step.id === 'P09')?.prompt ?? ''

    expect(GENERATED_VIDEO_MAX_DURATION_SEC).toBe(15)
    expect(p07).toContain('成片不超过 15 秒')
    expect(p09).toContain('durationSec 必须 > 0 且 ≤ 15')
    expect(p09).toContain('不设默认时长')
    expect(p09).toContain('不得为了凑满 15 秒拖长节奏')
    expect(p09).not.toContain('默认 12')
    expect(p09).not.toContain('≤ 12')
  })

  it('hard-blocks P08-P11 when the selected P07 plan fails', () => {
    const results = completeRuntimeResults()
    results.p07 = {
      ...results.p07!,
      softPlan: {
        canUse: false,
        fallbackTo: 'hard',
        fallbackReason: 'RUNTIME_SOFT_FAILURE',
      },
    }
    const steps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
      'soft',
      results,
    )

    expect(steps.find((step) => step.id === 'P07')?.active).toBe(true)
    for (const id of ['P08', 'P09', 'P10', 'P11'] as const) {
      const step = steps.find((candidate) => candidate.id === id)
      expect(step?.active).toBe(false)
      expect(step?.skippedReason).toContain('P07 softPlan 不可用')
    }
  })

  it('does not activate P09 from P02 or a stored breakdown when runtime contracts are missing', () => {
    const steps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
    )
    expect(steps.find((step) => step.id === 'P06')?.active).toBe(false)
    expect(steps.find((step) => step.id === 'P09')?.active).toBe(false)
    expect(steps.find((step) => step.id === 'P09')?.skippedReason).toContain(
      '本次运行时 P05 合同',
    )
  })

  it('deterministically rejects missing tokens, forbidden surfaces and failed capability gates', () => {
    const results = completeRuntimeResults()
    const candidate = {
      feature: 'translator' as const,
      providerPromptText:
        'SURFACE_TOKEN QUALIFIER_TOKEN VISIBLE_REALIZATION',
      candidatePrompt: 'SURFACE_TOKEN QUALIFIER_TOKEN VISIBLE_REALIZATION',
      coreCoverage: [
        {
          coreId: 'C1',
          status: 'qualified' as const,
          realization: 'VISIBLE_REALIZATION',
          realizationChannels: ['visible' as const],
        },
      ],
    }
    expect(auditP09CoreRetention(results, candidate)).toEqual({
      passed: true,
      failures: [],
    })
    expect(finalizeP09Generation(results, candidate)).toEqual({
      productionReady: true,
      finalPrompt: candidate.candidatePrompt,
      auditFailures: [],
    })

    const missingQualifier = auditP09CoreRetention(results, {
      ...candidate,
      providerPromptText:
        'SURFACE_TOKEN VISIBLE_REALIZATION FORBIDDEN_SURFACE',
      candidatePrompt: 'SURFACE_TOKEN VISIBLE_REALIZATION FORBIDDEN_SURFACE',
    })
    expect(missingQualifier.passed).toBe(false)
    expect(missingQualifier.failures.join('\n')).toContain('requiredQualifierToken')
    expect(missingQualifier.failures.join('\n')).toContain('禁止表面形式')
    expect(
      finalizeP09Generation(results, {
        ...candidate,
        providerPromptText:
          'SURFACE_TOKEN VISIBLE_REALIZATION FORBIDDEN_SURFACE',
        candidatePrompt: 'SURFACE_TOKEN VISIBLE_REALIZATION FORBIDDEN_SURFACE',
      }).finalPrompt,
    ).toBe('')

    const detachedQualifier = auditP09CoreRetention(results, {
      ...candidate,
      providerPromptText:
        'SURFACE_TOKEN VISIBLE_REALIZATION。QUALIFIER_TOKEN 单独出现。',
      candidatePrompt:
        'SURFACE_TOKEN VISIBLE_REALIZATION。QUALIFIER_TOKEN 单独出现。',
    })
    expect(detachedQualifier.failures.join('\n')).toContain('同语境限定')

    const mismatchedCandidate = auditP09CoreRetention(results, {
      ...candidate,
      candidatePrompt:
        'SURFACE_TOKEN QUALIFIER_TOKEN VISIBLE_REALIZATION EXTRA',
    })
    expect(mismatchedCandidate.failures.join('\n')).toContain(
      '必须逐字等于 providerPrompt.promptText',
    )

    const omittedMustKeep = auditP09CoreRetention(results, {
      ...candidate,
      coreCoverage: [
        {
          ...candidate.coreCoverage[0],
          status: 'omitted',
        },
      ],
    })
    expect(omittedMustKeep.failures.join('\n')).toContain('must_keep')

    results.p06!.productCapabilityGate = {
      ...results.p06!.productCapabilityGate!,
      status: 'unverified',
      verifiedCapabilities: [],
      unverifiedCapabilities: ['UNVERIFIED_CAPABILITY'],
      coreResolutionRole: 'forbidden',
    }
    expect(auditP09CoreRetention(results, candidate).failures.join('\n')).toContain(
      '产品能力门禁未通过',
    )
  })

  it('rejects risk contracts that transform exact required tokens', () => {
    const results = completeRuntimeResults()
    results.p06!.riskTransformationContract!.requiredTransformations = [
      {
        coreId: 'C1',
        originalExpression: 'SURFACE_TOKEN',
        safeTransformation: 'REPLACEMENT_TOKEN',
        mustPreserve: 'RUNTIME_CORE_ELEMENT',
      },
    ]
    const steps = buildPromptChain(
      item({ mediaKind: 'video' }),
      breakdown(),
      'hard',
      results,
    )
    expect(steps.find((step) => step.id === 'P07')?.active).toBe(false)
    expect(steps.find((step) => step.id === 'P09')?.skippedReason).toContain(
      '风险合同不得清空或转换必保留 token',
    )
  })
})
