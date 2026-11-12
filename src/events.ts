// Random office events that trigger periodically. Silent on purpose: they
// are office colour, not news (src/sounds.ts keeps sound for real events)

export interface RandomOfficeEvent {
  id: string
  name: string
  slackAnnouncement: string
  duration: number // ms
  type: 'all-move' | 'single-agent' | 'visual-only' | 'slack-only'
  targetPosition?: { x: number; y: number }
  agentMessages?: string[]
  managerMessage?: string
}

export const RANDOM_EVENTS: RandomOfficeEvent[] = [
  {
    id: 'fire-drill',
    name: 'Fire Drill',
    slackAnnouncement: '🚨 FIRE DRILL! Everyone to the exit!',
    duration: 6000,
    type: 'all-move',
    targetPosition: { x: 114, y: 105 },
    managerMessage: 'Fire drill! Move it!',
    agentMessages: ['not again...', 'I was in the zone!', 'my coffee!', 'save the codebase!'],
  },
  {
    id: 'pizza',
    name: 'Pizza Delivery',
    slackAnnouncement: '🍕 Pizza has arrived! Free lunch!',
    duration: 5000,
    type: 'all-move',
    targetPosition: { x: 114, y: 105 },
    managerMessage: 'Pizza in the lobby!',
    agentMessages: ['PIZZA!', 'finally some good news', 'pineapple?!', 'dibs on pepperoni'],
  },
  {
    id: 'standup',
    name: 'Daily Standup',
    slackAnnouncement: '📢 @here Daily standup starting now',
    duration: 7000,
    type: 'all-move',
    targetPosition: { x: 411, y: 417 },
    managerMessage: 'Standup! What did you ship?',
    agentMessages: ['worked on the thing', 'still debugging', 'blocked by review', 'deployed to staging', 'fixed 3 bugs, created 5'],
  },
  {
    id: 'deploy',
    name: 'Production Deploy',
    slackAnnouncement: '🚀 DEPLOYING TO PRODUCTION...',
    duration: 5000,
    type: 'slack-only',
    managerMessage: 'Hold your breath...',
    agentMessages: ['oh no', 'please dont break', 'I forgot to run tests', 'YOLO', 'checking rollback plan'],
  },
  {
    id: 'deploy-success',
    name: 'Deploy Success',
    slackAnnouncement: '✅ Deploy successful! All systems green 🎉',
    duration: 3000,
    type: 'slack-only',
    managerMessage: 'We did it!',
    agentMessages: ['lets go!', 'ship it!', 'nice work team', 'time for beer'],
  },
  {
    id: 'deploy-fail',
    name: 'Deploy Failed',
    slackAnnouncement: '💥 DEPLOY FAILED - ROLLING BACK',
    duration: 4000,
    type: 'slack-only',
    managerMessage: 'WHO PUSHED THAT?!',
    agentMessages: ['wasnt me', 'oh no oh no oh no', 'checking logs', 'its always DNS', 'reverting...'],
  },
  {
    id: 'power-flicker',
    name: 'Power Flicker',
    slackAnnouncement: '⚡ Power flickered - save your work!',
    duration: 3000,
    type: 'visual-only',
    agentMessages: ['did the lights just...', 'CTRL+S CTRL+S', 'my unsaved changes!', 'git commit NOW'],
  },
  {
    id: 'birthday',
    name: 'Birthday',
    slackAnnouncement: '🎂 Happy Birthday! Cake in the break room!',
    duration: 4000,
    type: 'all-move',
    targetPosition: { x: 287, y: 129 },
    managerMessage: 'Happy birthday!',
    agentMessages: ['cake!', 'happy birthday!', '🎉🎉🎉', 'is it gluten free?', 'make a wish'],
  },
  {
    id: 'who-broke-build',
    name: 'Build Broken',
    slackAnnouncement: '🔴 CI/CD pipeline is RED. Who broke the build?',
    duration: 5000,
    type: 'slack-only',
    managerMessage: 'Nobody leaves until this is fixed.',
    agentMessages: ['checking git blame...', 'not me', 'was it the merge?', 'flaky test maybe?', 'I blame the intern'],
  },
  {
    id: 'friday',
    name: 'Friday Vibes',
    slackAnnouncement: '🎉 It\'s Friday! Almost there team!',
    duration: 3000,
    type: 'slack-only',
    managerMessage: 'No deploys on Friday.',
    agentMessages: ['TGIF', 'pub?', 'one more PR...', 'leaving at 5 sharp', 'weekend!'],
  },
  {
    id: 'printer-jam',
    name: 'Printer Jam',
    slackAnnouncement: '🖨️ The printer is jammed again',
    duration: 4000,
    type: 'single-agent',
    targetPosition: { x: 424, y: 132 },
    agentMessages: ['why do we still have a printer', 'PC LOAD LETTER?!', 'who even prints things', 'its 2026...'],
  },
  {
    id: 'slack-down',
    name: 'Slack is Down',
    slackAnnouncement: '💀 Slack is down... wait how are we posting this',
    duration: 3000,
    type: 'slack-only',
    agentMessages: ['the irony', 'time to use email', 'carrier pigeon time', 'actually kind of peaceful'],
  },
]

