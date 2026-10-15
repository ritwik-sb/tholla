import type { VoiceCharacter } from '../lib/voices'

interface Props {
  voice: VoiceCharacter
  size?: number
  talking?: boolean
  className?: string
}

const CAP = 'M15.5 33 Q15 15.5 32 15.5 Q49 15.5 48.5 33 Q45 23.5 32 23.5 Q19 23.5 15.5 33Z'

function HairBack({ v }: { v: VoiceCharacter }) {
  if (v.style === 'long') return <path d="M13.5 34 Q12 15 32 14.5 Q52 15 50.5 34 L52 55 Q32 59 12 55Z" fill={v.hair} />
  if (v.style === 'bob') return <path d="M14 34 Q13 15 32 14.5 Q51 15 50 34 L50.5 46 Q32 50 13.5 46Z" fill={v.hair} />
  return null
}

function HairFront({ v }: { v: VoiceCharacter }) {
  switch (v.style) {
    case 'short':
      return <path d={CAP} fill={v.hair} />
    case 'spiky':
      return <path d="M15.5 32 L17 18 L22.5 22.5 L26 13 L31.5 20 L37 12 L41 21 L46.5 16 L48.5 32 Q44 24 32 24 Q20 24 15.5 32Z" fill={v.hair} />
    case 'long':
    case 'bob':
      return <path d="M15.5 34 Q15 15.5 32 15.5 Q49 15.5 48.5 34 Q46 25 38 23 Q30 27 20 25 Q16.5 28 15.5 34Z" fill={v.hair} />
    case 'bun':
      return (
        <g fill={v.hair}>
          <circle cx="32" cy="12" r="6.5" />
          <path d={CAP} />
        </g>
      )
    case 'curly':
      return (
        <g fill={v.hair}>
          {[[17, 29], [19, 22], [25, 17.5], [32, 16], [39, 17.5], [45, 22], [47, 29]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="6" />
          ))}
        </g>
      )
    case 'bald':
      return (
        <g fill={v.hair}>
          <path d="M15.5 36 Q15.5 29 18 27 L19 34Z" />
          <path d="M48.5 36 Q48.5 29 46 27 L45 34Z" />
        </g>
      )
  }
}

function Ears({ v }: { v: VoiceCharacter }) {
  if (v.accessory === 'elf') {
    return (
      <g fill={v.skin}>
        <path d="M17 33 L8 26 L17.5 39Z" />
        <path d="M47 33 L56 26 L46.5 39Z" />
      </g>
    )
  }
  return (
    <g fill={v.skin}>
      <circle cx="16" cy="36" r="3" />
      <circle cx="48" cy="36" r="3" />
    </g>
  )
}

function AccessoryBehind({ v }: { v: VoiceCharacter }) {
  if (v.accessory === 'wolf') {
    return (
      <g fill={v.hair}>
        <path d="M16 24 L14 8 L26 18Z" />
        <path d="M48 24 L50 8 L38 18Z" />
        <path d="M17 20 L16.5 12 L22 17Z" fill="#fda4af" />
        <path d="M47 20 L47.5 12 L42 17Z" fill="#fda4af" />
      </g>
    )
  }
  return null
}

