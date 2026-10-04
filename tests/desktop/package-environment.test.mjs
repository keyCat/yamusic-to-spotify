import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { buildDesktopPackageEnvironment } from '../../scripts/desktop-package-environment.mjs'

const require = createRequire(import.meta.url)
require('app-builder-lib')
const { PlatformPackager } = require('app-builder-lib/out/platformPackager.js')

describe('desktop packaging environment', () => {
  it('removes empty GitHub signing secrets so the packager cannot import the project directory as a certificate', () => {
    const inheritedEnvironment = {
      PATH: '/tools', CSC_LINK: '', CSC_KEY_PASSWORD: '', WIN_CSC_LINK: '', WIN_CSC_KEY_PASSWORD: '',
      APPLE_ID: '', APPLE_APP_SPECIFIC_PASSWORD: '', APPLE_TEAM_ID: '',
    }
    const environment = buildDesktopPackageEnvironment(inheritedEnvironment)
    const packager = { info: { config: {} }, platformSpecificBuildOptions: {} }
    // This uses the installed packager's certificate resolution, which distinguishes '' from undefined.
    const getCertificateLink = PlatformPackager.prototype.getCscLink
    const originalEnvironment = process.env
    try {
      process.env = inheritedEnvironment
      expect(getCertificateLink.call(packager)).toBe('')
      process.env = environment
      expect(getCertificateLink.call(packager)).toBeUndefined()
      expect(getCertificateLink.call(packager, 'WIN_CSC_LINK')).toBeUndefined()
    } finally { process.env = originalEnvironment }
    expect(environment).toEqual({ PATH: '/tools' })
    expect(inheritedEnvironment.CSC_LINK).toBe('')
  })

  it('preserves configured signing values, passwords and other packaging options exactly', () => {
    const environment = {
      CSC_LINK: '/certificates/signing.p12', CSC_KEY_PASSWORD: ' password with spaces ',
      WIN_CSC_LINK: '/certificates/windows.pfx', WIN_CSC_KEY_PASSWORD: 'windows-password',
      APPLE_ID: 'developer@example.test', APPLE_APP_SPECIFIC_PASSWORD: 'app-password', APPLE_TEAM_ID: 'TEAM123',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false', DESKTOP_TARGET_ARCH: 'arm64', OTHER_EMPTY_OPTION: '',
    }
    expect(buildDesktopPackageEnvironment(environment)).toEqual(environment)
  })
})
