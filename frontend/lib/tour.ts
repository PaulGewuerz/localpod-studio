import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'

// New-user product tour. Walks first-time publishers through the core flow:
// create an episode → review/approve → publish to their feed. Steps are anchored
// to `data-tour="…"` attributes in the studio dashboard so they survive restyling.

let active: Driver | null = null

export function startTour(onFinish?: () => void) {
  // Guard against double-launch (e.g. effect re-run + manual click).
  if (active) return

  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    active = null
    onFinish?.()
  }

  active = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.6,
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Get started',
    popoverClass: 'lp-tour',
    // Fires whether the user finishes, skips, or presses Esc — so we only ever
    // show the tour once.
    onDestroyed: done,
    steps: [
      {
        popover: {
          title: 'Welcome to LocalPod Studio 👋',
          description:
            'Turn your articles into AI-narrated podcast episodes in minutes. Here’s a quick 60-second tour of the basics.',
        },
      },
      {
        element: '[data-tour="nav-new"]',
        popover: {
          title: '1. Create an episode',
          description:
            'Paste an article (or a PDF), pick a voice, and we generate the audio for you. You can also upload your own audio instead.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="nav-episodes"]',
        popover: {
          title: '2. Review & approve',
          description:
            'New episodes start as a <b>draft</b>. Open one to review the script and audio, then <b>approve</b> it. Drafts show a badge here.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="nav-dist"]',
        popover: {
          title: '3. Get listed on Apple, Spotify & more',
          description:
            'Approved episodes go <b>live</b> on your show’s RSS feed instantly. To appear in the big apps, that feed has to be submitted to each one — submit it yourself from here, or have us do it for you.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="nav-analytics"]',
        popover: {
          title: 'Track your audience',
          description: 'Once episodes are live, watch downloads and per-episode performance here.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="help"]',
        popover: {
          title: 'Need this again?',
          description: 'Replay this tour anytime from the “?” button up here. Happy publishing!',
          side: 'bottom',
          align: 'end',
        },
      },
    ],
  })

  active.drive()
}
