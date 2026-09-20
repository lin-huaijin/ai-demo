function ipv4Octets(hostname: string): number[] | undefined {
  const parts = hostname.split('.')
  if (parts.length !== 4) return undefined

  const octets = parts.map((part) => Number(part))
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index],
    )
  ) {
    return undefined
  }
  return octets
}

function isPublicIpv4(octets: number[]): boolean {
  const [first, second] = octets
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  )
}

function ipv6Groups(hostname: string): number[] | undefined {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host.includes(':') || host.includes('%')) return undefined

  const halves = host.split('::')
  if (halves.length > 2) return undefined
  const readHalf = (value: string) =>
    value
      ? value.split(':').map((part) =>
          /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN,
        )
      : []
  const left = readHalf(halves[0])
  const right = readHalf(halves[1] ?? '')
  if ([...left, ...right].some(Number.isNaN)) return undefined

  if (halves.length === 1) return left.length === 8 ? left : undefined
  const omitted = 8 - left.length - right.length
  if (omitted < 1) return undefined
  return [...left, ...Array<number>(omitted).fill(0), ...right]
}

function isPublicIpv6(groups: number[]): boolean {
  const [first] = groups
  const isUnspecified = groups.every((group) => group === 0)
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1
  const isUniqueLocal = (first & 0xfe00) === 0xfc00
  const isLinkLocal = (first & 0xffc0) === 0xfe80
  const isMulticast = (first & 0xff00) === 0xff00
  const isDocumentation = first === 0x2001 && groups[1] === 0x0db8
  if (
    isUnspecified ||
    isLoopback ||
    isUniqueLocal ||
    isLinkLocal ||
    isMulticast ||
    isDocumentation
  ) {
    return false
  }

  const mappedIpv4 =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  const compatibleIpv4 = groups.slice(0, 6).every((group) => group === 0)
  if (mappedIpv4 || compatibleIpv4) {
    return isPublicIpv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ])
  }
  return true
}

/**
 * Canonicalizes a visibly public HTTP(S) URL without DNS or network access.
 *
 * This browser/Node-safe guard rejects credentials and literal local/private
 * destinations. The server must still apply DNS-aware checks before fetching a
 * user-controlled URL because a public hostname can resolve to a private IP.
 */
export function canonicalPublicHttpUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    return undefined
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return undefined
  }

  const ipv4 = ipv4Octets(hostname)
  if (ipv4 && !isPublicIpv4(ipv4)) return undefined

  const ipv6 = ipv6Groups(hostname)
  if (ipv6 && !isPublicIpv6(ipv6)) return undefined

  return url.toString()
}
