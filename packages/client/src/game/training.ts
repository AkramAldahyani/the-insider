/**
 * The training day's guide (defenderLadder.ts): a colleague who says what to do
 * next, one step at a time, and notices when it is done.
 *
 * The guide only looks at what this browser already knows (what is on the
 * player's own screen, the board, the meeting), never at the server's secrets.
 * The steps are the ones a real SOC analyst takes in this office: alert ->
 * address -> PC -> person -> meeting.
 */

/** What the browser knows about the player's progress (kept by the store). */
export interface TrainingFacts {
  cardOpen: boolean;
  seated: boolean;
  /** Has seen a shell (logged in) at a PC. */
  shell: boolean;
  /** Command names used in this match. */
  used: ReadonlySet<string>;
  /** A HIGH alert line has appeared on the player's screen. */
  alert: boolean;
  /** Clues on the board. */
  pins: number;
  meeting: boolean;
  over: boolean;
}

export interface TrainingStep {
  title: string;
  /** What to do. `code` in backticks is shown as a command. */
  text: string;
  done(f: TrainingFacts): boolean;
}

export const TRAINING_STEPS: TrainingStep[] = [
  {
    title: 'Your card',
    text: 'Welcome to Nexora, and to the security team. This card has your username, your password and your PC. Read it, then press C to put it away (C brings it back).',
    done: (f) => !f.cardOpen,
  },
  {
    title: 'Your desk',
    text: 'Your PC is SOC-WS-01, in the security office. Walk there with W A S D or the arrow keys, stand at the chair and press E.',
    done: (f) => f.seated,
  },
  {
    title: 'Log in',
    text: 'The PC asks for your password. Type the one on your card and press Enter. (The stars are normal: nobody looking over your shoulder sees it.)',
    done: (f) => f.shell,
  },
  {
    title: 'The SIEM',
    text: 'Every machine in the office writes logs. From your desk the SIEM searches all of them at once. Type `siem help` and press Enter to see how.',
    done: (f) => f.used.has('siem'),
  },
  {
    title: 'Wait for trouble',
    text: 'Ask for serious alerts: `siem source=alert severity=high`. Nothing yet? The intruder has not struck. Press ↑ and Enter again every minute or so.',
    done: (f) => f.alert,
  },
  {
    title: 'Pin the alert',
    text: 'There it is. The line says what happened and the address it came from (src_ip=...). Select the whole line with the mouse, then press Pin selection at the top of the window.',
    done: (f) => f.pins >= 1,
  },
  {
    title: 'Which PC?',
    text: 'Which PC had that address? Type `siem source=dhcp ip=ADDRESS | tail 1` with the address from the alert. The answer names the PC (client=...). Pin that line too.',
    done: (f) => f.pins >= 2,
  },
  {
    title: 'Which login?',
    text: 'What did that address do on the admin server? `siem source=auth host=ADMIN-SRV-01 action=login src_ip=ADDRESS | tail 1`. Pin it: that is your third clue.',
    done: (f) => f.pins >= 3,
  },
  {
    title: 'Call a meeting',
    text: 'Three clues point at one PC, so at the person whose desk it is: the office list on the left shows everybody\'s PC. Stand up (Esc), walk to the emergency button in the meeting room, and press E.',
    done: (f) => f.meeting,
  },
  {
    title: 'Make your case',
    text: 'Choose that person, tick your three clues, and present them. Your colleagues look at the evidence, then everybody votes.',
    done: (f) => f.over,
  },
  {
    title: 'Well done',
    text: 'That is how a case is made: alert, address, PC, person. The debrief shows every step the intruder took, and which ones you found. Next: the defender ladder, in Ladders on the menu.',
    done: () => false,
  },
];

/**
 * The step after `from` that the player is at now. The guide never goes back
 * (opening the card again later does not restart the training).
 */
export function trainingStep(from: number, facts: TrainingFacts): number {
  let at = Math.max(0, from);
  while (at < TRAINING_STEPS.length - 1 && TRAINING_STEPS[at].done(facts)) at++;
  return at;
}
