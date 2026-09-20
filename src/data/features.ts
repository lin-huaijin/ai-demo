import type { IntentFeature } from '../types'

export type ProofMode = 'functional_proof' | 'social_proof' | 'mixed'
export type FeatureRole =
  | 'core_solution'
  | 'assistive_trigger'
  | 'background_affordance'
export type PrimaryPromise =
  | 'cross_language_connection'
  | 'confident_expression'
  | 'live_understanding'
  | 'face_to_face_connection'
  | 'group_belonging'
  | 'lighter_social_chat'
  | 'ai_supported_connection'
export type CapabilityCluster =
  | 'basic_im'
  | 'chat_translation'
  | 'ai_buddy'
  | 'live_caption'
  | 'translator'
  | 'image_translation'
  | 'face_to_face'
  | 'social_growth'
  | 'trust_safety'

export interface ShortsCapabilityCluster {
  cluster: CapabilityCluster
  name: string
  capabilities: string[]
  adUseCases: string[]
  boundaries: string[]
}

export interface ShortsFeatureSpec {
  feature: IntentFeature
  label: string
  capabilityVerification: 'verified_repository_spec'
  primaryPromise: PrimaryPromise
  proofMode: ProofMode
  featureRole: FeatureRole
  relationshipOutcomes: string[]
  socialPayoff: string
  capabilityClusters: ShortsCapabilityCluster[]
  whatItIs: string
  heroMoment: string
  onScreenUi: string
  showcaseAnchors: string[]
  languageNote: string
  negatives: string[]
  navHint: string
  proofDurationHint: string
  hardBoundaries: string[]
  forbiddenClaims: string[]
}

export const FEATURE_LABELS: Record<IntentFeature, string> = {
  chat: 'Chat / AI Buddy',
  'live-caption': 'Live Caption',
  translator: 'Translator',
  f2f: 'Face to face',
  'group-tutorial': 'Group growth',
}

