/**
 * Starts the game server.
 *
 *   pnpm dev            (starts this and the web page together)
 *   pnpm server         (only this)
 *
 * Settings come from environment variables, all optional:
 *   GAME_PORT=2567      port to listen on (not PORT: hosting tools often set PORT for the web page)
 *   SCENARIO=nexora-small
 *   MAP=office-small
 *   SEED=1              random seed of the simulated world
 *   TIME_SPEED=1        game seconds per real second
 *   BOTS=0              an empty office: no bot employees
 *   BOT_HACKER=0        keep employee bots but disable the automated hacker
 *   BOT_HACKER_DIFFICULTY=normal  easy (rumours), normal (some facts), hard (all facts)
 *   BOT_HACKER_PACE=normal  how fast the bot hacker plays: normal (by difficulty) or fast (tests, demonstrations)
 *   MEETING_SECONDS=90,45,8  meeting discussion, voting and result lengths
 *   STALL_MINUTES=10    anti-stall: every N game minutes one hacker action is flagged HIGH (0 = off)
 *   VULNS=random        today's weaknesses: random (2-4 from the seed), none, or a list like extra-sudo,tailgate
 *   NODE_ENV=production switches the developer panel OFF
 */
import { OfficeGame } from './game';
import { SERVER_PORT } from '@insider/shared';
import { createGameServer, loadGameOptions, type AppOptions } from './app';

const options: AppOptions = {
  scenario: process.env.SCENARIO,
  map: process.env.MAP,
  seed: process.env.SEED ? Number(process.env.SEED) : undefined,
  speed: process.env.TIME_SPEED ? Number(process.env.TIME_SPEED) : undefined,
  bots: process.env.BOTS === undefined ? undefined : process.env.BOTS !== '0',
  botHacker: process.env.BOT_HACKER === undefined ? undefined : process.env.BOT_HACKER !== '0',
  botHackerDifficulty: process.env.BOT_HACKER_DIFFICULTY,
  botHackerPace: process.env.BOT_HACKER_PACE,
  weaknesses: process.env.VULNS,
  meetingSeconds: process.env.MEETING_SECONDS,
  stallMinutes: process.env.STALL_MINUTES ? Number(process.env.STALL_MINUTES) : undefined,
};
const port = Number(process.env.GAME_PORT ?? SERVER_PORT);

try {
  // Build one game now, only to check the files: a map that does not match
  // the scenario stops the server here with a clear list of problems,
  // instead of failing later when the first player joins.
  const loaded = loadGameOptions(options);
  new OfficeGame(loaded);
  await createGameServer(options).listen(port);
  console.log(`[insider] game server on ws://localhost:${port}  scenario=${loaded.scenario.id} map=${loaded.mapName} dev=${String(loaded.dev)} bots=${String(loaded.bots)}`);
} catch (error) {
  console.error(`[insider] cannot start:\n${(error as Error).message}`);
  process.exit(1);
}