// Office drama conversations
export const DRAMA_CONVERSATIONS = [
  {
    trigger: 'coffee-meet',
    messages: [
      { sender: 0, text: 'have you seen the new PR?' },
      { sender: 1, text: 'the 2000 line one? yeah...' },
      { sender: 0, text: 'no tests either' },
      { sender: 1, text: '💀' },
    ],
  },
  {
    trigger: 'who-pushed',
    messages: [
      { sender: 0, text: 'who pushed directly to main?' },
      { sender: 1, text: 'wasnt me' },
      { sender: 0, text: 'git blame says otherwise' },
      { sender: 1, text: '...' },
    ],
  },
  {
    trigger: 'tabs-vs-spaces',
    messages: [
      { sender: 0, text: 'tabs or spaces?' },
      { sender: 1, text: 'spaces obviously' },
      { sender: 0, text: 'blocked and reported' },
    ],
  },
  {
    trigger: 'meeting',
    messages: [
      { sender: 0, text: 'this meeting could have been a slack message' },
      { sender: 1, text: 'this slack message could have been silence' },
    ],
  },
  {
    trigger: 'framework',
    messages: [
      { sender: 0, text: 'we should rewrite in Rust' },
      { sender: 1, text: 'you say that every week' },
      { sender: 0, text: 'and Im right every week' },
    ],
  },
  {
    trigger: 'legacy',
    messages: [
      { sender: 0, text: 'found a TODO from 2019' },
      { sender: 1, text: 'what does it say' },
      { sender: 0, text: '"fix this later"' },
      { sender: 1, text: 'later is now' },
      { sender: 0, text: 'no. later is later.' },
    ],
  },
  {
    trigger: 'ai',
    messages: [
      { sender: 0, text: 'the AI wrote better code than me today' },
      { sender: 1, text: 'low bar tbf' },
      { sender: 0, text: 'rude but fair' },
    ],
  },
  {
    trigger: 'standup-excuse',
    messages: [
      { sender: 0, text: 'what did you do yesterday?' },
      { sender: 1, text: 'investigated a complex issue' },
      { sender: 0, text: 'you mean you googled for 6 hours' },
      { sender: 1, text: 'I prefer "research"' },
    ],
  },
]

// Slack reactions that randomly appear on messages
export const SLACK_REACTIONS = ['👍', '🔥', '💀', '😂', '🚀', '❤️', '👀', '💯', '🎉', '😅', '🤔', '⚡']