function AccessoryFront({ v }: { v: VoiceCharacter }) {
  switch (v.accessory) {
    case 'glasses':
      return (
        <g fill="none" stroke="#0f172a" strokeWidth="1.4">
          <circle cx="26" cy="34" r="4.3" />
          <circle cx="38" cy="34" r="4.3" />
          <path d="M30.3 34 H33.7" />
        </g>
      )
    case 'headphones':
      return (
        <g>
          <path d="M14 36 Q14 13 32 13 Q50 13 50 36" fill="none" stroke="#0f172a" strokeWidth="3" />
          <rect x="10.5" y="31" width="7" height="11" rx="3" fill="#0f172a" />
          <rect x="46.5" y="31" width="7" height="11" rx="3" fill="#0f172a" />
        </g>
      )
    case 'crown':
      return <path d="M23 18 L24 9 L28 14 L32 7 L36 14 L40 9 L41 18Z" fill="#facc15" stroke="#a16207" strokeWidth="0.8" />
    case 'tophat':
      return (
        <g fill="#0f172a">
          <rect x="22" y="4" width="20" height="15" rx="1.5" />
          <rect x="17" y="17.5" width="30" height="3.5" rx="1.5" />
          <rect x="22" y="14" width="20" height="3" fill="#b91c1c" />
        </g>
      )
    case 'bow':
      return (
        <g fill="#f472b6" stroke="#be185d" strokeWidth="0.6">
          <path d="M43 17 L37 13 L37 21Z" />
          <path d="M43 17 L49 13 L49 21Z" />
          <circle cx="43" cy="17" r="1.8" />
        </g>
      )
    case 'heart':
      return <path d="M44 22 C40 19 38 16 40.5 14 C42 13 43.5 14 44 15 C44.5 14 46 13 47.5 14 C50 16 48 19 44 22Z" fill="#fb7185" stroke="#be123c" strokeWidth="0.6" />
    case 'star':
      return <path d="M44 11 L45.5 15 L49.5 15.3 L46.4 17.8 L47.5 21.7 L44 19.4 L40.5 21.7 L41.6 17.8 L38.5 15.3 L42.5 15Z" fill="#fde047" stroke="#ca8a04" strokeWidth="0.6" />
    case 'santa':
      return (
        <g>
          <path d="M15 25 Q24 4 44 9 Q50 11 52 18 L49 25Z" fill="#dc2626" />
          <circle cx="52" cy="19" r="3.5" fill="#f8fafc" />
          <rect x="13.5" y="22.5" width="37" height="6" rx="3" fill="#f8fafc" />
        </g>
      )
    default:
      return null
  }
}

function Beard({ v }: { v: VoiceCharacter }) {
  if (v.accessory !== 'beard' && v.accessory !== 'santa') return null
  const color = v.accessory === 'santa' ? '#f8fafc' : v.hair
  return <path d="M17 37 Q18 56 32 56 Q46 56 47 37 Q44 45 32 45.5 Q20 45 17 37Z" fill={color} />
}

export default function VoiceAvatar({ voice: v, size = 56, talking = false, className = '' }: Props) {
  // Stagger idle animations so characters don't blink in sync.
  const delay = `${-(v.id.charCodeAt(3) % 7) * 0.53}s`
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className={`vc ${talking ? 'vc-talking' : ''} ${className}`}
      style={{ ['--vc-delay' as string]: delay }}
    >
      <defs>
        <clipPath id={`vc-clip-${v.id}`}><circle cx="32" cy="32" r="32" /></clipPath>
      </defs>
      <circle cx="32" cy="32" r="32" fill={v.bg} />
      <g clipPath={`url(#vc-clip-${v.id})`}>
        <g className="vc-bob">
          <path d="M14 64 Q16 50 32 50 Q48 50 50 64Z" fill="#0f172a" opacity="0.35" />
          <AccessoryBehind v={v} />
          <HairBack v={v} />
          <Ears v={v} />
          <circle cx="32" cy="35" r="16" fill={v.skin} />
          <HairFront v={v} />
          <g className="vc-eyes" fill="#0f172a">
            <ellipse cx="26" cy="34" rx="1.9" ry="2.4" />
            <ellipse cx="38" cy="34" rx="1.9" ry="2.4" />
          </g>
          <g fill="#fb7185" opacity="0.35">
            <circle cx="22" cy="39.5" r="2.4" />
            <circle cx="42" cy="39.5" r="2.4" />
          </g>
          <Beard v={v} />
          <ellipse className="vc-mouth" cx="32" cy="42.5" rx="3" ry="1.3" fill="#7f1d1d" />
          <AccessoryFront v={v} />
        </g>
      </g>
    </svg>
  )
}
