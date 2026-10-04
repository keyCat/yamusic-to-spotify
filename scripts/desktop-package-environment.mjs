const optionalSigningVariables = new Set([
  'CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD',
  'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID',
])

export function buildDesktopPackageEnvironment(environment) {
  // Missing GitHub secrets become empty strings, which macOS treats as certificate paths.
  return Object.fromEntries(Object.entries(environment).filter(([name, value]) =>
    !optionalSigningVariables.has(name) || value !== '',
  ))
}