// Trading Floor themed events — used when the 'office' theme is active
export const OFFICE_EVENTS: RandomOfficeEvent[] = [
  {
    id: 'market-open',
    name: 'Market Open',
    slackAnnouncement: '🔔 London open — everyone to the screens',
    duration: 6000,
    type: 'all-move',
    targetPosition: { x: 114, y: 105 },
    managerMessage: 'spreads are wide for the first five minutes. hands off.',
    agentMessages: ['DAX gapping up', 'watching the 08:00 candle', 'no trades in the first five', 'volume is coming in'],
  },
  {
    id: 'news-spike',
    name: 'NFP Spike',
    slackAnnouncement: '📰 Non-farm payrolls in 60 seconds — EAs paused',
    duration: 5000,
    type: 'slack-only',
    managerMessage: 'news filter on. nobody opens anything.',
    agentMessages: ['300 pips in a minute', 'slippage everywhere', 'glad the news filter works', 'spread just went to 40'],
  },
  {
    id: 'new-high',
    name: 'Equity High',
    slackAnnouncement: '📈 New equity high on the demo account!',
    duration: 4000,
    type: 'slack-only',
    managerMessage: 'nice. now show me the drawdown.',
    agentMessages: ['green across the board', 'screenshot for the wall', 'profit factor 1.6', 'don\'t touch anything'],
  },
  {
    id: 'margin-call',
    name: 'Margin Call Drill',
    slackAnnouncement: '⚠️ Drill: what happens at 50% margin level?',
    duration: 3500,
    type: 'slack-only',
    managerMessage: 'walk me through the stop-out.',
    agentMessages: ['largest loser closes first', 'that\'s why we risk 1%', 'checking the free margin calc', 'never again'],
  },
  {
    id: 'optimiser-run',
    name: 'Optimiser Run',
    slackAnnouncement: '🧮 Genetic optimiser running — 10,000 passes',
    duration: 4000,
    type: 'visual-only',
    managerMessage: 'beware the curve fit.',
    agentMessages: ['pass 4,312 of 10,000', 'CPU at 100%', 'that one looks too good', 'forward test it'],
  },
  {
    id: 'backtest-done',
    name: 'Backtest Done',
    slackAnnouncement: '✅ 10-year backtest finished — every tick',
    duration: 3000,
    type: 'slack-only',
    agentMessages: ['modelling quality 99%', 'max drawdown 11%', 'Monte Carlo next', 'compare it to the baseline'],
  },
  {
    id: 'stop-hunt',
    name: 'Stop Hunt',
    slackAnnouncement: '🎯 Price wicked through the stops and reversed',
    duration: 4000,
    type: 'slack-only',
    managerMessage: 'this is why the stop goes past the swing low.',
    agentMessages: ['classic liquidity grab', 'stopped out by one pip', 'and now it runs to target', 'widen the buffer'],
  },
  {
    id: 'terminal-freeze',
    name: 'Terminal Freeze',
    slackAnnouncement: '🖥️ MT5 terminal is not responding. Again.',
    duration: 4000,
    type: 'single-agent',
    targetPosition: { x: 424, y: 132 },
    agentMessages: ['restarting the terminal', 'did the VPS reboot?', 'clearing the tester cache', 'logs say out of memory'],
  },
  {
    id: 'monthly-review',
    name: 'Monthly Review',
    slackAnnouncement: '📊 Monthly review — results on the big screen',
    duration: 4000,
    type: 'slack-only',
    managerMessage: 'what worked, what didn\'t, what changes.',
    agentMessages: ['win rate 54%', 'the Friday filter paid off', 'drawdown stayed under 8%', 'one rule change, not five'],
  },
  {
    id: 'green-month-pizza',
    name: 'Green Month Pizza',
    slackAnnouncement: '🍕 Green month — pizza is here!',
    duration: 5000,
    type: 'all-move',
    targetPosition: { x: 287, y: 129 },
    managerMessage: 'pizza for a green month. don\'t get used to it.',
    agentMessages: ['best day of the month', 'earned it', 'demo results, but still', 'all the toppings'],
  },
  {
    id: 'risk-check',
    name: 'Risk Check',
    slackAnnouncement: '📋 Question: what is the max risk per trade?',
    duration: 3000,
    type: 'slack-only',
    agentMessages: ['1% of balance', 'and 3% total open', 'stop loss on every order', 'no martingale. ever.'],
  },
]

