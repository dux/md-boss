// Which desktop the app is running on, and the one string that depends on it: the
// "Reveal" item in the menu bar and the in-window menus. The webview's user agent is the
// one honest answer the page has without a round trip, and the menu bar is built from
// the page (src/ui/appMenu.ts), so it reads the same one.

export type Platform = 'macos' | 'windows' | 'linux'

/** WKWebView says "Macintosh", WebView2 "Windows NT", WebKitGTK "X11; Linux" or
 *  "Wayland; Linux". Anything unrecognised is treated as Linux, the platform with the
 *  most generic label. */
export function platformFromUserAgent(userAgent: string): Platform {
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macos'
  if (/Windows/.test(userAgent)) return 'windows'
  return 'linux'
}

/** What the OS calls the thing that shows a file in its folder. */
export function revealLabel(platform: Platform): string {
  switch (platform) {
    case 'macos': return 'Reveal in Finder'
    case 'windows': return 'Show in Explorer'
    case 'linux': return 'Show in File Manager'
  }
}
