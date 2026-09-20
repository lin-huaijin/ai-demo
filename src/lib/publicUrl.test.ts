import { describe, expect, it } from 'vitest'
import { canonicalPublicHttpUrl } from './publicUrl'

describe('canonicalPublicHttpUrl', () => {
  it.each([
    'http://localhost/admin',
    'https://api.localhost/path',
    'http://127.0.0.1/private',
    'http://10.0.0.8/private',
    'http://172.16.0.1/private',
    'http://192.168.1.1/private',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/private',
    'http://[fc00::1]/private',
    'http://[fd12::8]/private',
    'http://[fe80::1]/private',
    'http://[::ffff:127.0.0.1]/private',
    'https://user:password@example.com/private',
  ])('rejects a non-public or credential-bearing URL: %s', (value) => {
    expect(canonicalPublicHttpUrl(value)).toBeUndefined()
  })

  it.each([
    ['https://example.com/research?q=video', 'https://example.com/research?q=video'],
    ['HTTP://8.8.8.8:80/dns', 'http://8.8.8.8/dns'],
    ['https://[2606:4700:4700::1111]/dns', 'https://[2606:4700:4700::1111]/dns'],
  ])('accepts and canonicalizes a public URL: %s', (value, canonical) => {
    expect(canonicalPublicHttpUrl(value)).toBe(canonical)
  })
})