// Incident-mode events — SAME ids as RANDOM_EVENTS so EVENT_TARGETS in App.tsx
// resolves without new entries; only the copy changes. deploy-fail /
// who-broke-build start a mini-incident and deploy-success ends one (incident.ts).
export const INCIDENT_EVENTS: RandomOfficeEvent[] = [
  {
    id: 'fire-drill',
    name: 'War Room',
    slackAnnouncement: '🚨 everyone to the door — bridge call starting',
    duration: 6000,
    type: 'all-move',
    targetPosition: { x: 114, y: 105 },
    managerMessage: 'joining the bridge. who has context?',
    agentMessages: ['joining the bridge', 'is this the sev1?', 'muting myself, kids are asleep'],
  },
  {
    id: 'pizza',
    name: 'Incident Pizza',
    slackAnnouncement: '🍕 pizza has arrived (expense code: OUTAGE)',
    duration: 5000,
    type: 'all-move',
    targetPosition: { x: 114, y: 105 },
    managerMessage: 'eat fast',
    agentMessages: ['incident pizza hits different', 'second pizza of the night', 'eating over the keyboard, sorry'],
  },
  {
    id: 'standup',
    name: 'Status Update',
    slackAnnouncement: '📢 @here what do we know, what are we doing, who is blocked',
    duration: 7000,
    type: 'all-move',
    targetPosition: { x: 411, y: 417 },
    managerMessage: 'go around the room',
    agentMessages: ['error rate 40% and dropping', 'rollback halfway', 'I need a DBA', 'still not DNS. probably DNS.'],
  },
  {
    id: 'deploy',
    name: 'Rollback Deploy',
    slackAnnouncement: '🚀 ROLLING BACK...',
    duration: 5000,
    type: 'slack-only',
    managerMessage: 'hold',
    agentMessages: ['please', 'watching the graph', 'if this fails we roll back the rollback'],
  },
  {
    id: 'deploy-success',
    name: 'Rollback Complete',
    slackAnnouncement: '✅ rollback complete — error rate normal',
    duration: 3000,
    type: 'slack-only',
    managerMessage: 'starting the all-clear timer',
    agentMessages: ['breathing again', 'graph is flat', 'who wants the postmortem doc'],
  },
  {
    id: 'deploy-fail',
    name: 'Rollback Failed',
    slackAnnouncement: '💥 rollback failed — rolling back the rollback',
    duration: 4000,
    type: 'slack-only',
    managerMessage: 'ok. ok. ok.',
    agentMessages: ['of course', 'migration was not reversible', 'checking the backup'],
  },
  {
    id: 'power-flicker',
    name: 'Rack Power Blip',
    slackAnnouncement: '⚡ UPS kicked in. again.',
    duration: 3000,
    type: 'visual-only',
    agentMessages: ['was that us?', 'the DC is also having a night'],
  },
  {
    id: 'birthday',
    name: 'Shift Change',
    slackAnnouncement: '🕑 EU on-call is awake — handover in the break room',
    duration: 4000,
    type: 'all-move',
    targetPosition: { x: 287, y: 129 },
    managerMessage: 'brief them, then sleep',
    agentMessages: ['handover doc is 3 lines', 'good luck', 'it is Tuesday there'],
  },
  {
    id: 'who-broke-build',
    name: 'Bisect',
    slackAnnouncement: '🔴 bisecting main — 12 commits between good and bad',
    duration: 5000,
    type: 'slack-only',
    managerMessage: 'blameless. find the commit, not the person.',
    agentMessages: ['4f2a1c is bad', 'a1b2c3 is good', 'it was the config change', 'I blame DNS'],
  },
  {
    id: 'friday',
    name: 'Friday Deploy',
    slackAnnouncement: '📅 reminder: this started as a Friday deploy',
    duration: 3000,
    type: 'slack-only',
    managerMessage: 'never again',
    agentMessages: ['never again', 'we said that last time', 'read-only Fridays from now on'],
  },
  {
    id: 'printer-jam',
    name: 'Printing The Error Log',
    slackAnnouncement: '🖨️ someone piped kubectl logs to lp',
    duration: 4000,
    type: 'single-agent',
    targetPosition: { x: 424, y: 132 },
    agentMessages: ['it is 400 pages', 'PC LOAD STACKTRACE', 'unplug it'],
  },
  {
    id: 'slack-down',
    name: 'Status Page Is Down',
    slackAnnouncement: '💀 the status page is down. the status page.',
    duration: 3000,
    type: 'slack-only',
    agentMessages: ['of course it is', 'tweet it', 'carrier pigeon time'],
  },
]

import { getTheme } from './theme'
import { getVariant } from './incident'

export function pickEvent(): RandomOfficeEvent {
  const isOffice = getTheme() === 'office'

  // Incident mode: the deploy chain runs hotter (0.35 vs 0.15) and every
  // event reads as part of the outage. Same ids, so movement targets resolve.
  if (getVariant() === 'incident') {
    if (Math.random() < 0.35) {
      return Math.random() < 0.7
        ? INCIDENT_EVENTS.find(e => e.id === 'deploy-success')!
        : INCIDENT_EVENTS.find(e => e.id === 'deploy-fail')!
    }
    const pool = INCIDENT_EVENTS.filter(e => e.id !== 'deploy-success' && e.id !== 'deploy-fail')
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // Deploy events chain together (kept for both themes)
  if (Math.random() < 0.15) {
    return Math.random() < 0.7
      ? RANDOM_EVENTS.find(e => e.id === 'deploy-success')!
      : RANDOM_EVENTS.find(e => e.id === 'deploy-fail')!
  }

  if (isOffice) {
    // 70% Office-themed, 30% default — keeps things varied
    const useOffice = Math.random() < 0.7
    const pool = useOffice
      ? OFFICE_EVENTS
      : RANDOM_EVENTS.filter(e => e.id !== 'deploy-success' && e.id !== 'deploy-fail')
    return pool[Math.floor(Math.random() * pool.length)]
  }

  const pool = RANDOM_EVENTS.filter(e => e.id !== 'deploy-success' && e.id !== 'deploy-fail')
  return pool[Math.floor(Math.random() * pool.length)]
}