export const SHORTS_FEATURE_SPECS: Record<IntentFeature, ShortsFeatureSpec> = {
  chat: {
    feature: 'chat',
    label: 'Chat / AI Buddy',
    capabilityVerification: 'verified_repository_spec',
    primaryPromise: 'ai_supported_connection',
    proofMode: 'mixed',
    featureRole: 'core_solution',
    relationshipOutcomes: [
      'The user keeps the conversation going after language or wording friction.',
      'The other person can understand the user without the user leaving the chat.',
      'AI help reduces pressure before sending a message.',
    ],
    socialPayoff:
      'Demo App makes one-to-one or group conversation easier, warmer, and less blocked by language or expression anxiety.',
    capabilityClusters: [
      {
        cluster: 'basic_im',
        name: 'Basic messenger',
        capabilities: [
          '1:1 and group chat threads',
          'message requests, unread states, pinned or saved conversations when relevant',
          'contact notes, reactions, stickers, and lightweight reply moments',
        ],
        adUseCases: [
          'show a conversation restarting',
          'show a shy user replying with less pressure',
          'show social warmth through replies, reactions, or stickers',
        ],
        boundaries: [
          'Do not imply automatic friendship, automatic consent, or guaranteed romantic success.',
          'Do not make basic IM features the whole ad when a stronger social payoff is available.',
        ],
      },
      {
        cluster: 'chat_translation',
        name: 'In-chat translation',
        capabilities: [
          'original and translated message bubbles in the same thread',
          'Show Original / Show Translated display states',
          'Translation Detail for checking meaning',
          'voice message transcript plus voice-to-text translation when the source is voice',
        ],
        adUseCases: [
          'a foreign-language message becomes readable inside the chat',
          'the user checks translation detail before replying',
          'a voice note becomes understandable without leaving the thread',
        ],
        boundaries: [
          'Translation may be imperfect or delayed; never promise 100% accuracy.',
          'Keep original and translated text short and legible.',
        ],
      },
      {
        cluster: 'ai_buddy',
        name: 'AI Buddy',
        capabilities: [
          'helps draft, polish, explain, or suggest a response inside a social conversation context',
          'can support low-pressure expression when the user does not know what to say',
          'can assist with public-web or general knowledge questions when framed as help, not truth guarantee',
        ],
        adUseCases: [
          'a user turns awkward silence into a natural reply',
          'AI helps explain a cultural phrase before the user responds',
          'AI rewrites a stiff message into a friendly one',
        ],
        boundaries: [
          'AI output can be wrong and should be checked by the user.',
          'Do not imply private-data access, transactions, bookings, or real-time inventory.',
          'Do not present AI Buddy as a generic productivity chatbot detached from social connection.',
        ],
      },
    ],
    whatItIs:
      'Demo App Chat is the messenger surface for 1:1 and group conversations. It can show original and translated messages, translation details, voice-message transcripts, and AI Buddy assistance when the user needs help understanding or replying.',
    heroMoment:
      'A message, voice note, or awkward reply moment creates social friction; Demo App resolves the meaning or wording inside the same thread, and the user continues the conversation.',
    onScreenUi:
      'Phone chat thread with original and translated bubbles, Show Translated / Show Original / Translation Detail when relevant, and AI Buddy suggestion with Apply / Undo only when writing help is relevant.',
    showcaseAnchors: [
      'message translation in thread',
      'Translation Detail',
      'voice message transcript and translation',
      'AI Buddy reply suggestion',
      'Apply / Undo suggestion',
      'reaction or sticker response',
      'message request, unread, pinned, or contact note as background proof',
    ],
    languageNote:
      'Show the original message in one language and its translation or AI-assisted reply in the reader language; keep both short and legible.',
    negatives: [
      'garbled text',
      'mismatched glyphs',
      'generic dating coach',
      'guaranteed reply or match',
      'AI making unverified claims',
    ],
    navHint:
      'Reached from the Chat tab by opening a conversation; translation or AI help happens inside the existing chat thread.',
    proofDurationHint:
      'Reserve at least 3 seconds for message friction, product proof, and the continued social response.',
    hardBoundaries: [
      'AI Buddy and translation support the user but do not guarantee correctness or outcomes.',
      'Do not claim automatic friend acceptance, romance, or private-data access.',
    ],
    forbiddenClaims: [
      '100% accurate translation',
      'guaranteed match or reply',
      'AI knows private user data',
      'automatic friendship',
    ],
  },
  'live-caption': {
    feature: 'live-caption',
    label: 'Live Caption',
    capabilityVerification: 'verified_repository_spec',
    primaryPromise: 'live_understanding',
    proofMode: 'functional_proof',
    featureRole: 'core_solution',
    relationshipOutcomes: [
      'The user understands live speech quickly enough to stay included.',
      'A call, meeting, lecture, stream, or in-person speech stops feeling isolating.',
      'The user can respond or participate after captions make meaning visible.',
    ],
    socialPayoff:
      'Demo App helps users stay present in live conversations instead of being pushed out by language speed.',
    capabilityClusters: [
      {
        cluster: 'live_caption',
        name: 'Live caption and call caption',
        capabilities: [
          'live speech transcription',
          'AI translation into the selected target language',
          'caption cards or caption lane that updates while speech continues',
          'call-caption style menu or live caption state when relevant',
          'AI summary, history, copy, or forward as supporting proof after the live moment',
        ],
        adUseCases: [
          'understanding a call while the other person is still talking',
          'following a lecture, event, stream, or meeting',
          'saving or forwarding a short translated summary after the moment',
        ],
        boundaries: [
          'Captions may be delayed or imperfect; do not promise real-time perfection.',
          'Summary/history/copy/forward are supporting actions, not the core live proof.',
        ],
      },
    ],
    whatItIs:
      'Demo App Live Caption transcribes speech and translates it to the selected target language during live speech or calls, with optional summary or history actions after the caption proof.',
    heroMoment:
      'Someone speaks in a language the protagonist cannot follow; the caption lane updates with short translated lines while the speaker is still talking, and the protagonist shifts from lost to included.',
    onScreenUi:
      'Live Caption screen or caption popup with target-language selector and an existing caption-card lane that keeps filling with short translated lines; optional summary/history/copy/forward can appear after the live proof.',
    showcaseAnchors: [
      'Live Caption entry in Translate tab',
      'AI translating to target language',
      'active caption cards',
      'voice-call caption menu: Turn On / AI Translate',
      'caption history or AI summary after the moment',
    ],
    languageNote:
      'Speech source language differs from the protagonist language; captions translate into the protagonist or viewer language.',
    negatives: [
      'frozen caption card',
      'flickering text',
      'garbled text',
      'extra panels outside the caption lane',
      'perfect-accuracy promise',
    ],
    navHint:
      'Reached from the Translate tab or caption entry, then using the Live Caption screen or call caption state.',
    proofDurationHint:
      'Reserve at least 3-4 seconds for live speech, caption update, and comprehension reaction.',
    hardBoundaries: [
      'Do not claim captions are instant in every condition.',
      'Do not replace live proof with only a static summary screen.',
    ],
    forbiddenClaims: [
      'zero latency',
      '100% accurate captions',
      'works perfectly in every noisy scene',
    ],
  },
  translator: {
    feature: 'translator',
    label: 'Translator',
    capabilityVerification: 'verified_repository_spec',
    primaryPromise: 'cross_language_connection',
    proofMode: 'functional_proof',
    featureRole: 'core_solution',
    relationshipOutcomes: [
      'The user turns a text, spoken line, or image into understandable language.',
      'A practical interaction continues after a menu, sign, message, or spoken line becomes clear.',
      'The user gains enough confidence to respond or act in the moment.',
    ],
    socialPayoff:
      'Demo App turns translation into a bridge for continuing a real-world interaction, not a standalone utility demo.',
    capabilityClusters: [
      {
        cluster: 'translator',
        name: 'Text and speech translator',
        capabilities: [
          'type or paste a short sentence',
          'use mic input for a spoken line',
          'source and target language selectors',
          'swap languages',
          'translated result card',
          'playback of the translated result when the situation needs spoken output',
        ],
        adUseCases: [
          'translate a line before speaking to someone',
          'paste a message and understand what to reply',
          'turn a spoken phrase into a usable target-language line',
        ],
        boundaries: [
          'Do not imply legal, medical, or high-stakes certified translation.',
          'Do not imply voice clone unless separately verified for this release.',
        ],
      },
      {
        cluster: 'image_translation',
        name: 'Image translation',
        capabilities: [
          'translate readable text in an image',
          'help understand a sign, menu, notice, or screenshot',
          'show image text becoming target-language meaning',
        ],
        adUseCases: [
          'menu or sign becomes understandable before ordering or moving',
          'screenshot text becomes clear enough to reply',
          'travel or shopping decision becomes easier after image text is translated',
        ],
        boundaries: [
          'Only use for still images or readable image text.',
          'Do not claim batch document translation or full video translation.',
        ],
      },
    ],
    whatItIs:
      'Demo App Translator is a standalone translation surface for typed, pasted, spoken, or image-text input, with source and target selectors and a translated result card.',
    heroMoment:
      'The source input appears, the translated result visibly lands in the target card, and the user uses that result to keep a conversation or real-world interaction moving.',
    onScreenUi:
      'Translator screen with source input card, translated result card, From/To language selectors, swap, mic or paste action, and optional playback when spoken output is needed.',
    showcaseAnchors: [
      'Translator card in Translate tab',
      'From / To language selectors',
      'paste, type, or mic input',
      'image text translation',
      'translated result card',
      'play translated result',
    ],
    languageNote:
      'Source and target languages must be visibly distinct; use short, legible text and clear before/after states.',
    negatives: [
      'pre-filled static translation',
      'garbled text',
      'mismatched glyphs',
      'voice clone claim',
      'batch document claim',
    ],
    navHint:
      'Reached from the Translate tab by opening Translator, then using the source and target cards.',
    proofDurationHint:
      'Reserve at least 3 seconds for source input, translation resolve, and the user action enabled by the result.',
    hardBoundaries: [
      'Translation may be imperfect and should not be positioned as certified.',
      'Image translation applies to readable still-image text, not full video or batch files.',
    ],
    forbiddenClaims: [
      'voice clone',
      'certified translation',
      'batch document translation',
      'translate any video instantly',
      '100% accurate',
    ],
  },
  f2f: {
    feature: 'f2f',
    label: 'Face to face',
    capabilityVerification: 'verified_repository_spec',
    primaryPromise: 'face_to_face_connection',
    proofMode: 'functional_proof',
    featureRole: 'core_solution',
    relationshipOutcomes: [
      'Two people in the same place can take turns and understand each other.',
      'A local service, travel, date, event, or help-seeking interaction continues naturally.',
      'The user stops relying on gestures alone and gets a clear next reply.',
    ],
    socialPayoff:
      'Demo App makes in-person cross-language exchange feel less awkward and more human.',
    capabilityClusters: [
      {
        cluster: 'face_to_face',
        name: 'Face to Face conversation',
        capabilities: [
          'two stacked speaker cards facing opposite directions',
          'language selectors for both speakers',
          'mic controls for turn-taking',
          'translated reply visible to the other person',
          'optional translated playback',
        ],
        adUseCases: [
          'ordering, asking directions, checking in, or meeting someone across languages',
          'turning gesture-only confusion into a spoken exchange',
          'showing both speakers reacting to understanding',
        ],
        boundaries: [
          'Do not imply the app speaks for both people without user action.',
          'Do not present a static pre-filled card as proof.',
        ],
      },
    ],
    whatItIs:
      'Demo App Face to Face lets two people talk across languages on one phone with two stacked speaking cards, language selectors, mic controls, and translation playback.',
    heroMoment:
      'One person speaks into the mic; their source line appears on their card, then the opposite card, oriented toward the partner, fills with the translated reply as the partner reads it.',
    onScreenUi:
      'Phone flat on a table or held between two people, showing two stacked cards facing opposite directions, language selectors, swap button, Tap the mic to speak, and optional playback.',
    showcaseAnchors: [
      'Face to Face card in Translate tab',
      'Tap the mic to speak',
      'two stacked speaker cards',
      'top and bottom language selectors',
      'language swap button',
      'translated reply playback',
    ],
    languageNote:
      'Each person speaks their own language; the opposite panel shows the translation oriented for the other person.',
    negatives: [
      'duplicated panels',
      'warped text',
      'pre-filled static cards',
      'nobody actively speaking',
      'automatic conversation without user action',
    ],
    navHint:
      'Reached from the Translate tab by tapping Face to Face, then using the two-card screen.',
    proofDurationHint:
      'Reserve at least 3-4 seconds for speak, translate, partner read, and response.',
    hardBoundaries: [
      'Must show turn-taking or an active speaking moment.',
      'Do not imply guaranteed agreement or instant relationship success.',
    ],
    forbiddenClaims: [
      'automatic conversation',
      'guaranteed agreement',
      'perfect translation',
    ],
  },
  'group-tutorial': {
    feature: 'group-tutorial',
    label: 'Group growth',
    capabilityVerification: 'verified_repository_spec',
    primaryPromise: 'group_belonging',
    proofMode: 'social_proof',
    featureRole: 'assistive_trigger',
    relationshipOutcomes: [
      'A user discovers, joins, invites, or manages a group with less friction.',
      'People with shared interests find a lightweight way to connect.',
      'Group tools create belonging, participation, and safer social flow.',
    ],
    socialPayoff:
      'Demo App helps users turn interest into group belonging and ongoing social interaction.',
    capabilityClusters: [
      {
        cluster: 'social_growth',
        name: 'Group discovery and invitation',
        capabilities: [
          'group chat and multilingual group conversation',
          'group QR or invite link/card',
          'personal QR or profile-share path',
          'Direct Tag or group keyword as a way to route people to a topic or group',
          'invite cards and share personalization',
        ],
        adUseCases: [
          'fans or hobby users find a group after seeing a topic cue',
          'a creator or user invites people into a shared-interest chat',
          'a user moves from browsing alone to participating in a group',
        ],
        boundaries: [
          'QR, invite, or Direct Tag opens a profile/apply/invite flow; it does not auto-add friends or auto-join a group.',
          'Social growth often works as a background affordance; do not force a heavy functional demo when the story is about belonging.',
        ],
      },
      {
        cluster: 'trust_safety',
        name: 'Group management and trust',
        capabilities: [
          'group admin and moderation controls',
          'permissions and joining rules',
          'reporting or safety tools as supporting background proof',
          'official badge as account identity proof when relevant',
        ],
        adUseCases: [
          'a group feels manageable and safer for newcomers',
          'an official account or community feels easier to trust',
          'reporting or permissions protect the group flow without becoming the whole story',
        ],
        boundaries: [
          'Reports do not automatically punish users.',
          'Official Badge verifies account identity only, not every piece of content, event, or group claim.',
        ],
      },
    ],
    whatItIs:
      'Demo App Group growth covers group chat, multilingual group participation, group discovery, invitations, Direct Tag or keyword routing, QR/share flows, and group trust tools that help people connect around shared interests.',
    heroMoment:
      'A user sees a topic, invite, QR, or group conversation cue; joining or participating becomes easy enough that the user moves from interest to actual interaction.',
    onScreenUi:
      'Group chat thread, group invite card, Tap to join / Join Group flow, QR or share card, Direct Tag or topic keyword cue, and lightweight admin/trust affordances when the story needs safety proof.',
    showcaseAnchors: [
      'New Group Chat',
      'Group Invite card',
      'Tap to join / Join Group',
      'invite link or QR invite',
      'Direct Tag or group keyword',
      'personal QR or profile share',
      'multilingual group messages resolving for the reader',
      'admin, permission, report, or Official Badge as support proof',
    ],
    languageNote:
      'If multilingual group chat is shown, members post in different languages and the reader sees each message translated into their own language.',
    negatives: [
      'static pre-filled group thread',
      'invite card without social action',
      'garbled text',
      'mismatched glyphs',
      'auto-join or auto-add claim',
      'guaranteed safe community',
    ],
    navHint:
      'Reached from Chat, group discovery, invite, profile share, Direct Tag, or topic keyword flow depending on the chosen social-growth proof.',
    proofDurationHint:
      'Reserve at least 3 seconds for discovery or invitation, user action, and visible group response or participation.',
    hardBoundaries: [
      'Do not claim automatic joining, automatic friend adding, or guaranteed community quality.',
      'Trust and safety affordances support the story but do not guarantee punishment or full verification.',
    ],
    forbiddenClaims: [
      'auto-join',
      'auto-add friends',
      'guaranteed safe community',
      'official badge verifies all content',
      'reports automatically punish',
    ],
  },
}

export function featureSpecPromptBlock(): string {
  return Object.values(SHORTS_FEATURE_SPECS)
    .map((spec) => {
      const clusters = spec.capabilityClusters
        .map(
          (cluster) =>
            [
              `    - ${cluster.cluster} (${cluster.name})`,
              `      capabilities: ${cluster.capabilities.join('; ')}`,
              `      ad_use_cases: ${cluster.adUseCases.join('; ')}`,
              `      boundaries: ${cluster.boundaries.join('; ')}`,
            ].join('\n'),
        )
        .join('\n')

      return [
        `- ${spec.feature} (${spec.label})`,
        `  capability_verification: ${spec.capabilityVerification}`,
        `  primary_promise: ${spec.primaryPromise}`,
        `  proof_mode: ${spec.proofMode}`,
        `  feature_role: ${spec.featureRole}`,
        `  relationship_outcomes: ${spec.relationshipOutcomes.join('; ')}`,
        `  social_payoff: ${spec.socialPayoff}`,
        `  capability_clusters:`,
        clusters,
        `  what_it_is: ${spec.whatItIs}`,
        `  hero_moment: ${spec.heroMoment}`,
        `  on_screen_ui: ${spec.onScreenUi}`,
        `  showcase_anchors: ${spec.showcaseAnchors.join('; ')}`,
        `  language_note: ${spec.languageNote}`,
        `  negatives: ${spec.negatives.join('; ')}`,
        `  nav_hint: ${spec.navHint}`,
        `  proof_duration: ${spec.proofDurationHint}`,
        `  hard_boundaries: ${spec.hardBoundaries.join('; ')}`,
        `  forbidden_claims: ${spec.forbiddenClaims.join('; ')}`,
      ].join('\n')
    })
    .join('\n')
}
